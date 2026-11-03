/** Local Portal transport. No response bodies or upstream errors enter diagnostics. */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { withDeviceLock, type DeviceLockOptions } from './device-lock.ts';

const execFileAsync = promisify(execFile);
export class PortalError extends Error {
  constructor(message: string, readonly code = 'INVALID_ENVELOPE',
    readonly dispatch: 'not-dispatched' | 'unknown' | 'responded' = 'not-dispatched',
    readonly connectionClosed = false) {
    super(message);
    this.name = 'PortalError';
  }
}

export type PortalEnvelope<T = unknown> =
  | { status: 'success'; result: T }
  | { status: 'error'; error: string };

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function parsePortalEnvelope(raw: unknown): PortalEnvelope {
  const invalid = () => new PortalError('Invalid Portal envelope');
  let value = raw;
  if (typeof value === 'string') {
    try { value = JSON.parse(value.replace(/^\s*Row: 0 result=/, '').trim()); }
    catch { throw invalid(); }
  }
  if (!object(value)) throw invalid();
  if (value.status === 'error') return { status: 'error', error: 'Portal reported an error' };
  if (value.status !== 'success' || !Object.hasOwn(value, 'result')) throw invalid();
  let result = value.result;
  if (typeof result === 'string') {
    try { result = JSON.parse(result); } catch { /* Plain text results and tokens are valid. */ }
  }
  return { status: 'success', result };
}

export type PortalState = Record<string, unknown> & {
  a11y_tree: Record<string, unknown>; phone_state: Record<string, unknown>;
};
export type PortalHttpClientOptions = {
  baseUrl: string; token: string; fetchImpl?: typeof fetch; timeoutMs?: number;
};

export class PortalHttpClient {
  #baseUrl: string;
  #token: string;
  #fetch: typeof fetch;
  #timeoutMs: number;
  constructor(opts: PortalHttpClientOptions) {
    this.#baseUrl = opts.baseUrl;
    this.#token = opts.token;
    this.#fetch = opts.fetchImpl ?? fetch;
    this.#timeoutMs = opts.timeoutMs ?? 5000;
  }

  async #request(path: string, form?: URLSearchParams): Promise<PortalEnvelope> {
    const controller = new AbortController();
    let responded = false;
    let ownError: PortalError | undefined;
    const fault = (message: string, code: string) => {
      ownError = new PortalError(message, code, responded ? 'responded' : 'unknown');
      return ownError;
    };
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        (async () => {
          const response = await this.#fetch(new URL(path, this.#baseUrl), {
            method: form ? 'POST' : 'GET', body: form?.toString(),
            headers: { Authorization: `Bearer ${this.#token}`,
              ...(form ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) },
            signal: controller.signal, redirect: 'error',
          });
          responded = true;
          if (!response.ok) throw fault('Portal HTTP request failed', 'HTTP');
          const body = await response.text();
          try { return parsePortalEnvelope(body); }
          catch { throw fault('Invalid Portal envelope', 'INVALID_ENVELOPE'); }
        })(),
        new Promise<never>((_, reject) => { timer = setTimeout(() => {
          reject(fault('Portal request timed out', 'TIMEOUT'));
          controller.abort();
        }, this.#timeoutMs); }),
      ]);
    } catch (error) {
      if (error === ownError && ownError) throw ownError;
      if (!responded && object(error) && (error.code === 'ECONNREFUSED' || (object(error.cause) && error.cause.code === 'ECONNREFUSED'))) {
        throw new PortalError('Portal server unavailable', 'UNAVAILABLE', 'unknown');
      }
      const code = object(error) ? (object(error.cause) ? error.cause.code : undefined) ?? error.code : undefined;
      const connectionClosed = !responded && (code === undefined || ['ECONNRESET', 'EPIPE', 'UND_ERR_SOCKET'].includes(String(code)));
      throw new PortalError('Portal transport failed', 'TRANSPORT', responded ? 'responded' : 'unknown', connectionClosed);
    } finally { clearTimeout(timer); }
  }

  /** Confirms this endpoint is Portal; a bare HTTP 200 is insufficient. */
  async ping(): Promise<void> {
    const envelope = await this.#request('/ping');
    if (envelope.status !== 'success' || envelope.result !== 'pong') {
      throw new PortalError('Portal ping failed', 'PING', 'responded');
    }
  }

  /** Preserves degradation/age metadata. A response does not establish freshness. */
  async readState(): Promise<PortalState> {
    const envelope = await this.#request('/state_full?filter=false');
    if (envelope.status === 'error') throw new PortalError('Portal reported an error', 'REMOTE', 'responded');
    const state = envelope.result;
    if (!object(state) || !object(state.a11y_tree) || !object(state.phone_state)) {
      throw new PortalError('Invalid Portal state', 'INVALID_STATE', 'responded');
    }
    return state as PortalState;
  }

  /** Base64 PNG envelope, normalized for consumers sharing this exact capture. */
  async screenshot(): Promise<string> {
    const envelope = await this.#request('/screenshot');
    if (envelope.status === 'error') throw new PortalError('Portal reported an error', 'REMOTE', 'responded');
    const result = envelope.result;
    if (typeof result !== 'string') throw new PortalError('Invalid Portal screenshot', 'INVALID_SCREENSHOT', 'responded');
    const base64 = result.replace(/^data:image\/png;base64,/, '');
    const bytes = Buffer.from(base64, 'base64');
    if (!base64 || bytes.toString('base64') !== base64 || bytes.length < 45
      || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      || bytes.readUInt32BE(8) !== 13 || bytes.toString('ascii', 12, 16) !== 'IHDR'
      || bytes.readUInt32BE(16) === 0 || bytes.readUInt32BE(20) === 0
      || bytes.readUInt32BE(bytes.length - 12) !== 0 || bytes.toString('ascii', bytes.length - 8, bytes.length - 4) !== 'IEND') {
      throw new PortalError('Invalid Portal screenshot', 'INVALID_SCREENSHOT', 'responded');
    }
    return `data:image/png;base64,${base64}`;
  }

  async #action(path: string, fields: Record<string, number>): Promise<PortalActionReceipt> {
    if (Object.values(fields).some((value) => !Number.isFinite(value) || value < 0)) {
      throw new PortalError('Invalid Portal action', 'INVALID_ACTION');
    }
    const form = new URLSearchParams(Object.entries(fields).map(([key, value]) => [key, String(value)]));
    const envelope = await this.#request(path, form);
    return { dispatch: 'responded', portalStatus: envelope.status, businessSuccess: 'unverified' };
  }

  back(): Promise<PortalActionReceipt> {
    return this.#action('/global', { action: 1 });
  }

  tap(x: number, y: number): Promise<PortalActionReceipt> {
    return this.#action('/tap', { x, y });
  }

  /** Coordinates follow Portal's documented names; duration is milliseconds. */
  swipe(params: PortalSwipe): Promise<PortalActionReceipt> {
    return this.#action('/swipe', params);
  }
}

export type PortalSwipe = { startX: number; startY: number; endX: number; endY: number; duration: number };
export type PortalActionReceipt = {
  dispatch: 'responded'; portalStatus: 'success' | 'error'; businessSuccess: 'unverified';
};

/** A missing/unreadable/malformed table cannot establish that a port is free. */
function listenerInTable(raw: string, ipv6: boolean): 'absent' | 'occupied' | 'unknown' {
  const lines = raw.split(/\r?\n/).map(line=>line.trim()).filter(Boolean);
  if (!/^sl\s+local_address\s+(?:rem_address|remote_address)\s+st\s+tx_queue\s+rx_queue\s+tr\s+tm->when\s+retrnsmt\s+uid\s+timeout\s+inode$/.test(lines[0] ?? '')) return 'unknown';
  const address = `[0-9a-fA-F]{${ipv6 ? 32 : 8}}:[0-9a-fA-F]{4}`;
  const row = new RegExp(`^\\d+:\\s+(${address})\\s+${address}\\s+(0[1-9A-Da-d])\\s+[0-9a-fA-F]{8}:[0-9a-fA-F]{8}\\s+[0-9a-fA-F]{2}:[0-9a-fA-F]{8}\\s+[0-9a-fA-F]{8}\\s+\\d+\\s+\\d+\\s+\\d+(?:\\s+[0-9a-fA-F]+)*$`);
  let occupied = false;
  for (const line of lines.slice(1)) {
    const match = row.exec(line.trim());
    if (!match) return 'unknown';
    if (match[1].slice(-4).toUpperCase() === '1F90' && match[2].toUpperCase() === '0A') occupied = true;
  }
  return occupied ? 'occupied' : 'absent';
}

export type PortalExec = (file: string, args: string[]) => Promise<{ stdout: string }>;
export type LocalPortalSessionOptions = DeviceLockOptions & {
  startServer?: boolean; exec?: PortalExec; fetchImpl?: typeof fetch; requestTimeoutMs?: number;
};

/** Owns an ephemeral forward. Device exclusion extends through all cleanup. */
export function withLocalPortalSession<T>(
  fn: (client: PortalHttpClient) => Promise<T>, opts: LocalPortalSessionOptions = {},
): Promise<T> {
  const serial = opts.serial ?? process.env.ADB_SERIAL ?? '3d8a7934';
  return withDeviceLock(async () => {
    const exec: PortalExec = opts.exec ?? (async (file, args) => {
      const result = await execFileAsync(file, args, { encoding: 'utf8', timeout: 10000, maxBuffer: 1024 * 1024 });
      return { stdout: result.stdout };
    });
    const adb = async (...args: string[]) => {
      try { return (await exec('adb', ['-s', serial, ...args])).stdout; }
      catch { throw new PortalError('Portal ADB operation failed', 'ADB'); }
    };
    let port: string | undefined;
    let startedServer = false;
    let failed = false;
    const toggleServer = async (enabled: boolean) => {
      const output = (await adb('shell', 'content', 'insert', '--uri',
        'content://com.mobilerun.portal/toggle_socket_server', '--bind', `enabled:b:${enabled}`)).trim();
      // Empty content-insert stdout is a pending acknowledgement; startup still requires ping.
      if (!output || output === 'Inserted content://com.mobilerun.portal/toggle_socket_server') return;
      const envelope = parsePortalEnvelope(output);
      if (envelope.status !== 'success') throw new PortalError('Portal server toggle failed', 'SERVER');
    };
    try {
      const allocated = (await adb('forward', 'tcp:0', 'tcp:8080')).trim();
      if (!/^\d+$/.test(allocated) || Number(allocated) < 1 || Number(allocated) > 65535) {
        throw new PortalError('Invalid Portal forward allocation', 'FORWARD');
      }
      port = allocated;
      const baseUrl = `http://127.0.0.1:${port}`;
      const probe = new PortalHttpClient({ baseUrl, token: '', fetchImpl: opts.fetchImpl,
        timeoutMs: opts.requestTimeoutMs });
      try { await probe.ping(); }
      catch (error) {
        if (!(error instanceof PortalError) || opts.startServer !== true) throw error;
        if (error.code !== 'UNAVAILABLE') {
          if (error.code !== 'TRANSPORT' || !error.connectionClosed) throw error;
          let tcp: 'absent' | 'occupied' | 'unknown' = 'unknown';
          let tcp6: 'absent' | 'occupied' | 'unknown' = 'unknown';
          try {
            tcp = listenerInTable(await adb('shell', 'cat', '/proc/net/tcp'), false);
            tcp6 = listenerInTable(await adb('shell', 'cat', '/proc/net/tcp6'), true);
          } catch { /* Failed inspection leaves the original transport error primary. */ }
          if (tcp !== 'absent' || tcp6 !== 'absent') throw error;
        }
        // The command may take effect even if execution/acknowledgement parsing fails.
        startedServer = true;
        await toggleServer(true);
        await probe.ping();
      }
      const auth = parsePortalEnvelope(await adb('shell', 'content', 'query', '--uri',
        'content://com.mobilerun.portal/auth_token'));
      if (auth.status !== 'success' || typeof auth.result !== 'string' || !auth.result.trim()) {
        throw new PortalError('Portal authentication token unavailable', 'AUTH');
      }
      return await fn(new PortalHttpClient({ baseUrl, token: auth.result,
        fetchImpl: opts.fetchImpl, timeoutMs: opts.requestTimeoutMs }));
    } catch (error) {
      failed = true;
      throw error;
    } finally {
      let cleanupFailed = false;
      if (startedServer) {
        try { await toggleServer(false); } catch { cleanupFailed = true; }
      }
      if (port) {
        try { await adb('forward', '--remove', `tcp:${port}`); } catch { cleanupFailed = true; }
      }
      if (cleanupFailed && !failed) throw new PortalError('Portal session cleanup failed', 'CLEANUP');
    }
  }, { ...opts, serial });
}
