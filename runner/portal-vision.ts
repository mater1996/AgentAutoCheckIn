// Configure the existing model channel before the lazy @midscene/core import.
import './model';
import type { MidsceneUsageMetrics } from '@midscene/core';
import type { AbstractInterface } from '@midscene/core/device';

export type PortalVisionFrame = Readonly<{
  id: string; dataUrl: string; width: number; height: number; capturedAt: number;
}>;
export type PortalVisionAgent = {
  aiQuery(prompt: string): Promise<unknown>;
  readonly metrics: MidsceneUsageMetrics;
  destroy(): Promise<void>;
};
export type PortalVisionAgentFactory = (device: AbstractInterface) => PortalVisionAgent | Promise<PortalVisionAgent>;

/** Observation only: there is no device transport or input implementation. */
export class PortalVision {
  #factory: PortalVisionAgentFactory;
  #usage: MidsceneUsageMetrics | null = null;
  #destroyed = false;
  #pending = new Set<Promise<unknown>>();
  constructor(factory: PortalVisionAgentFactory = async device => {
    const { Agent } = await import('@midscene/core');
    return new Agent(device, { generateReport: false, persistExecutionDump: false,
      autoPrintReportMsg: false, cache: false });
  }) { this.#factory = factory; }
  get usage(): MidsceneUsageMetrics | null { return structuredClone(this.#usage); }
  async destroy(): Promise<void> {
    this.#destroyed = true;
    await Promise.allSettled([...this.#pending]);
  }

  async query<T = unknown>(frame: PortalVisionFrame, prompt: string): Promise<T> {
    if (this.#destroyed) throw new Error('Portal vision adapter destroyed');
    const pending = this.#query<T>(frame, prompt);
    this.#pending.add(pending);
    try { return await pending; }
    finally { this.#pending.delete(pending); }
  }

  async #query<T>(frame: PortalVisionFrame, prompt: string): Promise<T> {
    // Snapshot before any await; caller mutation cannot change this observation.
    if (!frame || typeof frame !== 'object') throw new Error('Invalid static frame');
    const { id, dataUrl, width, height, capturedAt } = frame;
    if (typeof id !== 'string' || !id.trim() || typeof dataUrl !== 'string'
      || !/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/.test(dataUrl)
      || !Number.isSafeInteger(width) || width <= 0
      || !Number.isSafeInteger(height) || height <= 0
      || typeof capturedAt !== 'number' || !Number.isFinite(capturedAt) || capturedAt < 0)
      throw new Error('Invalid static frame');
    try {
      const { imageInfoOfBase64 } = await import('@midscene/shared/img');
      const actual = await imageInfoOfBase64(dataUrl);
      if (actual.width !== width || actual.height !== height) throw new Error();
    } catch {
      // Do not expose image data or decoder/provider payloads in errors.
      throw new Error('Invalid static frame');
    }
    const device = {
      interfaceType: 'portal-static-screenshot',
      screenshotBase64: async () => dataUrl,
      size: async () => ({ width, height }),
      actionSpace: () => [],
    } satisfies AbstractInterface;
    try {
      const agent = await this.#factory(device);
      try {
        return await agent.aiQuery(prompt) as T;
      } finally {
        try {
          const usage = structuredClone(agent.metrics);
          if (!this.#usage) this.#usage = usage;
          else {
            for (const key of ['totalPromptTokens', 'totalCompletionTokens', 'totalTokens',
              'totalCachedInput', 'totalTimeCostMs', 'calls'] as const) this.#usage[key] += usage[key];
            for (const group of ['byIntent', 'byModel'] as const) {
              for (const [name, bucket] of Object.entries(usage[group])) {
                const previous = this.#usage[group][name];
                if (!previous) this.#usage[group][name] = bucket;
                else for (const key of ['promptTokens', 'completionTokens', 'totalTokens', 'calls'] as const)
                  previous[key] += bucket[key];
              }
            }
          }
        } finally {
          await agent.destroy();
        }
      }
    } catch {
      throw new Error('Static vision query failed');
    }
  }
}
