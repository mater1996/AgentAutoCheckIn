import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AdbOcrDevice, type DeviceExec } from '../runner/staged/device.ts';

test('exec rejection saves partial output after actual completion and rethrows the same error once', async () => {
  await fixture(async dir => {
    const error = Object.assign(Error('original timeout'), { stdout: Buffer.from('partial dump'), stderr: 'dump failed\n', code: 'ETIMEDOUT', killed: true });
    let reject!: (e: unknown) => void, calls = 0;
    const d = new AdbOcrDevice({ serial: 'offline', evidenceDir: dir, exec: () => { calls++; return new Promise((_r, r) => { reject = r; }); } });
    let settled = false;
    const pending = (d as any).foreground(77).finally(() => { settled = true; });
    await Promise.resolve(); assert.equal(settled, false);
    reject(error);
    await assert.rejects(pending, e => e === error);
    const [saved] = await records(dir);
    assert.equal(calls, 1); assert.equal(saved.status, 'exec_error'); assert.equal(saved.stdout, 'partial dump');
    assert.equal(saved.stderr, 'dump failed\n'); assert.equal(saved.result.code, 'ETIMEDOUT');
    assert.ok(Array.isArray(saved.topCandidates)); assert.ok(Array.isArray(saved.resumedCandidates));
  });
});

test('launch records resolve and start for the exact user without replaying failures', async () => {
  for (const mode of ['success', 'resolve missing', 'resolve exec', 'start exec', 'start denial']) await fixture(async dir => {
    const calls: string[][] = [];
    const failure = Object.assign(Error('original exec failure'), { stdout: 'partial output', stderr: 'raw exec stderr', code: 1 });
    const exec: DeviceExec = async (_file, args) => {
      calls.push(args);
      if (args.includes('resolve-activity')) {
        if (mode === 'resolve exec') throw failure;
        return { stdout: mode === 'resolve missing' ? 'No activity found\n' : 'test.app/.Launcher\n', stderr: 'resolve warning\n' };
      }
      if (mode === 'start exec') throw failure;
      return { stdout: mode === 'start denial' ? 'Error: permission denied\n' : 'Starting: Intent\n', stderr: 'start warning\n' };
    };
    const d = new AdbOcrDevice({ serial: 'offline', evidenceDir: dir, exec });
    const pending = d.act({ type: 'launch', package: 'test.app', userId: 999 });
    if (mode === 'success') await pending;
    else if (mode.endsWith('exec')) await assert.rejects(pending, e => e === failure);
    else await assert.rejects(pending, { message: mode === 'resolve missing' ? 'Launcher component missing or ambiguous' : 'Device action failed' });
    const saved = await records(dir);
    assert.equal(calls.length, mode.startsWith('resolve') ? 1 : 2);
    assert.equal(saved.length, calls.length);
    for (const r of saved) {
      assert.ok(r.command.args.includes('999')); assert.equal(r.command.file, 'adb');
      assert.equal(typeof r.startedAt, 'number'); assert.equal(typeof r.endedAt, 'number');
      assert.equal(r.timeoutMs, 60000); assert.ok(!('env' in r));
      if (r.status === 'exec_error') { assert.equal(r.stdout, 'partial output'); assert.equal(r.stderr, 'raw exec stderr'); }
      else assert.equal(r.stderr, r.kind === 'launch-resolve' ? 'resolve warning\n' : 'start warning\n');
    }
    if (calls.length === 2) assert.deepEqual(calls[1], ['-s', 'offline', 'shell', 'am', 'start', '--user', '999', '-n', 'test.app/.Launcher']);
  });
});

test('foreground evidence bookkeeping consumes the same continuous-scroll deadline before dispatch', async () => {
  await fixture(async dir => {
    let clock = 0;
    const calls: { args: string[]; timeoutMs?: number }[] = [];
    const d = new AdbOcrDevice({ serial: 'offline', evidenceDir: dir, monotonic: () => clock,
      now: () => { clock += 100; return 123; }, exec: async (_file, args, limits) => {
        calls.push({ args, timeoutMs: limits?.timeoutMs });
        return { stdout: 'topResumedActivity=ActivityRecord{x u999 test.app/.Main}' };
      } });
    const frame = { id: 'offline-frame', path: 'offline.png', width: 1, height: 1, capturedAt: 123, lines: [], package: 'test.app', userId: 999 };
    (d as any).currentFrame = structuredClone(frame);
    await d.scrollContinuously({ type: 'swipe', fromX: 0, fromY: 0, toX: 0, toY: 0, ms: 900 }, frame, { maxSwipes: 3, maxMs: 1000 });
    assert.equal(calls.length, 1); assert.equal(calls[0].timeoutMs, 100);
    assert.ok(calls[0].args.includes('activities'));
    assert.equal((await records(dir)).length, 1);
    const log = JSON.parse(await readFile(join(dir, 'continuous-scroll.json'), 'utf8'));
    assert.equal(log.stopReason, 'budget_exhausted'); assert.equal(log.dispatchedSwipes, 0);
  });
});

async function fixture(fn: (dir: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), 'foreground-evidence-'));
  try { await fn(dir); } finally { await rm(dir, { recursive: true, force: true }); }
}
async function records(dir: string) {
  const base = join(dir, 'device-command-evidence');
  return Promise.all((await readdir(base)).map(async name => JSON.parse(await readFile(join(base, name), 'utf8'))));
}

test('foreground preserves every raw result and classifies without falling back from a present top marker', async () => {
  await fixture(async dir => {
    const cases = [
      ['', 'missing', 'Foreground missing or ambiguous'],
      ['topResumedActivity=null\nmResumedActivity: ActivityRecord{x u0 old.app/.Old}', 'malformed', 'Foreground missing or ambiguous'],
      ['topResumedActivity=ActivityRecord{x u999 test.app/.Main}\ntopResumedActivity=ActivityRecord{y u0 test.app/.Main}', 'ambiguous', 'Foreground missing or ambiguous'],
      ['topResumedActivity=ActivityRecord{x u0 invalid/.Main}', 'invalid', 'Invalid foreground identity'],
      ['mResumedActivity: ActivityRecord{x u999 test.app/.Main}', 'success', ''],
    ];
    for (const [stdout, status, message] of cases) {
      let clock = 100;
      const d = new AdbOcrDevice({ serial: 'offline', evidenceDir: dir, now: () => clock,
        exec: async () => { clock = 120; return { stdout: Buffer.from(stdout), stderr: Buffer.from('raw warning\n') }; } });
      if (message) await assert.rejects((d as any).foreground(321), { message });
      else assert.deepEqual(await (d as any).foreground(321), { package: 'test.app', userId: 999 });
      const saved = (await records(dir)).find(r => r.stdout === stdout)!;
      assert.ok(saved); assert.equal(saved.status, status); assert.equal(saved.stderr, 'raw warning\n');
      assert.equal(saved.startedAt, 100); assert.equal(saved.endedAt, 120); assert.equal(saved.timeoutMs, 321);
      assert.deepEqual(saved.command, { file: 'adb', args: ['-s', 'offline', 'shell', 'dumpsys', 'activity', 'activities'] });
      assert.ok(Array.isArray(saved.topCandidates)); assert.ok(Array.isArray(saved.resumedCandidates));
    }
    assert.equal((await records(dir)).length, cases.length);
  });
});
