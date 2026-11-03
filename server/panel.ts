/**
 * 面板服务：只读 SQLite，出资产/收益/执行记录。
 * 零框架，单进程，:8787。执行器独立进程，两者通过 DB 通信。
 */
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { sqlite, dbPath } from '../db/client';
import {loadInventoryLatest} from '../runner/inventory.ts';
import { createJobQueue, JobInputError } from './jobs';

const queue = createJobQueue(sqlite);

function readBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch {
        resolve({});
      }
    });
  });
}

const PORT = Number(process.env.PANEL_PORT || 8787);
const PUB = path.resolve('public');

const q = (sql: string, ...args: any[]) => sqlite.prepare(sql).all(...args) as any[];
const one = (sql: string, ...args: any[]) => sqlite.prepare(sql).get(...args) as any;

function overview() {
  const assets = q(`SELECT * FROM asset ORDER BY cny_per_unit DESC, name`);
  const out = assets.map((a) => {
    const cur = one(
      `SELECT balance, day FROM asset_snapshot WHERE asset_id=? ORDER BY day DESC, id DESC LIMIT 1`,
      a.id,
    );
    const prevDay = one(
      `SELECT balance FROM asset_snapshot WHERE asset_id=? AND day < date('now','localtime') ORDER BY day DESC, id DESC LIMIT 1`,
      a.id,
    );
    const week = one(
      `SELECT balance FROM asset_snapshot WHERE asset_id=? AND day <= date('now','localtime','-7 day') ORDER BY day DESC, id DESC LIMIT 1`,
      a.id,
    );
    const first = one(`SELECT balance FROM asset_snapshot WHERE asset_id=? ORDER BY day ASC, id ASC LIMIT 1`, a.id);
    const readings = one(`SELECT COUNT(*) c FROM asset_snapshot WHERE asset_id=?`, a.id)?.c ?? 0;
    const todayDelta = cur && prevDay ? cur.balance - prevDay.balance : null;
    const weekDelta = cur && week ? cur.balance - week.balance : null;
    return {
      id: a.id,
      name: a.name,
      platform: a.platform,
      unit: a.unit,
      cnyPerUnit: a.cny_per_unit,
      expiryDays: a.expiry_days,
      redeemPath: a.redeem_path,
      current: cur?.balance ?? null,
      cny: cur ? +(cur.balance * a.cny_per_unit).toFixed(2) : null,
      todayDelta,
      weekDelta,
      sinceFirst: cur && first ? cur.balance - first.balance : null,
      readings,
      updatedAt: cur?.day ?? null,
    };
  });
  const totalCny = out.reduce((s, x) => s + (x.cny ?? 0), 0);
  return { assets: out, totalCny: +totalCny.toFixed(2), generatedAt: new Date().toISOString(), cost: costSummary() };
}

/** 成本观测：token / 调用次数，以及按参考价折算的人民币 */
function costSummary() {
  const perMTok = Number(process.env.COST_PER_MTOK || 2); // ¥/百万 tokens，仅作参考换算
  const today = one(
    `SELECT COALESCE(SUM(total_tokens),0) tok, COALESCE(SUM(model_calls),0) calls,
            COALESCE(SUM(prompt_tokens),0) prompt, COALESCE(SUM(completion_tokens),0) comp,
            COALESCE(SUM(cached_tokens),0) cached, COUNT(*) runs
       FROM run WHERE day = date('now','localtime')`,
  ) || {};
  const all = one(
    `SELECT COALESCE(SUM(total_tokens),0) tok, COALESCE(SUM(model_calls),0) calls, COUNT(*) runs
       FROM run`,
  ) || {};
  const byIntent: Record<string, number> = {};
  for (const r of q(`SELECT usage_json FROM run WHERE day = date('now','localtime') AND usage_json IS NOT NULL`)) {
    try {
      const u = JSON.parse(r.usage_json);
      for (const [k, v] of Object.entries(u.byIntent || {})) {
        byIntent[k] = (byIntent[k] || 0) + Number((v as any).totalTokens || 0);
      }
    } catch {}
  }
  return {
    perMTok,
    today: {
      tokens: today.tok,
      calls: today.calls,
      prompt: today.prompt,
      completion: today.comp,
      cached: today.cached,
      runs: today.runs,
      cny: +((today.tok / 1_000_000) * perMTok).toFixed(4),
    },
    allTime: {
      tokens: all.tok,
      calls: all.calls,
      runs: all.runs,
      cny: +((all.tok / 1_000_000) * perMTok).toFixed(4),
    },
    byIntent,
  };
}

/** 每日收益 vs 成本 */
function daily(days = 30) {
  const perMTok = Number(process.env.COST_PER_MTOK || 2);

  // 收益：按 run 的余额差 × 资产汇率（只算余额上涨的，下跌已判为读取失败）
  const rows = q(
    `SELECT r.day,
            COALESCE(SUM(CASE WHEN r.balance_after > r.balance_before
                              THEN (r.balance_after - r.balance_before) * a.cny_per_unit ELSE 0 END), 0) AS gain_cny,
            COALESCE(SUM(CASE WHEN r.balance_after > r.balance_before
                              THEN (r.balance_after - r.balance_before) ELSE 0 END), 0) AS gain_units,
            COALESCE(SUM(r.total_tokens), 0) AS tokens,
            COALESCE(SUM(r.model_calls), 0) AS calls,
            COUNT(*) AS runs,
            SUM(CASE WHEN r.status='OK' THEN 1 ELSE 0 END) AS ok_runs,
            SUM(CASE WHEN r.status='ALREADY' THEN 1 ELSE 0 END) AS already_runs,
            SUM(CASE WHEN r.status NOT IN ('OK','ALREADY') THEN 1 ELSE 0 END) AS bad_runs
       FROM run r LEFT JOIN activity ac ON ac.id = r.activity_id
       LEFT JOIN asset a ON a.id = ac.asset_id
      WHERE r.day >= date('now','localtime',?)
      GROUP BY r.day ORDER BY r.day`,
    `-${days} day`,
  );

  const out = rows.map((r: any) => {
    const costCny = +((r.tokens / 1_000_000) * perMTok).toFixed(4);
    return {
      day: r.day,
      gainCny: +Number(r.gain_cny).toFixed(2),
      gainUnits: Number(r.gain_units),
      costCny,
      costTokens: r.tokens,
      calls: r.calls,
      netCny: +(Number(r.gain_cny) - costCny).toFixed(4),
      runs: r.runs,
      ok: r.ok_runs,
      already: r.already_runs,
      bad: r.bad_runs,
    };
  });

  const total = out.reduce(
    (s: any, x: any) => ({
      gainCny: +(s.gainCny + x.gainCny).toFixed(2),
      costCny: +(s.costCny + x.costCny).toFixed(4),
      netCny: +(s.netCny + x.netCny).toFixed(4),
      costTokens: s.costTokens + x.costTokens,
      calls: s.calls + x.calls,
    }),
    { gainCny: 0, costCny: 0, netCny: 0, costTokens: 0, calls: 0 },
  );

  return { days: out, total, perMTok };
}

/** 细分：账号 / App / 活动 × 资产 × 收益 × 成本 */
function breakdown() {
  const perMTok = Number(process.env.COST_PER_MTOK || 2);
  const rows = q(
    `SELECT r.account_id, ac.app, ac.note AS account_note, ac.enabled AS account_on,
            r.activity_id, act.name AS activity_name,
            a.id AS asset_id, a.name AS asset_name, a.unit, a.cny_per_unit,
            COUNT(*) AS runs,
            SUM(CASE WHEN r.status='OK' THEN 1 ELSE 0 END) AS ok_runs,
            SUM(CASE WHEN r.status='ALREADY' THEN 1 ELSE 0 END) AS already_runs,
            SUM(CASE WHEN r.status NOT IN ('OK','ALREADY') THEN 1 ELSE 0 END) AS bad_runs,
            COALESCE(SUM(CASE WHEN r.balance_after > r.balance_before
                              THEN r.balance_after - r.balance_before ELSE 0 END), 0) AS gain_units,
            COALESCE(SUM(r.total_tokens), 0) AS tokens,
            COALESCE(SUM(r.model_calls), 0) AS calls,
            MIN(r.day) AS first_day, MAX(r.day) AS last_day,
            (SELECT status FROM run x WHERE x.activity_id=r.activity_id ORDER BY x.id DESC LIMIT 1) AS last_status,
            (SELECT exec_ms FROM run x WHERE x.activity_id=r.activity_id ORDER BY x.id DESC LIMIT 1) AS last_exec_ms
       FROM run r
       LEFT JOIN account ac   ON ac.id = r.account_id
       LEFT JOIN activity act ON act.id = r.activity_id
       LEFT JOIN asset a      ON a.id = act.asset_id
      GROUP BY r.account_id, r.activity_id
      ORDER BY ac.app, r.account_id, r.activity_id`,
  );

  return rows.map((r: any) => {
    const gainUnits = Number(r.gain_units);
    const cny = gainUnits * Number(r.cny_per_unit || 0);
    const costCny = +((r.tokens / 1_000_000) * perMTok).toFixed(4);
    return {
      accountId: r.account_id,
      app: r.app,
      accountNote: r.account_note,
      accountOn: r.account_on === 1,
      activityId: r.activity_id,
      activityName: r.activity_name,
      assetName: r.asset_name,
      unit: r.unit,
      gainUnits,
      cny: +cny.toFixed(2),
      costCny,
      costTokens: r.tokens,
      calls: r.calls,
      netCny: +(cny - costCny).toFixed(4),
      runs: r.runs,
      ok: r.ok_runs,
      already: r.already_runs,
      bad: r.bad_runs,
      firstDay: r.first_day,
      lastDay: r.last_day,
      lastStatus: r.last_status,
      lastExecMs: r.last_exec_ms,
    };
  });
}

function trend(days = 30) {
  const rows = q(
    `SELECT asset_id, day, balance FROM asset_snapshot
      WHERE day >= date('now','localtime',?)
      ORDER BY day ASC, id ASC`,
    `-${days} day`,
  );
  const dayset = [...new Set(rows.map((r) => r.day))].sort();
  const byAsset: Record<string, Record<string, number>> = {};
  for (const r of rows) {
    byAsset[r.asset_id] ??= {};
    byAsset[r.asset_id][r.day] = r.balance; // 同日取最后一条
  }
  return { days: dayset, series: byAsset };
}

function runs(limit = 30) {
  return q(
    `SELECT r.*, a.name AS activity_name, ac.note AS account_note
       FROM run r
       LEFT JOIN activity a ON a.id = r.activity_id
       LEFT JOIN account ac ON ac.id = r.account_id
      ORDER BY r.id DESC LIMIT ?`,
    limit,
  );
}

function activityStatus() {
  return q(
    `SELECT a.id, a.name, a.account_id, a.asset_id, a.window_start, a.window_end, a.state,
            (SELECT status FROM run r WHERE r.activity_id=a.id ORDER BY r.id DESC LIMIT 1) AS last_status,
            (SELECT day    FROM run r WHERE r.activity_id=a.id ORDER BY r.id DESC LIMIT 1) AS last_day,
            (SELECT exec_ms FROM run r WHERE r.activity_id=a.id ORDER BY r.id DESC LIMIT 1) AS last_exec_ms,
            (SELECT error  FROM run r WHERE r.activity_id=a.id ORDER BY r.id DESC LIMIT 1) AS last_error
       FROM activity a ORDER BY a.id`,
  );
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.json': 'application/json; charset=utf-8',
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://localhost:${PORT}`);
  const send = (code: number, body: any, type = 'application/json; charset=utf-8') => {
    res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
    res.end(typeof body === 'string' ? body : JSON.stringify(body));
  };

  try {
    // ── 执行入口（异步） ──
    if (req.method === 'POST' && ['/api/plan', '/api/run'].includes(url.pathname)) {
      const b = await readBody(req);
      if (!b || typeof b !== 'object' || Array.isArray(b)) throw new JobInputError('body must be an object');
      if (b.activity !== undefined && typeof b.activity !== 'string') throw new JobInputError('activity must be a string');
      if (b.account !== undefined && typeof b.account !== 'string') throw new JobInputError('account must be a string');
      if (b.skip !== undefined && (!Array.isArray(b.skip) || b.skip.some((s: any) => typeof s !== 'string'))) throw new JobInputError('skip must be an array of strings');
      const kind = url.pathname === '/api/plan' ? 'plan' : 'run';
      const id = queue.enqueue({ kind, activityId: b.activity ?? 'tb_coin', accountId: b.account,
        payload: kind === 'plan' ? { skip: b.skip ?? [] } : {}, maxAttempt: 1 });
      // run_id is the eventual real run FK, never a second name for job.id.
      return send(202, { ok: true, job_id: id, ...(kind === 'plan' ? { plan_id: id } : {}), run_id: null, status: 'queued' });
    }

    if (req.method === 'GET' && /^\/api\/run\/\d+$/.test(url.pathname)) {
      const id = Number(url.pathname.split('/').pop());
      const job = one(`SELECT * FROM job WHERE id=?`, id);
      if (!job) return send(404, { error: 'job not found' });
      // 关联 run 表的成本与收益
      const runId = job.run_id;
      const runRow = runId ? one(`SELECT * FROM run WHERE id=?`, runId) : null;
      const calls = runId ? q(
        `SELECT caller, model, SUM(total_tokens) tokens, COUNT(*) calls FROM model_call WHERE run_id=? GROUP BY caller, model`,
        runId,
      ) : [];
      const gains = runId ? q(`SELECT source, units, note FROM gain_event WHERE run_id=?`, runId) : [];
      const costs = runId ? q(`SELECT kind, calls, total_tokens FROM cost_event WHERE run_id=?`, runId) : [];
      return send(200, {
        id,
        job_id: id,
        run_id: runId ?? null,
        kind: job.kind,
        status: job.status,
        stage: job.stage,
        activity: job.activity_id,
        account: job.account_id,
        created_at: job.created_at,
        finished_at: job.finished_at,
        error: job.error,
        result: job.result ? JSON.parse(job.result) : null,
        run: runRow ?? null,
        cost: { calls, by_intent: costs },
        gain: gains,
      });
    }

    // ── 步骤级明细 ──
    if (url.pathname === '/api/steps') {
      const runId = Number(url.searchParams.get('run') || 0);
      if (!runId) return send(400, { error: 'need ?run=<id>' });
      const steps = q(`SELECT * FROM run_step WHERE run_id=? ORDER BY seq`, runId);
      const byStage = q(
        `SELECT stage, COUNT(*) n, SUM(ms) ms, SUM(tokens) tokens, SUM(calls) calls
           FROM run_step WHERE run_id=? GROUP BY stage ORDER BY SUM(ms) DESC`,
        runId,
      );
      // 该 run 的原始调用（按时间窗匹配）
      const runRow = one(`SELECT * FROM run WHERE id=?`, runId);
      const calls = runRow
        ? q(
            `SELECT id,ts,model,prompt_tokens,completion_tokens,total_tokens,latency_ms,status
               FROM model_call WHERE ts >= ? ORDER BY id LIMIT 200`,
            runRow.ts,
          )
        : [];
      return send(200, { runId, steps, byStage, calls });
    }

    if (url.pathname === '/api/learning') {
      const activity = url.searchParams.get('activity') || 'tb_coin';
      const recipes = q(
        `SELECT task_name, kind, steps_json, retries, confidence, observed_at
           FROM recipe WHERE activity_id=? ORDER BY id`,
        activity,
      ).map((r: any) => ({
        task: r.task_name,
        kind: r.kind,
        steps: JSON.parse(r.steps_json ?? '[]'),
        retries: r.retries,
        confidence: r.confidence,
        observedAt: r.observed_at,
      }));

      const templates = q(`SELECT * FROM task_template ORDER BY kind`).map((r: any) => ({
        platform: r.platform,
        kind: r.kind,
        steps: JSON.parse(r.steps_json ?? '[]'),
        invariants: JSON.parse(r.invariants_json ?? '[]'),
        failureModes: JSON.parse(r.failure_modes_json ?? '[]'),
        derivedFrom: JSON.parse(r.derived_from_json ?? '[]'),
        confidence: r.confidence,
        updatedAt: r.updated_at,
      }));

      // 预测：用最新 inventory + 模板
      let prediction: any = null;
      try {
        const inv = loadInventoryLatest('tb_main',activity);
        if (inv) {
          const { loadTaskRules } = await import('../runner/config');
          const { predict } = await import('../runner/predict');
          const raw: any = loadTaskRules('taobao') ?? {};
          const rules: any = {
            platform: raw.platform ?? 'taobao',
            rules: raw.rules ?? [],
            tiers: raw.tiers,
            tier_policy: raw.tier_policy,
            tokensPerLocate: raw.tokens_per_locate,
            minMarginalCnyPerHour: raw.min_marginal_cny_per_hour,
            unitReward: raw.unit_reward,
            unitSeconds: raw.unit_seconds,
          };
          prediction = predict('taobao', inv, rules);
        }
      } catch (e: any) {
        prediction = { error: String(e?.message ?? e).slice(0, 120) };
      }

      const evolution = q(
        `SELECT date(observed_at,'localtime') day, COUNT(*) n FROM recipe GROUP BY day ORDER BY day DESC LIMIT 14`,
      );

      return send(200, { activity, recipes, templates, prediction, evolution });
    }

    if (url.pathname === '/api/cost') {
      const days = Number(url.searchParams.get('days') || 7);
      return send(200, q(
        `SELECT date(ts,'localtime') day, caller, model, COUNT(*) calls,
                SUM(total_tokens) tokens, SUM(latency_ms) ms
           FROM model_call
          WHERE ts >= date('now','localtime','-${days} day')
          GROUP BY day, caller, model ORDER BY day DESC, tokens DESC`,
      ));
    }

    if (url.pathname === '/api/overview') return send(200, overview());
    if (url.pathname === '/api/daily') return send(200, daily(Number(url.searchParams.get('days') || 30)));
    if (url.pathname === '/api/breakdown') return send(200, breakdown());
    if (url.pathname === '/api/trend') return send(200, trend(Number(url.searchParams.get('days') || 30)));
    if (url.pathname === '/api/runs') return send(200, runs(Number(url.searchParams.get('limit') || 30)));
    if (url.pathname === '/api/activities') return send(200, activityStatus());

    if (url.pathname === '/echarts.min.js') {
      const p = path.resolve('node_modules/echarts/dist/echarts.min.js');
      return send(200, fs.readFileSync(p, 'utf8'), MIME['.js']);
    }

    const rel = url.pathname === '/' ? '/index.html' : url.pathname;
    const file = path.join(PUB, rel);
    if (!file.startsWith(PUB) || !fs.existsSync(file)) return send(404, { error: 'not found' });
    const ext = path.extname(file);
    return send(200, fs.readFileSync(file, 'utf8'), MIME[ext] ?? 'application/octet-stream');
  } catch (e: any) {
    return send(e instanceof JobInputError ? 400 : 500, { error: String(e?.message ?? e) });
  }
});

const HOST = process.env.PANEL_HOST || '0.0.0.0';

server.listen(PORT, HOST, () => {
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : PORT;
  const ips: string[] = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const ni of list ?? []) {
      if (ni.family === 'IPv4' && !ni.internal) ips.push(ni.address);
    }
  }
  console.log(`📊 签到面板已启动`);
  console.log(`   本机:     http://127.0.0.1:${port}`);
  for (const ip of ips) console.log(`   局域网:   http://${ip}:${port}`);
  console.log(`   DB: ${dbPath}`);
  console.log(`   参考成本价: ¥${process.env.COST_PER_MTOK || 2}/百万 tokens`);
});
