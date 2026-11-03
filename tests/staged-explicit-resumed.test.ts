// OFFLINE: original dumpsys fixtures, real AdbOcrDevice, fake exec only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { AdbOcrDevice, type DeviceExec } from '../runner/staged/device.ts';
import { readForegroundObservation } from '../runner/staged/system-observation.ts';

const scratch = '/Users/mater/.hermes/cache/scratch';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
const originals = [
  ['run232 SchemeLauncher', 'staged-2026-11-02T13-52-26-874Z/device-command-evidence/foreground-a4211528-0fc4-4c6b-8be1-fee2c37b98b0.json', 'com.eg.android.AlipayGphone', 'com.alipay.mobile.quinox.SchemeLauncherActivity', 247],
  ['run233 LoginActivity', 'staged-2026-11-02T14-10-36-028Z/device-command-evidence/foreground-c06d97ab-0d84-4366-93d6-2b81b9eed34d.json', 'com.eg.android.AlipayGphone', 'com.ali.user.mobile.loginupgrade.activity.LoginActivity', 248],
  ['run231 TMSActivity', 'staged-2026-11-02T13-39-17-296Z/device-command-evidence/foreground-bb0e5cba-8bf4-4c2f-8620-7377c82f06f9.json', 'com.taobao.taobao', 'com.taobao.themis.container.app.TMSActivity', 246],
] as const;

async function fixture(raw: string, fn: (device: AdbOcrDevice, dir: string, calls: string[]) => Promise<void>) {
  const dir = await mkdtemp(join(scratch, 'explicit-resumed-case-'));
  const calls: string[] = [];
  const exec: DeviceExec = async (file, args) => {
    if (file === 'offline-ocr') {
      calls.push('ocr');
      await writeFile(args[0], JSON.stringify({ pages: [{ file: args[1], width: 1, height: 1, lines: [] }] }));
      return { stdout: '' };
    }
    assert.equal(file, 'adb'); assert.deepEqual(args.slice(0, 2), ['-s', 'offline']);
    if (args.slice(2).join(' ') === 'shell dumpsys activity activities') { calls.push('foreground'); return { stdout: raw, stderr: 'original warning\n' }; }
    if (args.slice(2).join(' ') === 'exec-out screencap -p') { calls.push('screencap'); return { stdout: png }; }
    throw Error('Forbidden offline command: ' + args.join(' '));
  };
  try { await fn(new AdbOcrDevice({ serial: 'offline', evidenceDir: dir, ocrBinary: 'offline-ocr', exec }), dir, calls); }
  finally {
    if (process.env.CHECKIN_KEEP_EXPLICIT_REPLAY === '1') console.log('OFFLINE_EXPLICIT_EVIDENCE', dir);
    else await rm(dir, { recursive: true, force: true });
  }
}

for (const [name, path, pkg, activity, taskId] of originals) test('explicit resumed capture preserves actual identity and command provenance: ' + name, async () => {
  const original = JSON.parse(await readFile(new URL('../evidence/' + path, import.meta.url), 'utf8'));
  await fixture(original.stdout, async (device, dir, calls) => {
    const frame = await device.capture();
    assert.equal(frame.package, pkg); assert.equal(frame.userId, 0);
    assert.ok(frame.systemObservation);
    for (const record of [frame.systemObservation.before, frame.systemObservation.after]) {
      assert.equal(record.marker, 'ResumedActivity'); assert.equal(record.activity, pkg + '/' + activity); assert.equal(record.taskId, taskId);
      const bytes = await readFile(record.source.path), command = JSON.parse(bytes.toString());
      assert.equal(record.source.sha256, createHash('sha256').update(bytes).digest('hex'));
      assert.equal(command.stdout, original.stdout); assert.equal(command.stderr, 'original warning\n');
      assert.equal(command.status, 'success'); assert.deepEqual(command.identity, { package: pkg, userId: 0 });
      assert.deepEqual(command.topCandidates, []); assert.deepEqual(command.resumedCandidates, []);
      assert.deepEqual(command.explicitResumedCandidates, original.stdout.split('\n').filter((line: string) => /^[ \t]*(?:ResumedActivity|Resumed):/.test(line)));
      assert.equal(command.explicitResumedCandidates.length, 2);
    }
    assert.deepEqual(calls, ['foreground', 'screencap', 'foreground', 'ocr']);
    assert.equal((await readdir(join(dir, 'device-command-evidence'))).length, 2);
    assert.deepEqual(JSON.parse(await readFile(join(dir, frame.id + '.json'), 'utf8')), frame);
  });
});

const explicit = '  ResumedActivity: ActivityRecord{x u0 test.app/.Main t42}';
const resumed = '    Resumed: ActivityRecord{y u0 test.app/.Main t42}';
for (const [name, raw, status] of [
  ['different package', explicit + '\n' + resumed.replace('test.app', 'foreign.app'), 'ambiguous'],
  ['different user', explicit + '\n' + resumed.replace('u0 ', 'u999 '), 'ambiguous'],
  ['null explicit', 'ResumedActivity: null\n' + resumed, 'malformed'],
  ['null short marker', explicit + '\nResumed: null', 'malformed'],
  ['unwrapped identity', 'ResumedActivity: u0 test.app/.Main t42', 'malformed'],
  ['embedded record', 'Resumed: old ActivityRecord{x u0 test.app/.Main t42}', 'malformed'],
  ['missing activity', 'ResumedActivity: ActivityRecord{x u0 test.app/ t42}', 'malformed'],
  ['missing closing brace', 'Resumed: ActivityRecord{x u0 test.app/.Main t42', 'malformed'],
  ['trailing junk', explicit + ' stale', 'malformed'],
  ['invalid package', explicit.replace('test.app', 'invalid'), 'invalid'],
  ['unsafe user', explicit.replace('u0 ', 'u9007199254740992 '), 'invalid'],
  ['focused only', 'mFocusedApp=ActivityRecord{x u0 test.app/.Main t42}', 'missing'],
  ['embedded labels', 'Intent { note=ResumedActivity: ActivityRecord{x u0 test.app/.Main t42} }\nold Resumed: ActivityRecord{x u0 test.app/.Main t42}', 'missing'],
] as const) test('explicit fallback rejects without missing-marker recovery: ' + name, async () => {
  await fixture(raw, async (device, dir, calls) => {
    let failure: unknown;
    await assert.rejects(device.capture(), error => { failure = error; return /foreground/i.test((error as Error).message); });
    assert.equal(device.consumeCaptureForegroundMissing(failure, { package: 'test.app', userId: 0 }) !== null, status === 'missing');
    assert.deepEqual(calls, ['foreground']);
    const files = await readdir(join(dir, 'device-command-evidence')); assert.equal(files.length, 1);
    const command = JSON.parse(await readFile(join(dir, 'device-command-evidence', files[0]), 'utf8'));
    assert.equal(command.status, status); assert.equal(command.stdout, raw); assert.equal(command.stderr, 'original warning\n');
    assert.deepEqual(command.explicitResumedCandidates, raw.split('\n').filter(line => /^[ \t]*(?:ResumedActivity|Resumed):/.test(line)));
  });
});

for (const raw of [explicit + '\n' + resumed.replace('u0 ', 'u999 '), explicit + ' stale', explicit + '\nResumed: null']) test('explicit diagnostics reject invalid identity evidence', () => {
  assert.equal(readForegroundObservation(raw).activity, null);
  assert.equal(readForegroundObservation(raw).taskId, null);
});

for (const [name, raw, marker, pkg, userId] of [
  ['long marker alone', explicit, 'ResumedActivity', 'test.app', 0],
  ['short marker alone with CRLF', resumed + '\r\n', 'Resumed', 'test.app', 0],
  ['duplicate matching identities', explicit + '\n' + resumed + '\n' + explicit, 'ResumedActivity', 'test.app', 0],
  ['top over stale mResumed and explicit', 'topResumedActivity=ActivityRecord{x u999 top.app/.Main t42}\nmResumedActivity: ActivityRecord{x u0 stale.app/.Main t42}\n' + explicit, 'topResumedActivity', 'top.app', 999],
  ['mResumed over explicit', 'mResumedActivity: ActivityRecord{x u999 old.app/.Main t42}\n' + explicit, 'mResumedActivity', 'old.app', 999],
] as const) test('foreground retains selection priority: ' + name, async () => {
  await fixture(raw, async device => {
    const frame = await device.capture();
    assert.equal(frame.package, pkg); assert.equal(frame.userId, userId);
    assert.equal(frame.systemObservation!.before.marker, marker);
    assert.equal(frame.systemObservation!.before.activity, pkg + '/.Main');
    assert.equal(frame.systemObservation!.before.taskId, 42);
  });
});

for (const raw of ['topResumedActivity=null\n' + explicit, 'mResumedActivity: null\n' + explicit]) test('present malformed old marker cannot borrow explicit fallback', async () => {
  await fixture(raw, async (device, _dir, calls) => {
    let failure: unknown;
    await assert.rejects(device.capture(), error => { failure = error; return /foreground/i.test((error as Error).message); });
    assert.equal(device.consumeCaptureForegroundMissing(failure, { package: 'test.app', userId: 0 }), null);
    assert.deepEqual(calls, ['foreground']);
    assert.equal(readForegroundObservation(raw).activity, null);
  });
});

test('exec failure retains partial explicit candidates and original raw output without recovery', async () => {
  await fixture('', async (_device, dir) => {
    const failure = Object.assign(Error('original exec timeout'), { stdout: explicit + '\n' + resumed, stderr: 'partial warning', code: 'ETIMEDOUT', killed: true });
    const device = new AdbOcrDevice({ serial: 'offline', evidenceDir: dir, exec: async () => { throw failure; } });
    await assert.rejects(device.capture(), error => error === failure);
    assert.equal(device.consumeCaptureForegroundMissing(failure, { package: 'test.app', userId: 0 }), null);
    const names = await readdir(join(dir, 'device-command-evidence')); assert.equal(names.length, 1);
    const saved = JSON.parse(await readFile(join(dir, 'device-command-evidence', names[0]), 'utf8'));
    assert.equal(saved.stdout, failure.stdout); assert.equal(saved.stderr, failure.stderr); assert.equal(saved.status, 'exec_error');
    assert.deepEqual(saved.explicitResumedCandidates, [explicit, resumed]);
  });
});
