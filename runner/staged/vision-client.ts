import { open } from 'node:fs/promises';

export type VisionFrame = { id: string; path: string; width: number; height: number; capturedAt: number };
export type VisionUsage = { calls: number; tokens: number | null; promptTokens: number | null; completionTokens: number | null; ms: number | null; error: string | null };
export type VisionClientOptions = { baseUrl: string; apiKey: string; model: string; timeoutMs?: number; fetch?: typeof fetch };

/** Observation only. Exactly one HTTP attempt; no SDK retries or device capabilities. */
export class VisionClient {
  public readonly usage: VisionUsage[] = [];
  private readonly options: VisionClientOptions;
  private readonly endpoint: string;

  constructor(options: VisionClientOptions) {
    let url: URL;
    try { url = new URL(options.baseUrl); } catch { throw Error('Invalid vision configuration'); }
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash
      || !options.apiKey?.trim() || !options.model?.trim()
      || (options.timeoutMs !== undefined && (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0))) {
      throw Error('Invalid vision configuration');
    }
    this.options = { ...options };
    this.endpoint = url.href.replace(/\/+$/, '') + '/chat/completions';
  }

  async query({ prompt, frame, context, signal, maxMs }: { prompt: string; frame?: VisionFrame; context?: unknown; signal?: AbortSignal; maxMs?: number }): Promise<any> {
    const started = Date.now();
    const usage: VisionUsage = { calls: 0, tokens: null, promptTokens: null, completionTokens: null, ms: null, error: null };
    this.usage.push(usage);
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let failure = 'Vision query failed';
    const abort = () => { failure = 'Vision query aborted'; controller.abort(); };
    try {
      if (typeof prompt !== 'string' || !prompt.trim()) throw Error();
      if (maxMs !== undefined && (!Number.isFinite(maxMs) || maxMs <= 0)) { failure = 'Vision budget exhausted'; throw Error(); }
      if (signal?.aborted) { failure = 'Vision query aborted'; throw Error(); }
      const deadlineMs = Math.min(this.options.timeoutMs ?? 30000, maxMs ?? Infinity);
      signal?.addEventListener('abort', abort, { once: true });
      const cancelled = new Promise<never>((_resolve, reject) => {
        controller.signal.addEventListener('abort', () => reject(Error()), { once: true });
        timer = setTimeout(() => { failure = 'Vision query timeout'; controller.abort(); }, deadlineMs);
      });
      const work = async () => {
        const content: any[] = [{ type: 'text', text: JSON.stringify({ prompt, frame: frame && { id: frame.id, width: frame.width, height: frame.height, capturedAt: frame.capturedAt }, context }) }];
        if (frame) {
          const bytes = await readPng(frame);
          content.push({ type: 'image_url', image_url: { url: 'data:image/png;base64,' + bytes.toString('base64') } });
        }
        // File validation and context serialization consume the same remaining budget.
        if (controller.signal.aborted || Date.now() - started >= deadlineMs) { failure = 'Vision query timeout'; throw Error(); }
        usage.calls = 1;
        const response = await (this.options.fetch ?? globalThis.fetch)(this.endpoint, {
          method: 'POST', headers: { Authorization: `Bearer ${this.options.apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: this.options.model, response_format: { type: 'json_object' }, messages: [
            { role: 'system', content: 'Read only the supplied evidence. Return one structured JSON object, with unknown facts null. Never invent observations or execute actions.' },
            { role: 'user', content },
          ] }), signal: controller.signal,
        });
        if (!response.ok) { failure = 'Vision HTTP request failed'; throw Error(); }
        const data = await response.json();
        // A late, ignored abort must never mutate an already completed usage entry.
        if (controller.signal.aborted) throw Error();
        const measured = (n: unknown) => typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : null;
        usage.tokens = measured(data.usage?.total_tokens);
        usage.promptTokens = measured(data.usage?.prompt_tokens);
        usage.completionTokens = measured(data.usage?.completion_tokens);
        const text = data.choices?.[0]?.message?.content;
        if (typeof text !== 'string') throw Error();
        const result = JSON.parse(text.trim().replace(/^```(?:json)?\s*\n([\s\S]*?)\n```$/, '$1'));
        if (!result || typeof result !== 'object' || Array.isArray(result)) throw Error();
        return result;
      };
      return await Promise.race([work(), cancelled]);
    } catch {
      usage.error = failure;
      throw Error(failure);
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      usage.ms = Date.now() - started;
    }
  }
}

async function readPng(frame: VisionFrame): Promise<Buffer> {
  if (!frame.id || typeof frame.path !== 'string' || !frame.path || !Number.isFinite(frame.capturedAt)
    || !Number.isSafeInteger(frame.width) || !Number.isSafeInteger(frame.height) || frame.width <= 0 || frame.height <= 0) throw Error();
  const file = await open(frame.path, 'r');
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size < 33 || stat.size > 20 * 1024 * 1024) throw Error();
    const bytes = await file.readFile();
    if (bytes.length !== stat.size || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      || bytes.toString('ascii', 12, 16) !== 'IHDR' || bytes.readUInt32BE(8) !== 13
      || bytes.readUInt32BE(16) !== frame.width || bytes.readUInt32BE(20) !== frame.height) throw Error();
    return bytes;
  } finally { await file.close(); }
}
