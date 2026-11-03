import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import type { DeviceExec, DeviceFrame } from './device.ts';

export type RawOwner = Readonly<{ package: string; userId: number; taskAttemptId: string }>;
export type RawFrame = Readonly<{ id: string; batchId: string; path: string; sidecarPath: string;
  capturedAt: number; owner: RawOwner; pngSha256: string; width: number; height: number }>;
export type RawBatch = Readonly<{ id: string; frames: readonly RawFrame[]; status: 'complete' | 'timeout' | 'failed'; error?: string }>;
type Clock = { now(): number; monotonic(): number; sleep(ms: number): Promise<void> };
type Options = { executionPolicy?: 'development-unbounded-v1'; serial: string; evidenceDir: string; exec?: DeviceExec; clock?: Clock };
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const nativeExec = promisify(execFile);
const validOwner = (o: RawOwner) => o && /^[a-zA-Z]\w*(?:\.[a-zA-Z]\w*)+$/.test(o.package)
  && Number.isSafeInteger(o.userId) && o.userId >= 0 && typeof o.taskAttemptId === 'string' && !!o.taskAttemptId.trim();
class Deadline extends Error { constructor() { super('Raw capture deadline exceeded'); } }

/** Caller holds the shared device lock across dispatch, burst and later validation.
 * This instance supplies observation only; it never mints device action authority. */
export class RawCapture {
  private busy = false;
  private readonly run: DeviceExec;
  private readonly clock: Clock;
  private readonly dir: string;
  private readonly batches = new WeakSet<object>();
  private readonly pending = new Set<Promise<unknown>>();
  constructor(private readonly options: Options) {
    if (!options.serial?.trim() || /[\s\0]/.test(options.serial) || !options.evidenceDir?.trim()) throw Error('Invalid raw capture options');
    this.dir = resolve(options.evidenceDir);
    this.clock = options.clock ?? { now: Date.now, monotonic: () => performance.now(), sleep: ms => new Promise(r => setTimeout(r, ms)) };
    this.run = options.exec ?? (async (file, args, limits) => nativeExec(file, args,
      { encoding: 'buffer', timeout: limits!.timeoutMs, killSignal: 'SIGKILL', maxBuffer: 20 * 1024 * 1024 }));
  }
  private remaining(end: number) {
    const ms = Math.floor(end - this.clock.monotonic());
    if (ms <= 0) throw new Deadline();
    return ms;
  }
  private async bounded<T>(end: number, operation: (timeoutMs: number) => Promise<T>): Promise<T> {
    if (this.options.executionPolicy === 'development-unbounded-v1') return operation(60000); // Individual transport timeout, no total business deadline.
    const ms = this.remaining(end);
    const work = Promise.resolve().then(() => operation(ms));
    this.pending.add(work);
    void work.then(() => this.pending.delete(work), () => this.pending.delete(work));
    let timer: ReturnType<typeof setTimeout>;
    try {
      const value = await Promise.race([work, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Deadline()), ms); })]);
      this.remaining(end);
      return value;
    } finally { clearTimeout(timer!); }
  }
  private async exclusive<T>(work: () => Promise<T>) {
    if (this.busy) throw Error('Raw capture busy');
    this.busy = true;
    try { return await work(); } finally {
      if (this.pending.size) void Promise.allSettled([...this.pending]).then(() => { this.busy = false; });
      else this.busy = false;
    }
  }
  private async adb(end: number, ...args: string[]) {
    return (await this.bounded(end, timeoutMs => this.run('adb', ['-s', this.options.serial, ...args], { timeoutMs }))).stdout;
  }
  private async foreground(end: number, owner: RawOwner) {
    const raw = String(await this.adb(end, 'shell', 'dumpsys', 'activity', 'activities'));
    const top = raw.split('\n').filter(l => /\btopResumedActivity\s*=/.test(l));
    const lines = top.length ? top : raw.split('\n').filter(l => /\bmResumedActivity\s*[:=]/.test(l));
    const identities = lines.map(l => l.match(/\bu(\d+)\s+([\w.]+)\//));
    if (!identities.length || identities.some(m => !m || Number(m[1]) !== owner.userId || m[2] !== owner.package)) throw Error('Foreground identity mismatch or missing');
  }
  /** After capture only: one batch parser call, original times retained, no device authority. */
  async deriveFrames(batch: RawBatch, parser: ((frames: readonly RawFrame[], limits: { timeoutMs: number }) => Promise<unknown>) | { ocrBinary: string }, limits: { budgetMs: number }): Promise<DeviceFrame[]> {
    if (!this.batches.has(batch) || !batch.frames.length || !Number.isSafeInteger(limits.budgetMs) || limits.budgetMs < 1 || this.options.executionPolicy !== 'development-unbounded-v1' && limits.budgetMs > 5000) throw Error('Invalid derivation batch or budget');
    return this.exclusive(async () => {
      const fresh = () => {
        const now = this.clock.now();
        if (batch.frames.some(f => now < f.capturedAt || this.options.executionPolicy !== 'development-unbounded-v1' && now - f.capturedAt >= 5000)) throw Error('Raw frame expired: cannot extend capture freshness');
      };
      fresh();
      const end = this.clock.monotonic() + Math.min(limits.budgetMs, ...batch.frames.map(f => f.capturedAt + 5000 - this.clock.now()));
      const sharp = (await import('sharp')).default;
      for (const f of batch.frames) {
        const [bytes, sidecar] = await this.bounded(end, () => Promise.all([readFile(f.path), readFile(f.sidecarPath, 'utf8')]));
        if (hash(bytes) !== f.pngSha256 || sidecar !== JSON.stringify(f)) throw Error('Raw evidence hash or sidecar mismatch');
        await this.bounded(end, async () => {
          const image = sharp(bytes, { failOn: 'warning', limitInputPixels: 1080 * 2400 });
          const meta = await image.metadata();
          if (meta.format !== 'png' || meta.width !== f.width || meta.height !== f.height || (meta.pages ?? 1) !== 1) throw Error('Unreadable PNG');
          await image.raw().toBuffer(); // Full decode only after the entire burst has ended.
        });
      }
      const derivedId = randomUUID(), output = join(this.dir, derivedId + '.ocr.json');
      const result = await this.bounded(end, async timeoutMs => {
        if (typeof parser === 'function') return parser(batch.frames, { timeoutMs });
        if (!parser.ocrBinary?.trim()) throw Error('Missing offline OCR binary');
        await this.run(parser.ocrBinary, [output, ...batch.frames.map(f => f.path)], { timeoutMs });
        return JSON.parse(await readFile(output, 'utf8'));
      }) as any;
      fresh();
      if (!Array.isArray(result?.pages) || result.pages.length !== batch.frames.length) throw Error('Invalid OCR batch');
      const parsedAt = this.clock.now();
      const derived = batch.frames.map(f => {
        const pages = result.pages.filter((p: any) => p?.file === f.path), p = pages[0];
        if (pages.length !== 1 || p.width !== f.width || p.height !== f.height || !Array.isArray(p.lines) || !p.lines.length
          || p.lines.some((l: any) => typeof l?.text !== 'string' || !Array.isArray(l.bounds) || l.bounds.length !== 4
            || !l.bounds.every((n: any) => typeof n === 'number' && Number.isFinite(n))
            || l.bounds[0] < 0 || l.bounds[1] < 0 || l.bounds[2] > f.width || l.bounds[3] > f.height
            || l.bounds[0] >= l.bounds[2] || l.bounds[1] >= l.bounds[3])) throw Error('Invalid or empty OCR lines');
        return { id: f.id, path: f.path, capturedAt: f.capturedAt, width: f.width, height: f.height,
          package: f.owner.package, userId: f.owner.userId, lines: structuredClone(p.lines),
          page: { rawCapture: { derived: true, batchId: batch.id, owner: f.owner, sidecarPath: f.sidecarPath,
            pngSha256: f.pngSha256, parsedAt, ocrSha256: hash(Buffer.from(JSON.stringify(result))) } } };
      });
      await this.bounded(end, () => writeFile(join(this.dir, derivedId + '.derived.json'), JSON.stringify({ result, frames: derived }), { flag: 'wx' }));
      fresh();
      return derived;
    });
  }
  async captureBurst(owner: RawOwner, budget: { frames: number; intervalMs: number; budgetMs?: number }): Promise<RawBatch> {
    if (!validOwner(owner) || !Number.isSafeInteger(budget.frames) || budget.frames < 1 || this.options.executionPolicy !== 'development-unbounded-v1' && budget.frames > 8
      || !Number.isSafeInteger(budget.intervalMs) || budget.intervalMs < 0
      || !Number.isSafeInteger(budget.budgetMs ?? 2000) || (budget.budgetMs ?? 2000) < 1 || this.options.executionPolicy !== 'development-unbounded-v1' && (budget.budgetMs ?? 2000) > 2000) throw Error('Invalid raw capture budget or owner');
    return this.exclusive(async () => {
      const start = this.clock.monotonic(), end = start + (budget.budgetMs ?? 2000), id = randomUUID();
      const capturedOwner = Object.freeze({ ...owner }), frames: RawFrame[] = [];
      let status: RawBatch['status'] = 'complete', error: string | undefined;
      try {
        await this.bounded(end, () => mkdir(this.dir, { recursive: true }));
        for (let i = 0; i < budget.frames; i++) {
          const wait = start + i * budget.intervalMs - this.clock.monotonic();
          if (wait > 0) await this.bounded(end, ms => this.clock.sleep(Math.min(wait, ms)));
          await this.foreground(end, capturedOwner);
          const capturedAt = this.clock.now(); // Conservative start time, never OCR completion time.
          if (!Number.isSafeInteger(capturedAt)) throw Error('Invalid capture clock');
          const bytes = await this.adb(end, 'exec-out', 'screencap', '-p');
          if (!Buffer.isBuffer(bytes) || bytes.length < 45 || bytes.length > 20 * 1024 * 1024
            || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
            || bytes.readUInt32BE(8) !== 13 || bytes.toString('ascii', 12, 16) !== 'IHDR'
            || !bytes.readUInt32BE(16) || !bytes.readUInt32BE(20)
            || bytes.readUInt32BE(16) * bytes.readUInt32BE(20) > 1080 * 2400) throw Error('Invalid raw PNG header');
          await this.foreground(end, capturedOwner);
          const frameId = randomUUID(), path = join(this.dir, frameId + '.png'), sidecarPath = join(this.dir, frameId + '.raw.json');
          const frame: RawFrame = Object.freeze({ id: frameId, batchId: id, path, sidecarPath, capturedAt,
            owner: capturedOwner, pngSha256: hash(bytes), width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) });
          await this.bounded(end, () => writeFile(path, bytes, { flag: 'wx' }));
          await this.bounded(end, () => writeFile(sidecarPath, JSON.stringify(frame), { flag: 'wx' }));
          frames.push(frame);
        }
      } catch (e) { status = e instanceof Deadline ? 'timeout' : 'failed'; error = e instanceof Error ? e.message : String(e); }
      const batch: RawBatch = Object.freeze({ id, frames: Object.freeze(frames), status, ...(error ? { error } : {}) });
      this.batches.add(batch);
      return batch;
    });
  }
}
