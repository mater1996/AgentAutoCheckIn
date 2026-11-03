import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { splitOcrObservation, type OcrObservation } from './observations.ts';
import { readBalanceComponent, type BalanceComponentResult } from './balance-component.ts';
import { parseExplicitResumedActivity, readForegroundObservation, type ForegroundObservationRecord, type SystemObservation, type SystemObservationSource } from './system-observation.ts';

export type DeviceExec = (file: string, args: string[], limits?: { timeoutMs: number }) => Promise<{ stdout: Buffer | string; stderr?: Buffer | string }>;
export type TitleRefinement = {
  sourceFrame: { id: string; path: string; sha256: string };
  raw: { path: string; sha256: string };
  results?: { path: string; sha256: string };
  crops: { index: number; original: DeviceFrame['lines'][number]; path: string; sha256: string; bounds: number[]; scale: number; accepted: boolean; result?: DeviceFrame['lines'][number]; reason?: string }[];
  status: 'pending' | 'complete' | 'expired' | 'failed';
};
export type DeviceFrame = { id: string; path: string; width: number; height: number; capturedAt: number; lines: { text: string; bounds: number[] }[]; package: string; userId: number; page?: unknown; observationError?: string; ocrObservation?: OcrObservation; titleRefinement?: TitleRefinement; balanceEvidence?: BalanceComponentResult; systemObservation?: SystemObservation };
export type DeviceOptions = { executionPolicy?: 'development-unbounded-v1'; serial: string; evidenceDir: string; ocrBinary?: string; exec?: DeviceExec; now?: () => number; monotonic?: () => number; frameMaxAgeMs?: number; allowVisualFallback?: boolean; balanceComponent?: boolean };
export type DeviceAction = { type: 'tap' | 'swipe' | 'back' | 'wait' | 'launch'; x?: number; y?: number; fromX?: number; fromY?: number; toX?: number; toY?: number; ms?: number; package?: string; userId?: number };
export type CleanupReport = { stayOn: string | null; power: string | null; forwards: string | null; errors: string[] };
const execAsync = promisify(execFile);
const packagePattern = /^[a-zA-Z][\w]*(?:\.[a-zA-Z][\w]*)+$/;
const integer = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n);
class MissingForegroundMarkers extends Error {
  recorded = false;
  source?: SystemObservationSource;
  constructor() { super('Foreground missing or ambiguous'); }
}

/** The owner must hold withDeviceLock across prepare, capture/act and cleanup. */
export class AdbOcrDevice {
  private readonly run: DeviceExec;
  private readonly options: DeviceOptions;
  private busy = false;
  #unsentActs = new WeakMap<object, { action: DeviceAction; frame: DeviceFrame; proof: { path: string; sha256: string } }>();
  #missingCaptures = new WeakMap<object, { source: SystemObservationSource; owner?: { package: string; userId: number } }>();
  private currentFrame?: DeviceFrame;
  private originalStayOn?: string;
  private launchTransition?: { id: string; package: string; userId: number; started: number; deadline: number | null; startCompletedAt: number };
  private launchTransitionFailure?: unknown;

  constructor(options: DeviceOptions) {
    if (!options.serial?.trim() || /[\s\0]/.test(options.serial) || !options.evidenceDir?.trim()) throw Error('Invalid device configuration');
    this.options = { ...options, evidenceDir: resolve(options.evidenceDir) };
    this.run = options.exec ?? (async (file, args, limits) => execAsync(file, args, { encoding: 'buffer', timeout: limits?.timeoutMs ?? 60000, maxBuffer: 20 * 1024 * 1024 }));
  }

  private now() { return (this.options.now ?? Date.now)(); }
  private async adb(...args: string[]) { return (await this.run('adb', ['-s', this.options.serial, ...args])).stdout; }
  private async exclusive<T>(operation: () => Promise<T>): Promise<T> {
    if (this.busy) throw Error('Device busy: concurrent operations forbidden');
    this.busy = true;
    try { return await operation(); } finally { this.busy = false; }
  }
  private async save(name: string, value: unknown) {
    await mkdir(this.options.evidenceDir, { recursive: true });
    await writeFile(join(this.options.evidenceDir, name), JSON.stringify(value, null, 2));
  }
  private async recordedCommand<T>(kind: string, args: string[], inspect: (raw: string, evidence: Record<string, unknown>) => T, timeoutMs?: number, recorded?: (source: SystemObservationSource) => void): Promise<T> {
    const command = { file: 'adb', args: ['-s', this.options.serial, ...args] };
    const path = join(this.options.evidenceDir, 'device-command-evidence', `${kind}-${randomUUID()}.json`);
    const evidence: Record<string, unknown> = { kind, command, startedAt: this.now(), timeoutMs: timeoutMs ?? 60000, stdout: '', stderr: '', status: 'exec_error' };
    let failed = false, failure: unknown;
    try {
      let result: Awaited<ReturnType<DeviceExec>>;
      try {
        result = await this.run(command.file, command.args, timeoutMs === undefined ? undefined : { timeoutMs });
      } catch (error) {
        const e = error as { stdout?: Buffer | string; stderr?: Buffer | string; code?: unknown; signal?: unknown; killed?: unknown };
        evidence.stdout = String(e?.stdout ?? ''); evidence.stderr = String(e?.stderr ?? '');
        evidence.result = { code: e?.code ?? null, signal: e?.signal ?? null, killed: e?.killed ?? null };
        throw error;
      } finally { evidence.endedAt = this.now(); }
      evidence.stdout = String(result.stdout); evidence.stderr = String(result.stderr ?? '');
      evidence.result = { code: 0, signal: null, killed: false };
      evidence.status = 'success';
      return inspect(String(result.stdout), evidence);
    } catch (error) {
      failed = true;
      failure = error;
      evidence.error = error instanceof Error ? error.message : String(error);
      throw error;
    } finally {
      if (kind === 'foreground') {
        const lines = String(evidence.stdout).split('\n');
        evidence.topCandidates = lines.filter(line => /\btopResumedActivity\s*=/.test(line));
        evidence.resumedCandidates = lines.filter(line => /\bmResumedActivity\s*[:=]/.test(line));
        evidence.explicitResumedCandidates = lines.filter(line => /^[ \t]*(?:ResumedActivity|Resumed):/.test(line));
      }
      try {
        const dir = join(this.options.evidenceDir, 'device-command-evidence');
        await mkdir(dir, { recursive: true });
        const bytes = Buffer.from(JSON.stringify(evidence, null, 2));
        await writeFile(path, bytes, { flag: 'wx' });
        if (failure instanceof MissingForegroundMarkers) {
          failure.recorded = true;
          failure.source = { path, sha256: createHash('sha256').update(bytes).digest('hex'), startedAt: Number(evidence.startedAt), endedAt: Number(evidence.endedAt) };
        }
        if (!failed) recorded?.({ path, sha256: createHash('sha256').update(bytes).digest('hex'), startedAt: Number(evidence.startedAt), endedAt: Number(evidence.endedAt) });
      }
      catch (error) { if (!failed) throw error; }
    }
  }
  private async foreground(timeoutMs?: number, observe?: (record: ForegroundObservationRecord) => void) {
    let rawObservation = '';
    return this.recordedCommand('foreground', ['shell', 'dumpsys', 'activity', 'activities'], (raw, evidence) => {
      const top = raw.split('\n').filter(line => /\btopResumedActivity\s*=/.test(line));
      const resumed = raw.split('\n').filter(line => /\bmResumedActivity\s*[:=]/.test(line));
      const explicit = raw.split('\n').filter(line => /^[ \t]*(?:ResumedActivity|Resumed):/.test(line));
      evidence.topCandidates = top; evidence.resumedCandidates = resumed;
      evidence.explicitResumedCandidates = explicit;
      const lines = top.length ? top : resumed.length ? resumed : explicit;
      const parsed = lines.map(line => top.length || resumed.length ? line.match(/\bu(\d+)\s+([\w.]+)\//) : parseExplicitResumedActivity(line));
      const unique = [...new Set(parsed.filter(Boolean).map(m => `${m![1]}:${m![2]}`))];
      if (parsed.some(m => !m) || unique.length !== 1) {
        evidence.status = !lines.length ? 'missing' : parsed.some(m => !m) ? 'malformed' : 'ambiguous';
        if (!lines.length) throw new MissingForegroundMarkers();
        throw Error('Foreground missing or ambiguous');
      }
      const [user, pkg] = unique[0].split(':');
      if (!packagePattern.test(pkg) || !Number.isSafeInteger(Number(user))) { evidence.status = 'invalid'; throw Error('Invalid foreground identity'); }
      const identity = { package: pkg, userId: Number(user) };
      evidence.identity = identity;
      rawObservation = raw;
      return identity;
    }, timeoutMs, observe && (source => observe({ ...readForegroundObservation(rawObservation), source })));
  }

  /** One consumed allowance, anchored to the completed start, never a new launch. */
  private async captureForeground(observe?: (record: ForegroundObservationRecord) => void) {
    if (this.launchTransitionFailure) throw this.launchTransitionFailure;
    const transition = this.launchTransition;
    this.launchTransition = undefined;
    if (!transition) return this.foreground(undefined, observe);
    const monotonic = this.options.monotonic ?? (() => performance.now());
    const unbounded = this.options.executionPolicy === 'development-unbounded-v1';
    const remaining = () => unbounded ? null : Math.floor(transition.deadline! - monotonic());
    const report = { ...transition, budgetMs: unbounded ? null : 1500, maxRereads: unbounded ? null : 1, waits: [] as { reason: string; ms: number; remainingMs: number | null }[],
      status: 'unknown', completionInferred: false, elapsedMs: 0, error: undefined as string | undefined };
    const read = async () => {
      const timeoutMs = remaining();
      if (!unbounded && timeoutMs! <= 0) throw Error('Post-launch foreground deadline exceeded; outcome unknown');
      // Await actual exec completion (including killed-child drain); never race and release the device early.
      const identity = await this.foreground(timeoutMs ?? undefined, observe);
      if (!unbounded && remaining()! <= 0) throw Error('Post-launch foreground deadline exceeded; outcome unknown');
      if (identity.package !== transition.package || identity.userId !== transition.userId) throw Error('Post-launch foreground identity changed; outcome unknown');
      return identity;
    };
    try {
      let identity;
      for (;;) {
        try { identity = await read(); break; }
        catch (error) {
          if (!(error instanceof MissingForegroundMarkers) || !error.recorded || !unbounded && report.waits.length >= 1) throw error;
          const remainingMs = remaining();
          if (!unbounded && remainingMs! <= 250) throw Error('Post-launch foreground budget exhausted; outcome unknown');
          report.waits.push({ reason: 'post_launch_foreground_markers_missing', ms: 250, remainingMs });
          await new Promise(resolve => setTimeout(resolve, 250));
        }
      }
      report.status = 'foreground_confirmed';
      return identity;
    } catch (error) {
      report.error = error instanceof Error ? error.message : String(error);
      this.launchTransitionFailure = error;
      throw error;
    } finally {
      report.elapsedMs = monotonic() - transition.started;
      try {
        await this.save(`launch-transition-${transition.id}.json`, report);
        if (!unbounded && report.status === 'foreground_confirmed' && remaining()! <= 0) {
          const error = Error('Post-launch foreground deadline exceeded while saving confirmation; outcome unknown');
          this.launchTransitionFailure = error;
          report.status = 'unknown'; report.error = error.message; report.elapsedMs = monotonic() - transition.started;
          await this.save(`launch-transition-${transition.id}.json`, report);
          throw error;
        }
      } catch (error) { this.launchTransitionFailure = error; throw error; }
    }
  }

  /** Re-read only current, bounded quota-title pixels. Never consult task names or plans. */
  private async refineTitles(frame: DeviceFrame, bytes: Buffer, rawPath: string) {
    const norm = (s: string) => s.normalize('NFKC').trim();
    const title = (s: string) => norm(s).match(/^([^()]+)\((\d+)\/(\d+)\)$/);
    const hash = (b: Buffer) => createHash('sha256').update(b).digest('hex');
    const unbounded = this.options.executionPolicy === 'development-unbounded-v1';
    const fresh = () => this.now() >= frame.capturedAt && (unbounded || this.now() - frame.capturedAt < (this.options.frameMaxAgeMs ?? 5000));
    if (frame.lines.filter(l => norm(l.text) === '赚金币抵钱').length !== 1) return;
    const candidates = frame.lines.map((line, index) => ({ line, index, quota: title(line.text) }))
      .filter(c => c.quota && c.line.bounds[1] > frame.height * .23 && c.line.bounds[3] < frame.height * .95);
    if (!candidates.length || !unbounded && candidates.length > 10) return;
    const provenance: TitleRefinement = {
      sourceFrame: { id: frame.id, path: frame.path, sha256: hash(bytes) },
      raw: { path: rawPath, sha256: hash(await readFile(rawPath)) }, crops: [], status: 'pending',
    };
    frame.titleRefinement = provenance;
    try {
      if (!fresh()) { provenance.status = 'expired'; return; }
      const sharp = (await import('sharp')).default;
      for (const c of candidates) {
        if (!fresh()) { provenance.status = 'expired'; return; }
        const b = c.line.bounds, cy = (b[1] + b[3]) / 2;
        const buttons = frame.lines.filter(l => /^(去完成|逛一逛|去逛逛|领取奖励|已完成)$/.test(norm(l.text))
          && l.bounds[0] > frame.width * .7 && Math.abs((l.bounds[1] + l.bounds[3]) / 2 - cy) < 75);
        if (buttons.length !== 1) continue;
        const left = Math.floor(b[0] - 20), top = Math.floor(b[1] - 20);
        const right = Math.floor(buttons[0].bounds[0] - 20), bottom = Math.ceil(b[3] + 20);
        // Do not crop a partial title, include adjacent text, or reuse coordinates outside this frame.
        if (left < 0 || top < 0 || right < b[2] + 20 || bottom > frame.height || bottom - top > 160
          || frame.lines.some((l, i) => i !== c.index && l.bounds[0] < right && l.bounds[2] > left && l.bounds[1] < bottom && l.bounds[3] > top)) continue;
        const path = join(this.options.evidenceDir, `${frame.id}.title-${c.index}.png`);
        const crop = await sharp(bytes).extract({ left, top, width: right - left, height: bottom - top })
          .resize((right - left) * 3, (bottom - top) * 3).png().toBuffer();
        await writeFile(path, crop, { flag: 'wx' });
        provenance.crops.push({ index: c.index, original: structuredClone(c.line), path, sha256: hash(crop), bounds: [left, top, right, bottom], scale: 3, accepted: false });
      }
      if (!fresh()) { provenance.status = 'expired'; return; }
      if (!provenance.crops.length) { provenance.status = 'complete'; return; }
      const output = join(this.options.evidenceDir, frame.id + '.titles.ocr.json');
      const timeoutMs = unbounded ? undefined : Math.floor(frame.capturedAt + (this.options.frameMaxAgeMs ?? 5000) - this.now());
      if (!unbounded && timeoutMs! <= 0) { provenance.status = 'expired'; return; }
      await this.run(this.options.ocrBinary ?? '/Users/mater/.hermes/cache/scratch/checkin-apple-ocr', [output, ...provenance.crops.map(c => c.path)], timeoutMs === undefined ? undefined : { timeoutMs });
      const resultBytes = await readFile(output);
      provenance.results = { path: output, sha256: hash(resultBytes) };
      if (!fresh()) { provenance.status = 'expired'; return; }
      const pages = JSON.parse(resultBytes.toString()).pages;
      if (!Array.isArray(pages) || pages.length !== provenance.crops.length) throw Error('Invalid title OCR batch');
      for (const crop of provenance.crops) {
        const page = pages.filter((p: any) => p?.file === crop.path);
        const width = (crop.bounds[2] - crop.bounds[0]) * 3, height = (crop.bounds[3] - crop.bounds[1]) * 3;
        const p = page[0];
        // Extra rows/fragments, missing quotas and invalid geometry are ambiguity, not corrections.
        if (page.length !== 1 || p.width !== width || p.height !== height || !Array.isArray(p.lines) || p.lines.length !== 1) { crop.reason = 'Ambiguous local OCR'; continue; }
        const l = p.lines[0], q = typeof l?.text === 'string' ? title(l.text) : null, old = title(crop.original.text)!;
        if (!q || q[2] !== old[2] || q[3] !== old[3] || !Array.isArray(l.bounds) || l.bounds.length !== 4
          || !l.bounds.every((v: unknown) => typeof v === 'number' && Number.isFinite(v))
          || l.bounds[0] < 0 || l.bounds[1] < 0 || l.bounds[2] > width || l.bounds[3] > height
          || l.bounds[0] >= l.bounds[2] || l.bounds[1] >= l.bounds[3]) { crop.reason = 'Invalid local title or quota'; continue; }
        const bounds = l.bounds.map((v: number, i: number) => v / 3 + crop.bounds[i % 2]);
        crop.result = { text: l.text, bounds };
        // Align all edges with the original row; a nearby title cannot lend its identity.
        if (bounds.some((v: number, i: number) => Math.abs(v - crop.original.bounds[i]) > 20)) { crop.reason = 'Local title geometry mismatch'; continue; }
        crop.accepted = true;
      }
      if (!fresh()) { provenance.status = 'expired'; for (const c of provenance.crops) c.accepted = false; return; }
      for (const crop of provenance.crops) if (crop.accepted) frame.lines[crop.index] = crop.result!;
      provenance.status = 'complete';
    } catch (error) {
      provenance.status = 'failed';
      for (const c of provenance.crops) { c.accepted = false; c.reason = `Local OCR failed: ${error instanceof Error ? error.message : String(error)}`; }
    }
  }

  async capture(): Promise<DeviceFrame> {
    let captureOwner: { package: string; userId: number } | undefined;
    return this.exclusive(async () => {
      this.currentFrame = undefined;
      let beforeObservation!: ForegroundObservationRecord;
      const before = await this.captureForeground(record => { beforeObservation = record; });
      captureOwner = before;
      const capturedAt = this.now();
      const bytes = await this.adb('exec-out', 'screencap', '-p');
      if (!Buffer.isBuffer(bytes) || bytes.length < 33 || bytes.length > 20 * 1024 * 1024
        || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        || bytes.toString('ascii', 12, 16) !== 'IHDR' || bytes.readUInt32BE(8) !== 13
        || !bytes.readUInt32BE(16) || !bytes.readUInt32BE(20)) throw Error('Invalid screenshot PNG dimensions');
      const id = randomUUID();
      await mkdir(this.options.evidenceDir, { recursive: true });
      const path = join(this.options.evidenceDir, id + '.png');
      await writeFile(path, bytes, { flag: 'wx' });
      const frame: DeviceFrame = { id, path, width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), capturedAt, lines: [], ...before };
      // Persist provenance before OCR so an OCR failure cannot erase the captured evidence.
      await this.save(id + '.json', { ...frame, observationError: 'OCR pending' });
      try {
        const after = await this.foreground(undefined, record => {
          frame.systemObservation = { version: 'android-system-v1', before: beforeObservation, after: record };
        });
        if (after.package !== before.package || after.userId !== before.userId) throw Error('Foreground changed during capture');
      } catch (error) {
        await this.save(id + '.json', { ...frame, observationError: 'Foreground changed during capture' });
        throw error;
      }
      try {
        const output = join(this.options.evidenceDir, id + '.ocr.json');
        await this.run(this.options.ocrBinary ?? '/Users/mater/.hermes/cache/scratch/checkin-apple-ocr', [output, path]);
        const pages = JSON.parse(await readFile(output, 'utf8')).pages;
        const page = Array.isArray(pages) && pages.length === 1 ? pages[0] : undefined;
        if (!page || page.file !== path || page.width !== frame.width || page.height !== frame.height || !Array.isArray(page.lines)) throw Error('Invalid OCR frame or bounds');
        Object.assign(frame, splitOcrObservation(page.lines, frame.width, frame.height));
        await this.refineTitles(frame, bytes, output);
        if (this.options.balanceComponent === true && frame.lines.filter(l => l.text.normalize('NFKC').trim() === '赚金币抵钱').length === 1) {
          const budgetMs = Math.min(3000, Math.floor(frame.capturedAt + (this.options.frameMaxAgeMs ?? 5000) - this.now()));
          frame.balanceEvidence = await readBalanceComponent({ fullDeviceFrame: frame, originalPNG: bytes,
            evidenceDir: this.options.evidenceDir, executionPolicy: this.options.executionPolicy, exec: this.run, budgetMs });
          if (this.now() < frame.capturedAt || this.options.executionPolicy !== 'development-unbounded-v1' && this.now() - frame.capturedAt >= (this.options.frameMaxAgeMs ?? 5000)) {
            frame.balanceEvidence = { ...frame.balanceEvidence, status: 'rejected', value: null, reason: 'Parent frame expired' };
          }
        }
      } catch (error) {
        if (!this.options.allowVisualFallback) {
          await this.save(id + '.json', { ...frame, observationError: 'OCR capture failed' });
          throw error;
        }
        frame.observationError = `OCR capture failed: ${error instanceof Error ? error.message : String(error)}`;
      }
      await this.save(id + '.json', frame);
      this.currentFrame = structuredClone(frame);
      return frame;
    }).catch(error => {
      // Only this device's completed capture can supply read-only recovery evidence.
      if (error instanceof MissingForegroundMarkers && error.recorded && error.source) this.#missingCaptures.set(error, { source: error.source, owner: captureOwner });
      throw error;
    });
  }

  consumeCaptureForegroundMissing(error: unknown, owner: { package: string; userId: number }): SystemObservationSource | null {
    if (!error || typeof error !== 'object') return null;
    const record = this.#missingCaptures.get(error);
    this.#missingCaptures.delete(error);
    if (!record || record.owner && (record.owner.package !== owner.package || record.owner.userId !== owner.userId)) return null;
    return { ...record.source };
  }

  private assertFrame(frame?: DeviceFrame) {
    const current = this.currentFrame;
    if (!frame || !current || ['id', 'path', 'width', 'height', 'capturedAt', 'package', 'userId'].some(k => (frame as any)[k] !== (current as any)[k])
      || this.options.executionPolicy !== 'development-unbounded-v1' && this.now() - current.capturedAt > (this.options.frameMaxAgeMs ?? 5000) || this.now() < current.capturedAt) throw Error('Frame missing, altered, expired or consumed');
    return current;
  }

  async act(action: DeviceAction, frame?: DeviceFrame, limits?: { beforeInput: () => void }): Promise<void> {
    return this.exclusive(async () => {
      if (!action || !['tap', 'swipe', 'back', 'wait', 'launch'].includes(action.type)) throw Error('Invalid action');
      this.launchTransition = undefined;
      let args: string[] = [];
      if (action.type === 'tap' || action.type === 'swipe') {
        const current = this.assertFrame(frame);
        const point = (x: unknown, y: unknown) => integer(x) && integer(y) && x >= 0 && y >= 0 && x < current.width && y < current.height;
        if (action.type === 'tap') {
          if (!point(action.x, action.y)) throw Error('Invalid tap coordinates');
          args = ['input', 'tap', String(action.x), String(action.y)];
        } else {
          if (!point(action.fromX, action.fromY) || !point(action.toX, action.toY) || !integer(action.ms) || action.ms <= 0 || action.ms > 5000) throw Error('Invalid swipe coordinates or duration');
          args = ['input', 'swipe', String(action.fromX), String(action.fromY), String(action.toX), String(action.toY), String(action.ms)];
        }
        // Consume before any asynchronous foreground check; an ambiguous dispatch cannot be replayed.
        this.currentFrame = undefined;
        let fg;
        try { fg = await this.foreground(); }
        catch (error) {
          if (action.type === 'tap' && error instanceof MissingForegroundMarkers && error.recorded && error.source) {
            const path = join(this.options.evidenceDir, `act-not-sent-${randomUUID()}.json`);
            const bytes = Buffer.from(JSON.stringify({ version: 'act-not-sent-v1', reason: 'foreground_markers_missing', inputSent: false,
              consumedFrameId: current.id, action: structuredClone(action), foreground: error.source, at: this.now() }, null, 2));
            await writeFile(path, bytes, { flag: 'wx' });
            this.#unsentActs.set(error, { action, frame: frame!, proof: { path, sha256: createHash('sha256').update(bytes).digest('hex') } });
          }
          throw error;
        }
        if (fg.package !== current.package || fg.userId !== current.userId) throw Error('Foreground changed before action');
        if (this.options.executionPolicy !== 'development-unbounded-v1' && this.now() - current.capturedAt > (this.options.frameMaxAgeMs ?? 5000) || this.now() < current.capturedAt) throw Error('Frame expired before action');
        limits?.beforeInput();
      } else if (action.type === 'wait') {
        if (!integer(action.ms) || action.ms < 0 || action.ms > 5000) throw Error('Invalid wait: maximum 5000ms');
        this.currentFrame = undefined;
        await new Promise(resolve => setTimeout(resolve, action.ms));
        return;
      } else if (action.type === 'back') {
        args = ['input', 'keyevent', 'KEYCODE_BACK'];
      } else {
        if (typeof action.package !== 'string' || !packagePattern.test(action.package) || !integer(action.userId) || action.userId < 0) throw Error('Invalid launch package or explicit userId');
        this.currentFrame = undefined;
        args = await this.recordedCommand('launch-resolve', ['shell', 'cmd', 'package', 'resolve-activity', '--brief', '--user', String(action.userId), '-a', 'android.intent.action.MAIN', '-c', 'android.intent.category.LAUNCHER', '-p', action.package], (raw, evidence) => {
          const components = raw.trim().split(/\r?\n/).map(line => line.trim()).filter(line => /^[\w.]+\/[\w.$]+$/.test(line));
          evidence.components = components;
          if (components.length !== 1 || !components[0].startsWith(action.package + '/')) { evidence.status = 'invalid'; throw Error('Launcher component missing or ambiguous'); }
          return ['am', 'start', '--user', String(action.userId), '-n', components[0]];
        });
      }
      this.currentFrame = undefined;
      if (action.type === 'launch') {
        let transition: NonNullable<AdbOcrDevice['launchTransition']> | undefined;
        await this.recordedCommand('launch-start', ['shell', ...args], (raw, evidence) => {
          if (/\bError:|Exception|Permission Denial|SecurityException|not allowed/i.test(raw)) { evidence.status = 'failed'; throw Error('Device action failed'); }
          const started = (this.options.monotonic ?? (() => performance.now()))();
          transition = { id: randomUUID(), package: action.package!, userId: action.userId!, started, deadline: this.options.executionPolicy === 'development-unbounded-v1' ? null : started + 1500, startCompletedAt: Number(evidence.endedAt) };
        });
        // Grant only after launch-start evidence has also been written successfully.
        this.launchTransition = transition;
      } else {
        const result = String(await this.adb('shell', ...args));
        if (/\bError:|Exception|Permission Denial|SecurityException|not allowed/i.test(result)) throw Error('Device action failed');
      }
    });
  }

  /** Caller owns the device lock and grants recovery for this exact application. */
  async restartApp(owner: {package:string;userId:number}) {
    if (!owner || !packagePattern.test(owner.package) || !integer(owner.userId) || owner.userId < 0) throw Error('Invalid restart owner');
    await this.exclusive(async()=>{
      this.currentFrame=undefined;this.launchTransition=undefined;
      await this.recordedCommand('recovery-force-stop',['shell','am','force-stop','--user',String(owner.userId),owner.package],raw=>{
        if (/\bError:|Exception|Permission Denial|SecurityException|not allowed/i.test(raw)) throw Error('Application restart failed');
        return {stopped:true};
      });
    });
    await this.act({type:'launch',package:owner.package,userId:owner.userId});
    return {restarted:true,owner,verifiedList:false};
  }

  /** Only this device's exact failed act can consume this proof. No error fields grant authority. */
  consumeUnsentTap(error: unknown, action: DeviceAction, frame: DeviceFrame) {
    if (!error || typeof error !== 'object') return null;
    const record = this.#unsentActs.get(error);
    if (!record || record.action !== action || record.frame !== frame) return null;
    this.#unsentActs.delete(error);
    return structuredClone(record.proof);
  }

  /** Explicit short-lived authority for scrolling one inspected content region; never taps. */
  async scrollContinuously(action: DeviceAction, frame: DeviceFrame, limits: {maxSwipes:number;maxMs:number;requiredMs?:number}): Promise<void> {
    return this.exclusive(async()=>{
      const current=this.assertFrame(frame);
      const point=(x:unknown,y:unknown)=>integer(x)&&integer(y)&&x>=0&&y>=0&&x<current.width&&y<current.height;
      const unbounded=this.options.executionPolicy==='development-unbounded-v1';
      const extended=limits.requiredMs===25000&&limits.maxSwipes===30&&limits.maxMs===35000&&action.ms===900;
      if(action.type!=='swipe'||!point(action.fromX,action.fromY)||!point(action.toX,action.toY)||!integer(action.ms)||action.ms<200||action.ms>1500
        ||!integer(limits.maxSwipes)||limits.maxSwipes<1||!integer(limits.maxMs)||limits.maxMs<1
        ||(!unbounded&&(limits.maxSwipes>20||limits.maxMs>20000)&&!extended))throw Error('Invalid continuous scroll bounds');
      this.currentFrame=undefined;
      const monotonic=this.options.monotonic??(()=>performance.now());
      const started=monotonic(),deadline=started+limits.maxMs;
      const remaining=()=>Math.floor(deadline-monotonic());
      const actions:{index:number;startedAt:string;action:DeviceAction;status:string}[]=[];
      let stopReason='max_swipes',dispatchedSwipes=0;
      try{
        for(let i=0;i<limits.maxSwipes;i++){
          // Reserve at least one millisecond for the check in addition to the gesture.
          const checkBudget=unbounded?undefined:remaining()-action.ms;
          if(!unbounded&&checkBudget!<1){stopReason='budget_exhausted';break;}
          stopReason='foreground_unknown';
          const fg=await this.foreground(checkBudget);
          if(!unbounded&&remaining()<=0)throw Error('Continuous scroll foreground deadline exceeded; outcome unknown');
          if(fg.package!==current.package||fg.userId!==current.userId){stopReason='foreground_changed';throw Error('Foreground changed during continuous scroll');}
          const timeoutMs=unbounded?undefined:remaining();
          if(!unbounded&&timeoutMs!<action.ms+1){stopReason='budget_exhausted';break;}
          const record={index:i,startedAt:new Date().toISOString(),action,status:'unknown'};actions.push(record);
          stopReason='dispatch_unknown';
          const raw=String((await this.run('adb',['-s',this.options.serial,'shell','input','swipe',String(action.fromX),String(action.fromY),String(action.toX),String(action.toY),String(action.ms)],timeoutMs===undefined?undefined:{timeoutMs})).stdout);
          if(!unbounded&&remaining()<=0)throw Error('Continuous scroll dispatch deadline exceeded; outcome unknown');
          if(/\bError:|Exception|Permission Denial|SecurityException|not allowed/i.test(raw)){record.status='failed';stopReason='dispatch_failed';throw Error('Continuous scroll dispatch failed');}
          record.status='dispatched';dispatchedSwipes++;stopReason='max_swipes';
        }
      }finally{await this.save('continuous-scroll.json',{sourceFrameId:current.id,limits,actions,requestedSwipes:limits.maxSwipes,dispatchedSwipes,nominalGestureMs:dispatchedSwipes*action.ms,elapsedMs:monotonic()-started,stopReason,completionInferred:false});}
    });
  }

  async prepare(): Promise<void> {
    return this.exclusive(async () => {
      if (this.originalStayOn !== undefined) throw Error('Device session already prepared; cleanup required');
      const original = String(await this.adb('shell', 'settings', 'get', 'global', 'stay_on_while_plugged_in')).trim();
      if (!/^(?:null|\d+)$/.test(original)) throw Error('Invalid original stay-on value');
      this.originalStayOn = original;
      this.currentFrame = undefined;
      this.launchTransition = undefined;
      await this.save('prepare.json', { originalStayOn: original, prepared: false });
      await this.adb('shell', 'settings', 'put', 'global', 'stay_on_while_plugged_in', '15');
      await this.adb('shell', 'input', 'keyevent', 'KEYCODE_WAKEUP');
      await this.adb('shell', 'wm', 'dismiss-keyguard');
      await new Promise(resolve => setTimeout(resolve, 1000));
      await this.save('prepare.json', { originalStayOn: original, prepared: true, wakeSettlingMs: 1000 });
    });
  }

  /** One HOME dispatch, then exact resolved HOME activity readback; never retry unknown input. */
  async returnHome(owner?: { package: string; userId: number }) {
    return this.exclusive(async () => {
      if (owner && (!packagePattern.test(owner.package) || !integer(owner.userId) || owner.userId < 0)) throw Error('Invalid return-home owner');
      const report: { confirmed: boolean; dispatchStatus: 'not-sent' | 'unknown' | 'dispatched'; home: { component: string; userId: number } | null; foreground: { package: string; userId: number; activity: string | null } | null; error?: string } = { confirmed: false, dispatchStatus: 'not-sent', home: null, foreground: null };
      const reportPath = join(this.options.evidenceDir, 'return-home.json');
      try {
        const previous = JSON.parse(await readFile(reportPath, 'utf8'));
        if (previous.dispatchStatus === 'unknown') return { ...report, dispatchStatus: 'unknown' as const, error: 'Previous HOME dispatch unknown; never replay' };
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      this.currentFrame = undefined;
      this.launchTransition = undefined;
      try {
        const userId = owner?.userId ?? (await this.foreground()).userId;
        report.home = await this.recordedCommand('home-resolve', ['shell', 'cmd', 'package', 'resolve-activity', '--brief', '--user', String(userId), '-a', 'android.intent.action.MAIN', '-c', 'android.intent.category.HOME'], (raw, evidence) => {
          const components = raw.trim().split(/\r?\n/).map(line => line.trim()).filter(line => /^[\w.]+\/[\w.$]+$/.test(line));
          evidence.components = components;
          if (components.length !== 1 || !packagePattern.test(components[0].split('/')[0])) { evidence.status = 'invalid'; throw Error('HOME component missing or ambiguous'); }
          return { component: components[0], userId };
        });
        // Persist consumed authority before dispatch. An exec error cannot establish that HOME was not sent.
        report.dispatchStatus = 'unknown';
        await this.save('return-home.json', report);
        await this.recordedCommand('home-input', ['shell', 'input', 'keyevent', 'KEYCODE_HOME'], (raw, evidence) => {
          if (/\bError:|Exception|Permission Denial|SecurityException|not allowed/i.test(raw)) { evidence.status = 'failed'; throw Error('HOME dispatch failed; outcome unknown'); }
        });
        report.dispatchStatus = 'dispatched';
        let observation: ForegroundObservationRecord | undefined;
        const foreground = await this.foreground(undefined, value => { observation = value; });
        report.foreground = { ...foreground, activity: observation?.activity ?? null };
        const canonical = (component: string) => { const [pkg, activity] = component.split('/'); return `${pkg}/${activity.startsWith('.') ? pkg + activity : activity}`; };
        report.confirmed = foreground.userId === userId && !!observation?.activity && canonical(observation.activity) === canonical(report.home.component)
          && (!owner || foreground.package !== owner.package || foreground.userId !== owner.userId);
        if (!report.confirmed) report.error = 'Resolved HOME foreground not confirmed';
      } catch (error) { report.error = error instanceof Error ? error.message : String(error); }
      await this.save('return-home.json', report);
      return report;
    });
  }

  async cleanup(): Promise<CleanupReport> {
    return this.exclusive(async () => {
      this.currentFrame = undefined;
      this.launchTransition = undefined;
      const report: CleanupReport = { stayOn: null, power: null, forwards: null, errors: [] };
      const attempt = async (name: string, op: () => Promise<unknown>) => { try { return await op(); } catch { report.errors.push(name); return undefined; } };
      if (this.originalStayOn !== undefined) {
        await attempt('restore stay-on failed', () => this.originalStayOn === 'null'
          ? this.adb('shell', 'settings', 'delete', 'global', 'stay_on_while_plugged_in')
          : this.adb('shell', 'settings', 'put', 'global', 'stay_on_while_plugged_in', this.originalStayOn!));
      }
      await attempt('sleep failed', () => this.adb('shell', 'input', 'keyevent', 'KEYCODE_SLEEP'));
      const stayOn = await attempt('stay-on readback failed', () => this.adb('shell', 'settings', 'get', 'global', 'stay_on_while_plugged_in'));
      const power = await attempt('power readback failed', () => this.adb('shell', 'dumpsys', 'power'));
      const forwards = await attempt('forward readback failed', () => this.adb('forward', '--list'));
      report.stayOn = stayOn === undefined ? null : String(stayOn).trim();
      report.power = power === undefined ? null : String(power);
      report.forwards = forwards === undefined ? null : String(forwards);
      if (this.originalStayOn !== undefined && report.stayOn !== this.originalStayOn) report.errors.push('stay-on restoration not confirmed');
      const wakefulness = report.power?.match(/\bmWakefulness\s*=\s*(\w+)/)?.[1];
      if (wakefulness !== 'Asleep' && wakefulness !== 'Dozing') report.errors.push('sleep state not confirmed');
      await this.save('cleanup.json', report);
      if (report.errors.length) throw Error('Device cleanup incomplete; see cleanup.json');
      this.originalStayOn = undefined;
      return report;
    });
  }
}
