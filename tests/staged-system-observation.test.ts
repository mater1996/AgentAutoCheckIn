import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { AdbOcrDevice, type DeviceExec } from '../runner/staged/device.ts';
import { readForegroundObservation, type ForegroundObservationRecord } from '../runner/staged/system-observation.ts';

const source = new URL('../evidence/staged-2026-11-02T01-25-13-762Z/device-command-evidence/foreground-490c9ba8-f40e-48d3-b362-c77d12f067d7.json', import.meta.url);
const saved = JSON.parse(await readFile(source, 'utf8'));

test('extracts Activity and task only from the selected resumed marker in the saved run223 dump', () => {
  assert.deepEqual(readForegroundObservation(saved.stdout), {
    marker: 'topResumedActivity', activity: 'com.taobao.taobao/com.taobao.tao.TBMainActivity', taskId: 246,
  });
});

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');

for (const [name, raw, expected] of [
  ['missing markers ignore background and Intent', 'ActivityRecord{x u0 other.app/.Background t9}\nIntent { cmp=other.app/.Intent dat=https://private.invalid/?token=secret }', { marker: null, activity: null, taskId: null }],
  ['malformed top never borrows resumed', 'topResumedActivity=null\nmResumedActivity: ActivityRecord{x u0 test.app/.Old t1}', { marker: 'topResumedActivity', activity: null, taskId: null }],
  ['ambiguous activity remains null', 'topResumedActivity=ActivityRecord{x u0 test.app/.One t1}\ntopResumedActivity=ActivityRecord{y u0 test.app/.Two t1}', { marker: 'topResumedActivity', activity: null, taskId: null }],
  ['ambiguous task remains null', 'topResumedActivity=ActivityRecord{x u0 test.app/.One t1}\ntopResumedActivity=ActivityRecord{y u0 test.app/.One t2}', { marker: 'topResumedActivity', activity: 'test.app/.One', taskId: null }],
  ['fallback uses resumed only', 'mResumedActivity: ActivityRecord{x u0 test.app/.Main t42}', { marker: 'mResumedActivity', activity: 'test.app/.Main', taskId: 42 }],
  ['absent task remains null', 'topResumedActivity=ActivityRecord{x u0 test.app/.Main}', { marker: 'topResumedActivity', activity: 'test.app/.Main', taskId: null }],
] as const) test('diagnostic observation: ' + name, () => {
  assert.deepEqual(readForegroundObservation(raw), expected);
});

for (const failure of ['OCR', 'package', 'user'] as const) test('failed capture preserves bound command sources without granting frame authority: ' + failure, async () => {
  const dir = await mkdtemp(join(process.env.TMPDIR!, 'system-observation-failure-'));
  try {
    let reads = 0, taps = 0;
    const device = new AdbOcrDevice({ serial: 'offline', evidenceDir: dir, ocrBinary: 'offline-ocr', exec: async (file, args) => {
      if (file === 'offline-ocr') throw Error('synthetic OCR failure');
      if (args.includes('activities')) {
        reads++;
        const raw = reads === 2 && failure === 'package' ? saved.stdout.replaceAll('com.taobao.taobao', 'other.app')
          : reads === 2 && failure === 'user' ? saved.stdout.replaceAll('u0 ', 'u999 ') : saved.stdout;
        return { stdout: raw };
      }
      if (args.includes('screencap')) return { stdout: png };
      taps++; throw Error('Unexpected dispatch');
    } });
    await assert.rejects(device.capture(), failure === 'OCR' ? /synthetic OCR failure/ : /Foreground changed during capture/);
    const names = (await readdir(dir)).filter(name => name.endsWith('.json'));
    assert.equal(names.length, 1);
    const frame = JSON.parse(await readFile(join(dir, names[0]), 'utf8'));
    assert.equal(frame.observationError, failure === 'OCR' ? 'OCR capture failed' : 'Foreground changed during capture');
    assert.ok(frame.systemObservation);
    for (const record of [frame.systemObservation.before, frame.systemObservation.after]) {
      const bytes = await readFile(record.source.path);
      assert.equal(record.source.sha256, createHash('sha256').update(bytes).digest('hex'));
    }
    await assert.rejects(device.act({ type: 'tap', x: 0, y: 0 }, frame), /Frame/);
    assert.equal(taps, 0); assert.equal(reads, 2);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

for (const execFails of [false, true]) test('command evidence write failure keeps original foreground error priority=' + execFails, async () => {
  const dir = await mkdtemp(join(process.env.TMPDIR!, 'system-observation-write-failure-'));
  try {
    await writeFile(join(dir, 'device-command-evidence'), 'write barrier');
    const original = Error('original command failure');
    let calls = 0;
    const device = new AdbOcrDevice({ serial: 'offline', evidenceDir: dir, exec: async () => {
      calls++; if (execFails) throw original; return { stdout: saved.stdout };
    } });
    await assert.rejects(device.capture(), error => execFails ? error === original : (error as NodeJS.ErrnoException).code === 'EEXIST');
    assert.equal(calls, 1);
    assert.deepEqual(await readdir(dir), ['device-command-evidence']);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('post-launch missing-marker reread binds only the successful before command and normal after command', async () => {
  const dir = await mkdtemp(join(process.env.TMPDIR!, 'system-observation-launch-'));
  try {
    let reads = 0;
    const device = new AdbOcrDevice({ serial: 'offline', evidenceDir: dir, ocrBinary: 'offline-ocr', exec: async (file, args) => {
      if (file === 'offline-ocr') {
        await writeFile(args[0], JSON.stringify({ pages: [{ file: args[1], width: 1, height: 1, lines: [] }] }));
        return { stdout: '' };
      }
      if (args.includes('resolve-activity')) return { stdout: 'com.taobao.taobao/.Launcher' };
      if (args.includes('start')) return { stdout: 'Starting: Intent' };
      if (args.includes('activities')) return { stdout: ++reads === 1 ? 'ActivityRecord{x u0 background.app/.Old t1}' : saved.stdout };
      assert.ok(args.includes('screencap')); return { stdout: png };
    } });
    await device.act({ type: 'launch', package: 'com.taobao.taobao', userId: 0 });
    const frame = await device.capture();
    assert.ok(frame.systemObservation); assert.equal(reads, 3);
    for (const record of [frame.systemObservation.before, frame.systemObservation.after]) {
      const bytes = await readFile(record.source.path), command = JSON.parse(bytes.toString());
      assert.equal(command.status, 'success'); assert.equal(command.stdout, saved.stdout);
      assert.equal(record.source.sha256, createHash('sha256').update(bytes).digest('hex'));
    }
    assert.notEqual(frame.systemObservation.before.source.path, frame.systemObservation.after.source.path);
    const commands = await Promise.all((await readdir(join(dir, 'device-command-evidence'))).map(async name => JSON.parse(await readFile(join(dir, 'device-command-evidence', name), 'utf8'))));
    assert.equal(commands.filter(c => c.status === 'missing').length, 1);
    assert.equal(commands.filter(c => c.kind === 'launch-start').length, 1);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('capture binds before/after observations to the two actual command files without extra ADB reads', async () => {
  const dir = await mkdtemp(join(process.env.TMPDIR!, 'system-observation-'));
  try {
    let clock = 100, reads = 0;
    const calls: { file: string; args: string[] }[] = [];
    const afterRaw = saved.stdout.replaceAll('com.taobao.tao.TBMainActivity', 'com.taobao.tao.OtherActivity').replaceAll('t246', 't247');
    const exec: DeviceExec = async (file, args) => {
      calls.push({ file, args });
      if (file === 'offline-ocr') {
        await writeFile(args[0], JSON.stringify({ pages: [{ file: args[1], width: 1, height: 1, lines: [] }] }));
        return { stdout: '' };
      }
      assert.equal(file, 'adb');
      if (args.includes('activities')) { clock += 10; return { stdout: ++reads === 1 ? saved.stdout : afterRaw }; }
      assert.ok(args.includes('screencap'));
      return { stdout: png };
    };
    const device = new AdbOcrDevice({ serial: 'offline', evidenceDir: dir, ocrBinary: 'offline-ocr', now: () => clock, exec });
    const frame = await device.capture();
    const system = frame.systemObservation;
    assert.ok(system, 'capture must expose its two system observation sources');
    assert.equal(system.version, 'android-system-v1');
    assert.deepEqual(Object.keys(system).sort(), ['after', 'before', 'version']);
    for (const [label, raw, activity, taskId, startedAt, endedAt] of [
      ['before', saved.stdout, 'com.taobao.taobao/com.taobao.tao.TBMainActivity', 246, 100, 110],
      ['after', afterRaw, 'com.taobao.taobao/com.taobao.tao.OtherActivity', 247, 110, 120],
    ] as const) {
      const record: ForegroundObservationRecord = system[label];
      assert.deepEqual(Object.keys(record).sort(), ['activity', 'marker', 'source', 'taskId']);
      assert.equal(record.marker, 'topResumedActivity'); assert.equal(record.activity, activity); assert.equal(record.taskId, taskId);
      assert.deepEqual(Object.keys(record.source).sort(), ['endedAt', 'path', 'sha256', 'startedAt']);
      assert.equal(record.source.startedAt, startedAt); assert.equal(record.source.endedAt, endedAt);
      const bytes = await readFile(record.source.path), command = JSON.parse(bytes.toString());
      assert.equal(record.source.sha256, createHash('sha256').update(bytes).digest('hex'));
      assert.equal(command.stdout, raw); assert.equal(command.status, 'success');
      assert.equal(command.startedAt, startedAt); assert.equal(command.endedAt, endedAt);
      assert.deepEqual(command.command, { file: 'adb', args: ['-s', 'offline', 'shell', 'dumpsys', 'activity', 'activities'] });
      assert.deepEqual(command.identity, { package: frame.package, userId: frame.userId });
    }
    assert.notEqual(system.before.source.path, system.after.source.path);
    assert.deepEqual((await readdir(join(dir, 'device-command-evidence'))).sort(), [system.before.source.path, system.after.source.path].map(p => p.split('/').at(-1)).sort());
    assert.deepEqual(calls.map(c => c.file === 'offline-ocr' ? 'ocr' : c.args.includes('activities') ? 'foreground' : 'screencap'), ['foreground', 'screencap', 'foreground', 'ocr']);
    assert.equal(frame.package, 'com.taobao.taobao'); assert.equal(frame.userId, saved.identity.userId);
    assert.equal('activity' in frame, false); assert.equal('taskId' in frame, false); assert.equal('source' in frame, false);
    assert.deepEqual(JSON.parse(await readFile(join(dir, frame.id + '.json'), 'utf8')), frame);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
