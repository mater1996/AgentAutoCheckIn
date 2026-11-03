import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { AdbOcrDevice, type DeviceExec } from '../runner/staged/device.ts';
import { createStagedRuntime } from '../runner/staged/runtime.ts';

const failedRoot = new URL('../evidence/staged-2026-11-01T18-01-26-451Z/device-command-evidence/', import.meta.url);
const goodRoot = new URL('../evidence/staged-2026-11-01T17-44-14-464Z/device-command-evidence/', import.meta.url);
const load = async (root: URL, name: string) => JSON.parse(await readFile(new URL(name, root), 'utf8'));
const originalMissing = await load(failedRoot, 'foreground-4067c9ce-93a2-4ffb-8ace-51176108a9fb.json');
// Synthetic missing-marker variant: the immutable original now has supported
// explicit resumed markers. Remove only those lines for the recovery scenarios.
const missing = { ...originalMissing, stdout: originalMissing.stdout.split('\n').filter((line: string) => !/^[ \t]*(?:ResumedActivity|Resumed):/.test(line)).join('\n') };
const good = await load(goodRoot, 'foreground-34cb24a9-8436-4a5c-a0c7-3628f0b68f2b.json');
const resolved = await load(failedRoot, 'launch-resolve-c3723684-3ad8-4bda-b8b8-9e7409e70285.json');
const started = await load(failedRoot, 'launch-start-e4437494-2e87-4ef5-8640-55ccabf95763.json');
const home = await load(failedRoot, 'foreground-ac07e4ed-e912-49a0-a0cd-ec2393c8b17d.json');
const owner = { package: 'com.taobao.taobao', userId: 0 };
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');

async function fixture(fn: (h: ReturnType<typeof harness>) => Promise<void>, options: Parameters<typeof harness>[1] = {}) {
  const dir = await mkdtemp(join(process.env.TMPDIR!, 'launch-transition-'));
  try { await fn(harness(dir, options)); } finally { await rm(dir, { recursive: true, force: true }); }
}
function harness(dir: string, options: { reads?: (index: number, limits?: { timeoutMs: number }) => Promise<string> | string; startError?: Error; startRaw?: string; ocrError?: boolean; verification?: boolean; badPNG?: boolean; liveTime?: boolean } = {}) {
  let reads = 0, clock = 0, launched = false;
  const origin = performance.now();
  const calls: { file: string; args: string[]; timeoutMs?: number; clock: number }[] = [];
  const exec: DeviceExec = async (file, args, limits) => {
    calls.push({ file, args, timeoutMs: limits?.timeoutMs, clock });
    if (file === 'offline-ocr') {
      if (options.ocrError) throw Error('offline OCR failure');
      await writeFile(args[0], JSON.stringify({ pages: [{ file: args[1], width: 1, height: 1, lines: launched && options.verification ? [{ text: '请完成验证', bounds: [0, 0, 1, 1] }] : [] }] }));
      return { stdout: '' };
    }
    assert.equal(file, 'adb'); assert.equal(args[1], 'offline');
    if (args.includes('resolve-activity')) return { stdout: resolved.stdout, stderr: resolved.stderr };
    if (args.includes('start')) { if (options.startError) throw options.startError; launched = true; return { stdout: options.startRaw ?? started.stdout, stderr: started.stderr }; }
    if (args.includes('activities')) { reads++; return { stdout: await (options.reads?.(reads, limits) ?? (reads === 1 ? missing.stdout : good.stdout)), stderr: 'offline warning\n' }; }
    if (args.includes('screencap')) return { stdout: launched && options.badPNG ? Buffer.from('invalid') : png };
    throw Error('Forbidden offline command ' + args.join(' '));
  };
  const device = new AdbOcrDevice({ serial: 'offline', evidenceDir: dir, ocrBinary: 'offline-ocr', exec, monotonic: () => clock + performance.now() - origin, now: options.liveTime ? Date.now : () => 123 + clock });
  return { device, dir, calls, get reads() { return reads; }, setClock(value: number) { clock = value; }, launch: () => device.act({ type: 'launch', ...owner }) };
}
for (const [name, raw] of [
  ['ambiguous', good.stdout + '\ntopResumedActivity=ActivityRecord{x u999 com.taobao.taobao/.Main}'],
  ['malformed', 'topResumedActivity=null\n' + good.stdout.replaceAll('topResumedActivity=', 'oldActivity=')],
  ['foreign package', good.stdout.replaceAll('com.taobao.taobao', 'com.foreign.app')],
  ['foreign user', good.stdout.replaceAll('u0 ', 'u999 ')],
  ['invalid', 'topResumedActivity=ActivityRecord{x u0 invalid/.Main}'],
] as const) test(name + ' stops immediately and capture retry cannot reopen the launch confirmation', async () => {
  await fixture(async h => {
    await h.launch();
    await assert.rejects(h.device.capture(), /Foreground|foreground/);
    const count = h.calls.length;
    await assert.rejects(h.device.capture(), /Foreground|foreground/);
    assert.equal(h.calls.length, count, 'terminal uncertainty must not perform a second read');
    assert.equal(h.reads, 1); assert.ok(!h.calls.some(c => c.args.includes('screencap')));
    const report = await transition(h.dir);
    assert.equal(report.status, 'unknown'); assert.deepEqual(report.waits, []);
    assert.equal((await records(h.dir)).filter(r => r.kind === 'launch-start').length, 1);
  }, { reads: () => raw });
});

test('without a successful start synthetic missing-marker raw is never retried', async () => {
  await fixture(async h => {
    await assert.rejects(h.device.capture(), /Foreground/);
    assert.equal(h.reads, 1); assert.ok(!h.calls.some(c => c.args.includes('screencap')));
    assert.ok(!(await readdir(h.dir)).some(n => n.startsWith('launch-transition-')));
  });
});

for (const failure of ['exec', 'denial']) test('unsuccessful start ' + failure + ' grants no confirmation allowance', async () => {
  const error = Error('offline start exec failure');
  await fixture(async h => {
    await assert.rejects(h.launch(), failure === 'exec' ? e => e === error : /Device action failed/);
    await assert.rejects(h.device.capture(), /Foreground/);
    assert.equal(h.reads, 1); assert.equal(h.calls.filter(c => c.args.includes('start')).length, 1);
    assert.ok(!(await readdir(h.dir)).some(n => n.startsWith('launch-transition-')));
  }, failure === 'exec' ? { startError: error } : { startRaw: 'Error: Permission Denial' });
});

test('missing markers exhaust exactly one reread and remain unknown on capture retry', async () => {
  await fixture(async h => {
    await h.launch(); await assert.rejects(h.device.capture(), /Foreground/);
    const count = h.calls.length;
    await assert.rejects(h.device.capture(), /Foreground/);
    assert.equal(h.calls.length, count); assert.equal(h.reads, 2);
    const report = await transition(h.dir);
    assert.equal(report.status, 'unknown'); assert.equal(report.waits.length, 1);
    assert.equal((await records(h.dir)).filter(r => r.status === 'missing').length, 2);
  }, { reads: () => missing.stdout });
});

for (const phase of ['initial', 'reread']) test('exec timeout during ' + phase + ' preserves output and stops', async () => {
  const error = Object.assign(Error('offline timeout'), { code: 'ETIMEDOUT', stdout: missing.stdout, stderr: 'partial stderr', killed: true });
  await fixture(async h => {
    await h.launch(); await assert.rejects(h.device.capture(), e => e === error);
    await assert.rejects(h.device.capture(), e => e === error);
    assert.equal(h.reads, phase === 'initial' ? 1 : 2);
    const failed = (await records(h.dir)).find(r => r.status === 'exec_error');
    assert.equal(failed.stdout, missing.stdout); assert.equal(failed.stderr, 'partial stderr');
    assert.ok(failed.timeoutMs > 0 && failed.timeoutMs <= 1500);
    assert.equal((await transition(h.dir)).status, 'unknown');
  }, { reads: i => { if (phase === 'reread' && i === 1) return missing.stdout; throw error; } });
});

for (const mode of ['expired before capture', 'late owner', 'late missing', 'insufficient wait budget']) test(mode + ' cannot reset the start deadline', async () => {
  let h: ReturnType<typeof harness>;
  await fixture(async value => {
    h = value; await h.launch();
    if (mode === 'expired before capture') h.setClock(1500);
    await assert.rejects(h.device.capture(), /deadline|budget/);
    const count = h.calls.length; await assert.rejects(h.device.capture(), /deadline|budget/);
    assert.equal(h.calls.length, count);
    assert.equal(h.reads, mode === 'expired before capture' ? 0 : 1);
    assert.deepEqual((await transition(h.dir)).waits, []);
  }, { reads: () => { h.setClock(mode === 'insufficient wait budget' ? 1300 : 1500); return mode === 'late owner' ? good.stdout : missing.stdout; } });
});

test('reread receives only remaining budget and late owner is rejected', async () => {
  let h: ReturnType<typeof harness>;
  await fixture(async value => {
    h = value; await h.launch();
    await assert.rejects(h.device.capture(), /deadline/);
    assert.equal(h.reads, 2);
    const reads = h.calls.filter(c => c.args.includes('activities'));
    assert.ok(reads[1].timeoutMs! <= 650, 'initial read and 250ms wait consume one deadline');
    assert.equal((await transition(h.dir)).status, 'unknown');
  }, { reads: i => { h.setClock(i === 1 ? 600 : 1500); return i === 1 ? missing.stdout : good.stdout; } });
});

test('foreground exec is drained before device exclusivity is released', async () => {
  let reject!: (error: Error) => void, entered!: () => void;
  const ready = new Promise<void>(resolve => { entered = resolve; });
  const error = Error('late exec drained');
  await fixture(async h => {
    await h.launch(); let settled = false;
    const pending = h.device.capture().finally(() => { settled = true; });
    await ready; h.setClock(2000);
    await assert.rejects(h.device.capture(), /busy/); await assert.rejects(h.device.act({ type: 'back' }), /busy/);
    assert.equal(settled, false);
    reject(error); await assert.rejects(pending, e => e === error);
    assert.equal((await records(h.dir)).filter(r => r.status === 'exec_error').length, 1);
    assert.equal((await transition(h.dir)).status, 'unknown');
  }, { reads: () => { entered(); return new Promise((_resolve, fail) => { reject = fail; }); } });
});

test('successful confirmation never refreshes an old frame and still requires normal PNG/OCR checks', async () => {
  for (const options of [{ ocrError: true }, { badPNG: true }]) await fixture(async h => {
    const old = { id: 'old', path: 'old.png', width: 1, height: 1, capturedAt: 123, lines: [], ...owner };
    (h.device as any).currentFrame = structuredClone(old);
    await h.launch(); await assert.rejects(h.device.capture(), /OCR|PNG/);
    await assert.rejects(h.device.act({ type: 'tap', x: 0, y: 0 }, old), /Frame/);
    assert.equal((await transition(h.dir)).status, 'foreground_confirmed');
    assert.equal(h.calls.filter(c => c.args.includes('start')).length, 1);
  }, options);
});

for (const verification of [false, true]) test('real runtime confirms fresh target and preserves verification risk=' + verification, async () => {
  await fixture(async h => {
    const cfg = { localLaunch: true, scriptValidationMode: true, ...owner,
      scope: { appId: 'offline', accountId: 'offline', activityId: 'offline', userId: 0 }, constraints: [],
      limits: { stageMs: 3000, stageActions: 3, agentCalls: 0 }, stages: { open_app: { goal: 'Open', checkpoint: 'app' } } };
    const runtime = createStagedRuntime(cfg, h.device, { query: async () => { throw Error('Forbidden model'); } }, { sessionId: 'offline', evidenceDir: h.dir, plan: [] });
    const result = await runtime.stage('open_app', {});
    assert.equal(result.status === 'completed', !verification, JSON.stringify(result));
    assert.equal(h.calls.filter(c => c.args.includes('start')).length, 1);
    assert.equal((await transition(h.dir)).status, 'foreground_confirmed');
    if (verification) assert.ok(JSON.stringify(result).includes('Login/verification'));
  }, { reads: i => i <= 2 ? home.stdout : i === 3 ? missing.stdout : good.stdout, verification, liveTime: true });
});

test('real runtime keeps exhausted launch unknown across observation retry and stage reentry', async () => {
  await fixture(async h => {
    const cfg = { localLaunch: true, scriptValidationMode: true, ...owner,
      scope: { appId: 'offline', accountId: 'offline', activityId: 'offline', userId: 0 }, constraints: [],
      limits: { stageMs: 3000, stageActions: 3, agentCalls: 0 }, stages: { open_app: { goal: 'Open', checkpoint: 'app' } } };
    const runtime = createStagedRuntime(cfg, h.device, { query: async () => { throw Error('Forbidden model'); } }, { sessionId: 'offline-unknown', evidenceDir: h.dir, plan: [] });
    const result = await runtime.stage('open_app', {});
    assert.equal(result.status, 'unknown'); assert.equal(result.actions[0].status, 'unknown');
    assert.equal(h.reads, 4, 'home capture twice, missing twice, no observation retry read');
    await runtime.stage('open_app', {});
    assert.equal(h.reads, 4); assert.equal(h.calls.filter(c => c.args.includes('start')).length, 1);
    assert.equal((await records(h.dir)).filter(r => r.kind === 'launch-start' && r.status === 'success').length, 1);
    assert.equal((await transition(h.dir)).status, 'unknown');
  }, { reads: i => i <= 2 ? home.stdout : missing.stdout, liveTime: true });
});

for (const raw of [
  good.stdout + '\ntopResumedActivity=ActivityRecord{x u999 com.taobao.taobao/.Main}',
  'topResumedActivity=null', good.stdout.replaceAll('u0 ', 'u999 '),
]) test('invalid confirmation reread never gets a third read', async () => {
  await fixture(async h => {
    await h.launch(); await assert.rejects(h.device.capture(), /Foreground|foreground/);
    await assert.rejects(h.device.capture(), /Foreground|foreground/);
    assert.equal(h.reads, 2); assert.equal((await transition(h.dir)).status, 'unknown');
  }, { reads: i => i === 1 ? missing.stdout : raw });
});

test('ordinary post-PNG owner check remains strict after successful confirmation', async () => {
  await fixture(async h => {
    await h.launch(); await assert.rejects(h.device.capture(), /Foreground changed during capture/);
    assert.equal(h.reads, 3); assert.ok(h.calls.some(c => c.args.includes('screencap')));
    assert.ok(!h.calls.some(c => c.file === 'offline-ocr'));
    assert.equal((await transition(h.dir)).status, 'foreground_confirmed');
  }, { reads: i => i === 1 ? missing.stdout : i === 2 ? good.stdout : home.stdout });
});

test('missing evidence write failure cannot authorize a reread', async () => {
  await fixture(async h => {
    await h.launch();
    const base = join(h.dir, 'device-command-evidence');
    await rm(base, { recursive: true }); await writeFile(base, 'offline write barrier');
    await assert.rejects(h.device.capture(), /Foreground/);
    assert.equal(h.reads, 1);
    const count = h.calls.length; await assert.rejects(h.device.capture(), /Foreground/);
    assert.equal(h.calls.length, count); assert.deepEqual((await transition(h.dir)).waits, []);
  });
});

test('already valid owner is not delayed or reread and allowance is consumed', async () => {
  await fixture(async h => {
    await h.launch(); await h.device.capture();
    assert.equal(h.reads, 2); assert.deepEqual((await transition(h.dir)).waits, []);
    await assert.rejects(h.device.capture(), /Foreground/);
    assert.equal(h.reads, 3);
    assert.equal((await records(h.dir)).filter(r => r.kind === 'launch-start').length, 1);
  }, { reads: i => i <= 2 ? good.stdout : missing.stdout });
});

test('transition evidence persistence cannot extend the owner acceptance deadline', async () => {
  await fixture(async h => {
    await h.launch();
    const save = (h.device as any).save.bind(h.device);
    (h.device as any).save = async (name: string, value: unknown) => {
      if (name.startsWith('launch-transition-')) h.setClock(1500);
      await save(name, value);
    };
    await assert.rejects(h.device.capture(), /deadline/);
    assert.equal(h.reads, 1); assert.ok(!h.calls.some(c => c.args.includes('screencap')));
    assert.equal((await transition(h.dir)).status, 'unknown');
  }, { reads: () => good.stdout });
});

async function records(dir: string) {
  return Promise.all((await readdir(join(dir, 'device-command-evidence'))).map(async name => JSON.parse(await readFile(join(dir, 'device-command-evidence', name), 'utf8'))));
}
async function transition(dir: string) {
  const names = (await readdir(dir)).filter(name => /^launch-transition-.*\.json$/.test(name));
  assert.equal(names.length, 1);
  return JSON.parse(await readFile(join(dir, names[0]), 'utf8'));
}

// Cross-run synthetic ordering: explicit resumed lines removed from the original
// failed dump, followed by a real earlier strict-owner dump; no historical recovery.
test('recorded successful start permits one synthetic missing-marker wait/read then ordinary fresh capture', async () => {
  assert.equal(originalMissing.status, 'missing'); assert.equal(good.status, 'success');
  assert.match(originalMissing.stdout, /ResumedActivity:.*com\.taobao\.taobao/);
  assert.doesNotMatch(missing.stdout, /^[ \t]*(?:ResumedActivity|Resumed):/m);
  assert.match(missing.stdout, /mFocusedApp=.*com\.miui\.home/);
  await fixture(async h => {
    await h.launch();
    assert.equal(h.calls.length, 2, 'act does not capture or launch again');
    const frame = await h.device.capture();
    assert.equal(frame.package, owner.package); assert.equal(frame.userId, owner.userId);
    assert.equal(h.reads, 3, 'missing, confirmation, normal post-PNG check');
    const saved = await records(h.dir), fg = saved.filter(r => r.kind === 'foreground');
    assert.equal(fg.length, 3); assert.ok(fg.some(r => r.status === 'missing' && r.stdout === missing.stdout));
    assert.equal(fg.filter(r => r.stdout === good.stdout).length, 2);
    assert.equal(saved.filter(r => r.kind === 'launch-start').length, 1);
    const bounded = h.calls.filter(c => c.args.includes('activities')).slice(0, 2);
    assert.ok(bounded.every(c => c.timeoutMs! > 0 && c.timeoutMs! <= 1500));
    const report = await transition(h.dir);
    assert.equal(report.status, 'foreground_confirmed'); assert.equal(report.budgetMs, 1500);
    assert.equal(report.waits.length, 1); assert.equal(report.waits[0].reason, 'post_launch_foreground_markers_missing');
    assert.equal(report.waits[0].ms, 250); assert.equal(report.completionInferred, false);
    await assert.rejects(h.device.act({ type: 'tap', x: 0, y: 0 }, { ...frame, id: 'forged' }), /Frame/);
  });
});
