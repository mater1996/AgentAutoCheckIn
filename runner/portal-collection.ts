import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { collectInventory, type InventoryScanAgent, type InventoryScanOptions, type InventoryScanResult } from './inventory-scan.ts';
import type { HybridObservation, PortalHybrid } from './portal-hybrid.ts';
import type { PortalBounds } from './portal-observation.ts';

const validCounter = (value: unknown) => {
  if (typeof value !== 'string' || !/^\d+\s*\/\s*\d+$/.test(value)) return false;
  const [done, total] = value.split('/').map(Number);
  return Number.isSafeInteger(done) && Number.isSafeInteger(total) && total > 0 && done <= total;
};
const validBounds = (b: PortalBounds | null, o: HybridObservation) => !!b
  && [b.left, b.top, b.right, b.bottom].every(Number.isFinite)
  && b.left >= 0 && b.top >= 0 && b.right > b.left && b.bottom > b.top
  && b.right <= o.frame.width && b.bottom <= o.frame.height;

function validateObservation(o: HybridObservation, panelText: string) {
  if (!o || typeof o.id !== 'string' || !o.id || !o.frame || typeof o.frame.id !== 'string' || !o.frame.id
    || !Number.isFinite(o.frame.width) || o.frame.width <= 0 || !Number.isFinite(o.frame.height) || o.frame.height <= 0
    || !Number.isFinite(o.frame.capturedAt) || !['portal', 'vision'].includes(o.rowSource)) {
    throw new Error('Invalid observation provenance');
  }
  if (o.pageIdentity !== panelText || o.blocked !== false) throw new Error('Expected unblocked task panel');
  if (typeof o.atTop !== 'boolean' || typeof o.atBottom !== 'boolean'
    || !o.boundaryEvidence || typeof o.boundaryEvidence.top !== 'string' || typeof o.boundaryEvidence.bottom !== 'string'
    || (o.atTop && !o.boundaryEvidence.top.trim()) || (o.atBottom && !o.boundaryEvidence.bottom.trim())) {
    throw new Error('Explicit top/bottom boundary evidence required');
  }
  if (!Array.isArray(o.tiers) || o.tiers.some(t => !t || typeof t.coin !== 'number' || !Number.isFinite(t.coin)
    || t.coin <= 0 || typeof t.need !== 'string' || typeof t.button !== 'string')) throw new Error('Invalid tiers');
  if (o.progress !== null && !validCounter(o.progress)) throw new Error('Invalid progress');
  if (o.atTop && !validCounter(o.progress)) throw new Error('Top progress required');
  if (!Array.isArray(o.rows) || o.rows.some(r => !r || typeof r.name !== 'string' || !r.name.trim()
    || typeof r.instruction !== 'string' || !validCounter(r.quota)
    || (r.reward !== null && (typeof r.reward !== 'number' || !Number.isFinite(r.reward) || r.reward < 0))
    || !r.button || typeof r.button.text !== 'string' || !r.button.text.trim() || !validBounds(r.button.bounds, o))) {
    throw new Error('Invalid task rows');
  }
  if (o.scrollBounds !== null && !validBounds(o.scrollBounds, o)) throw new Error('Invalid scroll area');
}

/** Collection deliberately has no task or navigation dispatcher. */
export type PortalCollectionBridge = Pick<PortalHybrid, 'observe' | 'swipe'>;
export type PortalCollectionOptions = InventoryScanOptions & { panelText?: string };

/** Reuse the inventory collector's merging, completeness and top signature checks. */
export async function collectPortalInventory(bridge: PortalCollectionBridge, options: PortalCollectionOptions): Promise<InventoryScanResult> {
  const evidenceDir = path.resolve(options.evidenceDir ?? 'data/evidence/inventory-scans');
  const observationsDir = path.join(evidenceDir, `portal-${randomUUID()}`);
  let ordinal = 0;
  let cached: unknown;
  let last: HybridObservation | undefined;
  let stopped: unknown;
  // collectInventory always attempts a final return. A failed bridge operation
  // latches the adapter so that cleanup cannot issue a recovery gesture.
  const guarded = async <T>(operation: () => Promise<T>): Promise<T> => {
    if (stopped !== undefined) throw stopped;
    try { return await operation(); }
    catch (error) { stopped = error ?? new Error('Collection stopped'); throw stopped; }
  };
  const observe = async () => {
    const observation = await bridge.observe();
    const localOrdinal = ++ordinal;
    fs.mkdirSync(observationsDir, { recursive: true });
    const stem = path.join(observationsDir, String(localOrdinal).padStart(4, '0'));
    const observationFile = `${stem}.json`, imageFile = `${stem}.png`;
    fs.writeFileSync(observationFile, JSON.stringify({ ordinal: localOrdinal, observation }, null, 2));
    const image = observation?.frame?.dataUrl?.match(/^data:image\/png;base64,([A-Za-z0-9+/]+={0,2})$/);
    if (!image) throw new Error('PNG frame evidence required');
    const bytes = Buffer.from(image[1], 'base64');
    if (bytes.toString('base64') !== image[1] || bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') {
      throw new Error('Invalid PNG frame evidence');
    }
    fs.writeFileSync(imageFile, bytes);
    validateObservation(observation, options.panelText ?? '赚金币抵钱');
    const raw = {
      pageIsTaskPanel: observation.pageIdentity === (options.panelText ?? '赚金币抵钱'), blocked: observation.blocked,
      atTop: observation.atTop, atBottom: observation.atBottom, boundaryEvidence: observation.boundaryEvidence,
      progress: observation.progress, tiers: observation.tiers,
      tasks: observation.rows.map(row => ({ name: row.name, instruction: row.instruction, quota: row.quota,
        button: row.button.text, reward: row.reward === null ? 0 : row.reward })),
      source: { ordinal: localOrdinal, observationId: observation.id, frameId: observation.frame.id,
        rowSource: observation.rowSource, observationFile, imageFile },
    };
    last = observation;
    return { observation, raw };
  };
  const swipe = async (towardTop: boolean) => {
    if (!last?.scrollBounds) throw new Error('Empty scroll area');
    const observation = last;
    const b = observation.scrollBounds!;
    const x = b.left + (b.right - b.left) * 0.5;
    const upper = b.top + (b.bottom - b.top) * 0.2;
    const lower = b.top + (b.bottom - b.top) * 0.8;
    last = undefined;
    cached = undefined;
    const receipt = await bridge.swipe(observation, { startX: x, startY: towardTop ? upper : lower,
      endX: x, endY: towardTop ? lower : upper, duration: 450 });
    if (receipt.status !== 'dispatched') throw new Error(`Swipe unresolved: ${receipt.status}`);
  };
  const agent: InventoryScanAgent = {
    aiQuery: async () => guarded(async () => {
      if (cached !== undefined) { const raw = cached; cached = undefined; return raw; }
      return (await observe()).raw;
    }),
    aiScroll: async (_prompt, action) => guarded(async () => {
      if (action.scrollType === 'singleAction') {
        if (action.direction !== 'down') throw new Error('Unsupported collection scroll');
        await swipe(false);
        return;
      }
      let next = await observe();
      for (let count = 0; !next.observation.atTop && count < 6; count++) {
        await swipe(true);
        next = await observe();
      }
      if (!next.observation.atTop) throw new Error('Top not confirmed after 6 swipes');
      cached = next.raw;
    }),
  };
  return collectInventory(agent, options);
}
