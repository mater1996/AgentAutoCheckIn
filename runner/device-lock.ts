/** Cross-process phone exclusion, shared by CLI and queued runner entry points. */
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

export type DeviceLockOptions = { serial?: string; lockRoot?: string; timeoutMs?: number; pollMs?: number };
type Owner = { pid: number; token: string; serial: string; acquiredAt: string };
const defaultRoot = fileURLToPath(new URL('../data/device-locks/', import.meta.url));

function alive(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid <= 0) return true; // malformed metadata never permits stealing
  try { process.kill(pid, 0); return true; }
  catch (e: any) { return e.code !== 'ESRCH'; }
}
function ownerAt(dir: string): Owner | null {
  try { return JSON.parse(fs.readFileSync(path.join(dir, 'owner.json'), 'utf8')); }
  catch { return null; }
}
function reapDeadOwner(dir: string) {
  const owner = ownerAt(dir);
  // Missing metadata could mean a process is still initializing its lock; fail closed.
  if (!owner?.token || alive(owner.pid)) return;
  const reaper = path.join(dir, 'reaper');
  try { fs.mkdirSync(reaper); }
  catch (e: any) { if (['EEXIST', 'ENOENT'].includes(e.code)) return; throw e; }
  const current = ownerAt(dir);
  if (current?.token !== owner.token || alive(current.pid)) {
    fs.rmdirSync(reaper);
    return;
  }
  // Exclusive reaper prevents two stale observers removing a newly acquired lock.
  const tombstone = `${dir}.stale-${randomUUID()}`;
  fs.renameSync(dir, tombstone);
  fs.rmSync(tombstone, { recursive: true, force: true });
}

export async function acquireDeviceLock(opts: DeviceLockOptions = {}) {
  const serial = opts.serial ?? process.env.ADB_SERIAL ?? '3d8a7934';
  const root = opts.lockRoot ?? process.env.CHECKIN_DEVICE_LOCK_DIR ?? defaultRoot;
  const dir = path.join(root, createHash('sha256').update(serial).digest('hex') + '.lock');
  const timeoutMs = opts.timeoutMs ?? 0;
  if (!Number.isFinite(timeoutMs) || timeoutMs < 0) throw new Error('invalid lock timeoutMs');
  fs.mkdirSync(root, { recursive: true });
  const deadline = Date.now() + timeoutMs;
  while (true) {
    try { fs.mkdirSync(dir); break; }
    catch (e: any) {
      if (e.code !== 'EEXIST') throw e;
      reapDeadOwner(dir);
      if (!fs.existsSync(dir)) continue;
      if (Date.now() >= deadline) throw new Error(`Device ${serial} is locked by pid ${ownerAt(dir)?.pid ?? 'unknown'} (${dir})`);
      await delay(Math.min(opts.pollMs ?? 100, Math.max(1, deadline - Date.now())));
    }
  }
  const owner: Owner = { pid: process.pid, token: randomUUID(), serial, acquiredAt: new Date().toISOString() };
  try { fs.writeFileSync(path.join(dir, 'owner.json'), JSON.stringify(owner), { flag: 'wx' }); }
  catch (e) { fs.rmdirSync(dir); throw e; }
  let released = false;
  return {
    path: dir,
    release() {
      if (released) return;
      released = true;
      const current = ownerAt(dir);
      if (current?.token !== owner.token || current.pid !== process.pid) return;
      const tombstone = `${dir}.released-${owner.token}`;
      fs.renameSync(dir, tombstone);
      fs.rmSync(tombstone, { recursive: true, force: true });
    },
  };
}

/** Acquire before any phone access and release only after runner cleanup finishes. Not reentrant. */
export async function withDeviceLock<T>(fn: () => Promise<T>, opts: DeviceLockOptions = {}): Promise<T> {
  const lock = await acquireDeviceLock(opts);
  try { return await fn(); }
  finally { lock.release(); }
}
