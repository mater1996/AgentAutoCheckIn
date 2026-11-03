import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import {fileURLToPath} from 'node:url';

const previousCwd=process.cwd(),previousDbPath=process.env.CHECKIN_DB_PATH,previousDb=process.env.CHECKIN_DB;
const dir = fs.realpathSync(fs.mkdtempSync(path.join(process.env.TMPDIR!, 'checkin-jobs-')));
process.chdir(dir);
const tsxLoader=import.meta.resolve('tsx');
process.env.CHECKIN_DB_PATH = path.join(dir, 'test.db');
process.env.CHECKIN_DB = path.join(dir, 'legacy-must-not-open.db');
const { sqlite, dbPath } = await import('../db/client');
const jobs: any = await import('../server/jobs');
test.after(() => {
 sqlite.close();process.chdir(previousCwd);
 if(previousDbPath===undefined)delete process.env.CHECKIN_DB_PATH;else process.env.CHECKIN_DB_PATH=previousDbPath;
 if(previousDb===undefined)delete process.env.CHECKIN_DB;else process.env.CHECKIN_DB=previousDb;
 fs.rmSync(dir, { recursive: true, force: true });
});

test('panel only queues and GET joins detail by job.run_id, including null association', async () => {
  const source = fs.readFileSync(new URL('../server/panel.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /runInBackground|import\(['"]\.\.\/runner\/(signin|collect)['"]\)/);
  fixture();
  const queue = jobs.createJobQueue(sqlite);
  const id = queue.enqueue({ kind: 'run', activityId: 'act', maxAttempt: 1 });
  sqlite.prepare("INSERT INTO run(id,ts,day,account_id,activity_id,status) VALUES(101,'now','today','a','act','OK')").run();
  sqlite.prepare("INSERT INTO gain_event(run_id,source,units) VALUES(101,'task',7)").run();
  sqlite.prepare("INSERT INTO model_call(ts,run_id,caller,model,total_tokens) VALUES('now',101,'test','offline',13)").run();
  sqlite.prepare("INSERT INTO cost_event(run_id,kind,calls,total_tokens) VALUES(101,'query',1,13)").run();
  sqlite.prepare("INSERT INTO run(id,ts,day,account_id,activity_id,status) VALUES(?,'wrong','today','a','act','ERROR')").run(id);
  sqlite.prepare("INSERT INTO gain_event(run_id,source,units) VALUES(?,'wrong',999)").run(id);
  sqlite.prepare('UPDATE job SET run_id=101 WHERE id=?').run(id);
  const child = spawn(process.execPath, ['--import', tsxLoader, fileURLToPath(new URL('../server/panel.ts',import.meta.url))], {
    cwd: dir,
    env: { ...process.env, PANEL_HOST: '127.0.0.1', PANEL_PORT: '0' }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  try {
    const port = await new Promise<string>((resolve, reject) => {
      let out = '';
      child.stdout.on('data', (chunk) => { out += chunk; const m = out.match(/127\.0\.0\.1:(\d+)/); if (m) resolve(m[1]); });
      child.once('error', reject);
      child.once('exit', (code) => reject(new Error(`panel exited ${code}: ${stderr}`)));
    });
    const detail = await (await fetch(`http://127.0.0.1:${port}/api/run/${id}`)).json() as any;
    assert.equal(detail.run_id, 101);
    assert.equal(detail.run.id, 101);
    assert.equal(detail.gain[0].units, 7);
    assert.equal(detail.cost.calls[0].tokens, 13);
    assert.equal(detail.cost.by_intent[0].total_tokens, 13);
    sqlite.prepare('UPDATE job SET run_id=NULL WHERE id=?').run(id);
    const unlinked = await (await fetch(`http://127.0.0.1:${port}/api/run/${id}`)).json() as any;
    assert.equal(unlinked.run, null);
    assert.deepEqual(unlinked.gain, []);
    assert.deepEqual(unlinked.cost, { calls: [], by_intent: [] });
    assert.equal((await fetch(`http://127.0.0.1:${port}/api/overview`)).status, 200);
  } finally {
    child.kill('SIGTERM');
    await new Promise((resolve) => child.once('exit', resolve));
  }
});



test('worker claims only one job, records the real run id, and interrupts dead owners without retry', async () => {
  fixture();
  const queue = jobs.createJobQueue(sqlite);
  assert.equal(typeof queue.claim, 'function', 'atomic claim exists');
  const first = queue.enqueue({ kind: 'run', activityId: 'act', maxAttempt: 1 });
  const second = queue.enqueue({ kind: 'plan', activityId: 'act', maxAttempt: 1 });
  const claimed = queue.claim();
  assert.equal(claimed.id, first);
  assert.equal(claimed.attempt, 1);
  assert.equal(queue.claim(), null, 'a living running owner blocks another claim');
  sqlite.prepare("INSERT INTO run(id,ts,day,account_id,activity_id,status) VALUES(101,'now','today','a','act','OK')").run();
  assert.throws(() => queue.finish({ ...claimed, lease_token: 'wrong' }, { ok: true, runId: 101 }), /lease/i);
  queue.finish(claimed, { ok: true, status: 'OK', runId: 101 });
  assert.equal((sqlite.prepare('SELECT run_id FROM job WHERE id=?').get(first) as any).run_id, 101);
  const next = queue.claim();
  assert.equal(next.id, second);
  sqlite.prepare('UPDATE job SET worker_pid=NULL WHERE id=?').run(second);
  assert.equal(queue.recoverInterrupted(), 1);
  const interrupted = sqlite.prepare('SELECT * FROM job WHERE id=?').get(second) as any;
  assert.equal(interrupted.status, 'interrupted');
  assert.equal(interrupted.attempt, 1);
  assert.equal(queue.claim(), null);
});

test('standalone worker consumes serially, persists failures, and rechecks account before dispatch', async () => {
  const worker: any = await import('../server/worker').catch((e) => { if (e.code === 'ERR_MODULE_NOT_FOUND') return {}; throw e; });
  assert.equal(typeof worker.createJobWorker, 'function', 'standalone consumer exists');
  fixture();
  const queue = jobs.createJobQueue(sqlite);
  const first = queue.enqueue({ kind: 'run', activityId: 'act', maxAttempt: 1 });
  const second = queue.enqueue({ kind: 'plan', activityId: 'act', maxAttempt: 1 });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const calls: string[] = [];
  const consume = worker.createJobWorker(queue, async (job: any) => {
    calls.push(job.kind);
    if (job.kind === 'run') { await gate; return { ok: true, status: 'OK', runId: 101 }; }
    throw new Error('offline failure');
  });
  sqlite.prepare("INSERT INTO run(id,ts,day,account_id,activity_id,status) VALUES(101,'now','today','a','act','OK')").run();
  const running = consume.consumeNext();
  assert.equal(await consume.consumeNext(), false);
  assert.deepEqual(calls, ['run']);
  release();
  assert.equal(await running, true);
  assert.equal(await consume.consumeNext(), true);
  assert.equal((sqlite.prepare('SELECT run_id FROM job WHERE id=?').get(first) as any).run_id, 101);
  const failed = sqlite.prepare('SELECT * FROM job WHERE id=?').get(second) as any;
  assert.equal(failed.status, 'failed');
  assert.match(failed.error, /offline failure/);
  assert.equal(failed.attempt, 1);
  const moved = queue.enqueue({ kind: 'run', activityId: 'act', maxAttempt: 1 });
  sqlite.prepare("UPDATE activity SET account_id='other' WHERE id='act'").run();
  await consume.consumeNext();
  assert.equal((sqlite.prepare('SELECT status FROM job WHERE id=?').get(moved) as any).status, 'failed');
  assert.deepEqual(calls, ['run', 'plan'], 'invalid target never reaches executor');
});

test('invalid executor runId fails the job instead of leaving a living worker stuck', async () => {
  fixture();
  const queue = jobs.createJobQueue(sqlite);
  const id = queue.enqueue({ kind: 'run', activityId: 'act', maxAttempt: 1 });
  const { createJobWorker } = await import('../server/worker');
  const worker = createJobWorker(queue, async () => ({ ok: true, runId: 99999 }));
  await worker.consumeNext();
  const job = sqlite.prepare('SELECT * FROM job WHERE id=?').get(id) as any;
  assert.equal(job.status, 'failed');
  assert.equal(job.run_id, null);
  assert.match(job.error, /runId/);
  assert.equal(await worker.consumeNext(), false);
});

test('empty standalone worker CLI exits without importing a phone runner', async () => {
  fixture();
  const child = spawn(process.execPath, ['--import', tsxLoader, fileURLToPath(new URL('../server/worker.ts',import.meta.url)), '--once'], {
    cwd: dir, env: process.env, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '', stderr = '';
  child.stdout.on('data', (data) => { stdout += data; });
  child.stderr.on('data', (data) => { stderr += data; });
  const code = await new Promise((resolve, reject) => { child.once('exit', resolve); child.once('error', reject); });
  assert.equal(code, 0, stderr);
  assert.match(stdout, /interrupted=0/);
  assert.equal((sqlite.prepare('SELECT COUNT(*) n FROM run').get() as any).n, 0);
});

test('a killed queue owner becomes interrupted while the next queued job survives', async () => {
  fixture();
  const queue = jobs.createJobQueue(sqlite);
  const first = queue.enqueue({ kind: 'run', activityId: 'act', maxAttempt: 1 });
  const second = queue.enqueue({ kind: 'plan', activityId: 'act', maxAttempt: 1 });
  const child = spawn(process.execPath, ['--import', tsxLoader, '--input-type=module', '-e', `
    import { sqlite } from ${JSON.stringify(new URL('../db/client.ts', import.meta.url).href)};
    import { createJobQueue } from ${JSON.stringify(new URL('../server/jobs.ts', import.meta.url).href)};
    console.log(JSON.stringify(createJobQueue(sqlite).claim())); setInterval(() => {}, 1000);
  `], { cwd:dir, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    const claimed = await new Promise<any>((resolve, reject) => {
      child.stdout.once('data', (data) => resolve(JSON.parse(String(data))));
      child.once('error', reject);
      child.once('exit', (code) => reject(new Error(`claim child exited ${code}`)));
    });
    assert.equal(claimed.id, first);
    assert.equal(queue.claim(), null, 'live process owns the single consumer slot');
  } finally {
    child.kill('SIGKILL');
    await new Promise((resolve) => child.once('exit', resolve));
  }
  assert.equal(queue.recoverInterrupted(), 1);
  assert.equal((sqlite.prepare('SELECT status FROM job WHERE id=?').get(first) as any).status, 'interrupted');
  const next = queue.claim();
  assert.equal(next.id, second);
  queue.finish(next, { ok: false, status: 'OFFLINE' });
});

function fixture() {
  sqlite.exec('DELETE FROM job; DELETE FROM model_call; DELETE FROM gain_event; DELETE FROM cost_event; DELETE FROM run; DELETE FROM activity; DELETE FROM account;');
  sqlite.prepare('INSERT INTO account(id,app,package,cache_id) VALUES(?,?,?,?)').run('a', 'test', 'test.app', 'test');
  sqlite.prepare('INSERT INTO activity(id,account_id,name,steps_json,verify_any) VALUES(?,?,?,?,?)').run('act', 'a', 'Activity', '[]', 'ok');
}

test('enqueue persists a queued job without starting execution and rejects another account', () => {
  assert.equal(dbPath, process.env.CHECKIN_DB_PATH);
  assert.equal(typeof jobs.createJobQueue, 'function', 'persistent queue is available');
  fixture();
  const queue = jobs.createJobQueue(sqlite);
  const id = queue.enqueue({ kind: 'run', activityId: 'act', accountId: 'a', payload: {}, maxAttempt: 1 });
  const row = sqlite.prepare('SELECT * FROM job WHERE id=?').get(id) as any;
  assert.equal(row.status, 'queued');
  assert.equal(row.attempt, 0);
  assert.equal(row.max_attempt, 1);
  assert.equal(row.run_id, null);
  assert.throws(() => queue.enqueue({ kind: 'run', activityId: 'act', accountId: 'other', maxAttempt: 1 }), /account/i);
  assert.throws(() => queue.enqueue({ kind: 'run', activityId: 'act', maxAttempt: 2 }), /maxAttempt/i);
  assert.equal((sqlite.prepare('SELECT COUNT(*) n FROM job').get() as any).n, 1);
});
