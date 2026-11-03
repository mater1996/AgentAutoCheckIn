/**
 * Claude Agent SDK 编排层。
 *
 * 职责边界：SDK 只做决策编排，**不直接点屏幕**。
 * 它的每个工具内部都是调平台 API（/api/plan、/api/run、/api/run/:id），
 * 这样风控闸门和记账不会被绕过。
 */
import fs from 'node:fs';
import path from 'node:path';

import { loadAgentCfg, applyAgentEnv } from './agent-config';

export type OrchestrateResult = {
  ok: boolean;
  text: string;
  turns: number;
  usage: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    totalTokens: number;
  } | null;
  logFile: string | null;
  error?: string;
};

async function apiCall(base: string, method: string, p: string, body?: any): Promise<any> {
  const res = await fetch(`${base}${p}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`API ${p} → HTTP ${res.status}`);
  return res.json();
}

function validateJobId(id: unknown): number {
  if (typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0) {
    throw new Error('job_id must be a positive safe integer');
  }
  return id;
}

/** 按队列 job_id 轮询直到 job 结束；run_id 是独立的运行记录 ID。 */
async function waitJob(base: string, id: unknown, maxMs = 20 * 60 * 1000): Promise<any> {
  const jobId = validateJobId(id);
  const t0 = Date.now();
  let last: any = null;
  while (Date.now() - t0 < maxMs) {
    last = await apiCall(base, 'GET', `/api/run/${jobId}`);
    if (last.status !== 'running' && last.status !== 'queued') return last;
    await new Promise((r) => setTimeout(r, 8000));
  }
  return { ...(last ?? {}), status: 'timeout', error: `轮询超时 ${maxMs}ms` };
}

function loadSystemPrompt(promptFile = 'config/agent-prompt.md'): string {
  const f = path.resolve(promptFile);
  if (!fs.existsSync(f)) return '';
  return fs.readFileSync(f, 'utf8');
}

export async function orchestrate(prompt: string): Promise<OrchestrateResult> {
  const cfg = loadAgentCfg();
  if (!cfg.enabled) throw new Error('config/agent.yaml 里 agent.enabled = false');

  const env = applyAgentEnv(cfg);
  if (!env.tokenSet) throw new Error(`环境变量 ${cfg.auth_token_env} 未设置`);

  const sdk = await import('@anthropic-ai/claude-agent-sdk');

  // 平台工具：全部转调 API，SDK 拿不到 adb
  const { tool, createSdkMcpServer } = sdk as any;
  const { z } = await import('zod');

  const tools = [
    tool(
      'collect_inventory',
      '收集指定活动的任务清单与档位，只读不执行。按队列 job_id 等待完成，返回任务详情；后续查询使用 job_id。',
      { activity: z.string().describe('活动 id，例如 tb_coin'), account: z.string().optional() },
      async (args: any) => {
        const r = await apiCall(cfg.platform_api, 'POST', '/api/plan', {
          activity: args.activity,
          account: args.account,
        });
        const job = await waitJob(cfg.platform_api, r.job_id, 5 * 60 * 1000);
        return {
          content: [{ type: 'text', text: JSON.stringify(job, null, 2).slice(0, 4000) }],
        };
      },
    ),
    tool(
      'run_activity',
      '执行指定活动（收集→决策→执行一条龙）。按队列 job_id 等待完成，返回最终结果；run_id 是独立的运行记录 ID，查询任务使用 job_id。',
      { activity: z.string().describe('活动 id'), account: z.string().optional() },
      async (args: any) => {
        const r = await apiCall(cfg.platform_api, 'POST', '/api/run', {
          activity: args.activity,
          account: args.account,
        });
        const job = await waitJob(cfg.platform_api, r.job_id);
        return {
          content: [{ type: 'text', text: JSON.stringify(job, null, 2).slice(0, 4000) }],
        };
      },
    ),
    tool(
      'read_run',
      '按队列 job_id 查任务详情：状态、收益、成本、步骤。id 参数使用 job_id；run_id 是独立的运行记录 ID。',
      { id: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).describe('队列任务 job_id（正安全整数）') },
      async (args: any) => {
        const jobId = validateJobId(args.id);
        const job = await apiCall(cfg.platform_api, 'GET', `/api/run/${jobId}`);
        return { content: [{ type: 'text', text: JSON.stringify(job, null, 2).slice(0, 4000) }] };
      },
    ),
  ];

  const server = createSdkMcpServer({ name: 'checkin', version: '1.0.0', tools });

  fs.mkdirSync(cfg.log_dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const logFile = path.join(cfg.log_dir, `session-${stamp}.jsonl`);
  const logStream = fs.createWriteStream(logFile, { flags: 'a' });

  let text = '';
  let turns = 0;
  let usage: OrchestrateResult['usage'] = null;

  try {
    // 关键：SDK 会 spawn CLI 子进程，它默认读 ~/.claude/settings.json，
    // 那里把 ANTHROPIC_BASE_URL 指到 3425、model 指到 deepseek，会覆盖我们的配置。
    // 用 env 显式替换子进程环境（SDK 文档：env 是 REPLACE 而非 merge，必须自己铺 process.env），
    // 并用 CLAUDE_CONFIG_DIR 指向项目内的私有目录，避免读全局 settings。
    const privateCfgDir = path.resolve('.claude-agent');
    fs.mkdirSync(privateCfgDir, { recursive: true });

    const stream = sdk.query({
      prompt,
      options: {
        maxTurns: cfg.max_turns,
        mcpServers: { checkin: server },
        allowedTools: cfg.allowed_tools,
        permissionMode: 'bypassPermissions',
        model: cfg.model,
        // 行为准则：来自 config/agent-prompt.md，不硬编码在代码里
        systemPrompt: loadSystemPrompt(cfg.system_prompt_file),
        env: {
          ...process.env,
          CLAUDE_CONFIG_DIR: privateCfgDir,
          ANTHROPIC_BASE_URL: cfg.base_url,
          ANTHROPIC_AUTH_TOKEN: process.env[cfg.auth_token_env] ?? '',
          ANTHROPIC_MODEL: cfg.model,
          ANTHROPIC_DEFAULT_HAIKU_MODEL: cfg.model,
          ANTHROPIC_DEFAULT_SONNET_MODEL: cfg.model,
          ANTHROPIC_DEFAULT_OPUS_MODEL: cfg.model,
          ANTHROPIC_SMALL_FAST_MODEL: cfg.model,
          NO_PROXY: '127.0.0.1,localhost',
          no_proxy: '127.0.0.1,localhost',
        },
      },
    });

    for await (const msg of stream as any) {
      logStream.write(JSON.stringify(msg) + '\n');
      if (msg?.type === 'assistant') {
        turns++;
        const blocks = msg.message?.content ?? [];
        for (const b of blocks) if (b?.type === 'text') text += b.text;
      }
      if (msg?.type === 'result') {
        if (typeof msg.result === 'string') text = msg.result;
        const u = msg.usage ?? msg.total_usage ?? null;
        if (u) {
          const input = Number(u.input_tokens ?? 0);
          const output = Number(u.output_tokens ?? 0);
          const cacheRead = Number(u.cache_read_input_tokens ?? 0);
          usage = {
            inputTokens: input,
            outputTokens: output,
            cacheReadTokens: cacheRead,
            totalTokens: input + output + cacheRead,
          };
        }
        if (msg.num_turns) turns = Number(msg.num_turns);
      }
    }

    return { ok: true, text: text.slice(0, 20000), turns, usage, logFile };
  } catch (e: any) {
    return {
      ok: false,
      text,
      turns,
      usage,
      logFile,
      error: String(e?.message ?? e).slice(0, 500),
    };
  } finally {
    logStream.end();
  }
}