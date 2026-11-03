/**
 * 计量代理：所有模型调用都必须经过这里，才能拿到完整账。
 *
 * 端口即身份，不依赖调用方自觉传 header：
 *   3426 → midscene
 *   3427 → agent (Claude Agent SDK)
 *   3428 → probe
 *
 * 用法：npx tsx server/meter.ts
 * 然后设置 MIDSCENE_MODEL_BASE_URL=http://127.0.0.1:3426/v1
 */
import http from 'node:http';
import crypto from 'node:crypto';

import { sqlite } from '../db/client';

const UPSTREAM = process.env.METER_UPSTREAM ?? 'http://127.0.0.1:3425';
const PORTS: { port: number; caller: string }[] = [
  { port: 3426, caller: 'midscene' },
  { port: 3427, caller: 'agent' },
  { port: 3428, caller: 'probe' },
];

function digest(body: string): string {
  return crypto.createHash('sha1').update(body).digest('hex').slice(0, 12);
}

/** 从响应文本里抠 usage（兼容 OpenAI 与 Anthropic 两种格式，含流式最后一帧） */
function extractUsage(text: string): {
  prompt?: number;
  completion?: number;
  total?: number;
  cached?: number;
} {
  const out: { prompt?: number; completion?: number; total?: number; cached?: number } = {};

  // OpenAI: "usage":{"prompt_tokens":1,"completion_tokens":2,"total_tokens":3,...}
  // Anthropic: "usage":{"input_tokens":1,"output_tokens":2,...}
  const re = /"usage"\s*:\s*\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const body = m[1];
    const num = (k: string) => {
      const mm = body.match(new RegExp(`"${k}"\\s*:\\s*(\\d+)`));
      return mm ? Number(mm[1]) : undefined;
    };
    const p = num('prompt_tokens') ?? num('input_tokens');
    const c = num('completion_tokens') ?? num('output_tokens');
    const t = num('total_tokens');
    const cached = num('cached_tokens') ?? num('cache_read_input_tokens');
    if (p !== undefined) out.prompt = (out.prompt ?? 0) + p;
    if (c !== undefined) out.completion = (out.completion ?? 0) + c;
    if (t !== undefined) out.total = (out.total ?? 0) + t;
    if (cached !== undefined) out.cached = (out.cached ?? 0) + cached;
  }
  // 口径统一：total = input + output + cacheRead。
  // Anthropic 的 total_tokens 字段不含 cache_read，直接用它会对不上 SDK 自报。
  if (out.prompt || out.completion || out.cached) {
    out.total = (out.prompt ?? 0) + (out.completion ?? 0) + (out.cached ?? 0);
  }
  return out;
}

const insert = sqlite.prepare(`
  INSERT INTO model_call
    (ts, run_id, caller, model, endpoint, prompt_tokens, completion_tokens,
     total_tokens, cached_tokens, latency_ms, status, error, request_digest)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

function record(row: {
  runId: number | null;
  caller: string;
  model: string;
  endpoint: string;
  usage: ReturnType<typeof extractUsage>;
  latencyMs: number;
  status: string;
  error?: string | null;
  digest: string;
}) {
  try {
    insert.run(
      new Date().toISOString(),
      row.runId,
      row.caller,
      row.model,
      row.endpoint,
      row.usage.prompt ?? 0,
      row.usage.completion ?? 0,
      row.usage.total ?? 0,
      row.usage.cached ?? 0,
      row.latencyMs,
      row.status,
      row.error ?? null,
      row.digest,
    );
  } catch (e: any) {
    console.error('[meter] 落库失败:', e?.message);
  }
}

function makeServer(caller: string) {
  return http.createServer((req, res) => {
    const t0 = Date.now();
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const bodyStr = Buffer.concat(chunks).toString('utf8');

      // 解析 model / run_id / stream
      let model = 'unknown';
      let stream = false;
      try {
        const j = JSON.parse(bodyStr);
        model = String(j.model ?? 'unknown');
        stream = j.stream === true;
      } catch {}
      // run 归属优先级：header > 路径段 /run/<id> > query ?run_id=
      const runIdHeader = req.headers['x-run-id'];
      let runId = runIdHeader ? Number(runIdHeader) || null : null;

      // 路径段形式 /v1/run/23/chat/completions → runId=23，转上游时剥成 /v1/chat/completions
      // 用路径段而不是 query，因为 OpenAI SDK 会在 base_url 后直接拼路径，
      // query 后面接路径会变成废 URL（实测导致网关 404）。
      let upstreamPath = req.url ?? '/';
      const m = upstreamPath.match(/^(\/v1)\/run\/(\d+)(.*)$/);
      if (m) {
        if (runId === null) runId = Number(m[2]) || null;
        upstreamPath = m[1] + (m[3] || '');
      }

      try {
        const u = new URL(req.url ?? '/', UPSTREAM);
        const qp = u.searchParams.get('run_id');
        if (runId === null && qp) runId = Number(qp) || null;
      } catch {}

      const url = new URL(upstreamPath, UPSTREAM);
      const upstreamReq = http.request(
        {
          hostname: url.hostname,
          port: url.port || 80,
          path: url.pathname + url.search,
          method: req.method,
          headers: {
            ...req.headers,
            host: url.host,
            'content-length': Buffer.byteLength(bodyStr),
          },
        },
        (up) => {
          const bufs: Buffer[] = [];
          res.writeHead(up.statusCode ?? 502, up.headers as any);

          up.on('data', (c: Buffer) => {
            bufs.push(c);
            res.write(c);
          });
          up.on('end', () => {
            res.end();
            const text = Buffer.concat(bufs).toString('utf8');
            const usage = extractUsage(text);
            record({
              runId,
              caller,
              model,
              endpoint: url.pathname,
              usage,
              latencyMs: Date.now() - t0,
              status: (up.statusCode ?? 0) < 400 ? 'ok' : `http_${up.statusCode}`,
              error: (up.statusCode ?? 0) >= 400 ? text.slice(0, 200) : null,
              digest: digest(bodyStr),
            });
          });
        },
      );

      upstreamReq.on('error', (e) => {
        if (!res.headersSent) res.writeHead(502, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: { message: `meter upstream error: ${e.message}` } }));
        record({
          runId,
          caller,
          model,
          endpoint: url.pathname,
          usage: {},
          latencyMs: Date.now() - t0,
          status: 'upstream_error',
          error: e.message.slice(0, 200),
          digest: digest(bodyStr),
        });
      });

      upstreamReq.end(bodyStr);
    });
  });
}

for (const { port, caller } of PORTS) {
  makeServer(caller).listen(port, '127.0.0.1', () => {
    console.log(`  meter :${port} → ${UPSTREAM}  (caller=${caller})`);
  });
}

console.log('计量代理已启动。把调用方的 base_url 指到对应端口即可自动记账。');
