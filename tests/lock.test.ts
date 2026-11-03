import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
const lock: any = await import('../runner/device-lock').catch((e) => { if (e.code === 'ERR_MODULE_NOT_FOUND') return {}; throw e; });
const root = fs.mkdtempSync(path.join(process.env.TMPDIR!, 'checkin-lock-'));
test.after(() => fs.rmSync(root, { recursive: true, force: true }));

test('device lock excludes contenders and release cannot remove a later owner', async () => {
  assert.equal(typeof lock.acquireDeviceLock, 'function', 'shared device lock exists');
  const opts = { serial: 'offline-device', lockRoot: root, timeoutMs: 0 };
  const first = await lock.acquireDeviceLock(opts);
  await assert.rejects(lock.acquireDeviceLock(opts), /locked/i);
  first.release();
  const second = await lock.acquireDeviceLock(opts);
  first.release();
  await assert.rejects(lock.acquireDeviceLock(opts), /locked/i);
  second.release();
  await assert.rejects(lock.withDeviceLock(async () => { throw new Error('task failed'); }, opts), /task failed/);
  const afterError = await lock.acquireDeviceLock(opts);
  afterError.release();
});

test('another process is excluded; a killed owner is recovered on the next acquire', async () => {
  assert.equal(typeof lock.acquireDeviceLock, 'function', 'shared device lock exists');
  const opts = { serial: 'crash-device', lockRoot: root, timeoutMs: 0 };
  const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', `
    import { acquireDeviceLock } from ${JSON.stringify(new URL('../runner/device-lock.ts', import.meta.url).href)};
    await acquireDeviceLock(${JSON.stringify(opts)});
    console.log('READY'); setInterval(() => {}, 1000);
  `], { stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    await new Promise<void>((resolve, reject) => {
      child.stdout.once('data', () => resolve());
      child.once('error', reject);
      child.once('exit', (code) => reject(new Error(`child exited before lock: ${code}`)));
    });
    await assert.rejects(lock.acquireDeviceLock(opts), /locked/i);
  } finally {
    child.kill('SIGKILL');
    await new Promise((resolve) => child.once('exit', resolve));
  }
  const recovered = await lock.acquireDeviceLock(opts);
  recovered.release();
});
