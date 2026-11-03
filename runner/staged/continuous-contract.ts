import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { DeviceFrame } from './device.ts';
import { inspectLearnedBrowse, inspectCurrentLearnedBrowse, type LearnedBrowseOptions } from './learned-browse.ts';
export type ContinuousPolicy = { policy: 'current-components-v1' };

type Owner = { package: string; userId: number };
type Inspection = NonNullable<Awaited<ReturnType<typeof inspectLearnedBrowse>>>;
type Inspector = typeof inspectLearnedBrowse;
type Source = Readonly<{ sourceRunId: number; frameId: string; directory: string; pngSha256: string; jsonSha256: string; role: 'learned' | 'regression' }>;
export type ContinuousContract = Readonly<{
  option: Readonly<LearnedBrowseOptions>;
  inspection: Inspection;
  budget: Readonly<{ maxSwipes: number; maxMs: number; requiredMs?: 25000 }>;
  provenance: readonly Source[];
}>;
const source = (sourceRunId: number, directory: string, frameId: string, pngSha256: string, jsonSha256: string, role: Source['role'] = 'learned'): Source =>
  Object.freeze({ sourceRunId, directory, frameId, pngSha256, jsonSha256, role });
const sources = {
  completed20: source(194, 'staged-2026-11-01T11-50-22-744Z', '1c143332-c14b-48b1-97a0-18124fc338d3', 'b37d3975dd1523d024a49388d4110d90bbe8b45ad7e8ee1af1e188d40827d915', '11ddb2d2175c82af8ea1d2d07d732df682b8bccd97b8114fa23f6b1c07e1c9f4'),
  twenty: source(171, 'staged-2026-11-01T08-46-52-728Z', '84707f78-82f4-414c-9664-d72f8e681624', '4fbeb2e6bf019d6154b4111f8603a126fd7745d17310d1b1d9033d597cc51dc7', '97bd52072c3e91884a550a45083571b4956fda06ef811a1590b0dcb5e8a230b4'),
  twentyFive: source(187, 'staged-2026-11-01T11-01-03-757Z', '3b776de9-f796-4337-875e-f1aec45bfb17', '089d62d537769e7d03e4dc2c5256aefd32b17755ba9e30a211a28876480e5e6f', '8dab50bad19ce4cf1186d4c415dad98b248d280612c2d00ab4054829566bee9d'),
  completed50: source(153, 'continuous-supervised-2026-11-01T05-18-43-216Z', '17cbd398-0659-40fc-90d7-79d3ee3c188f', '10e464ba26ad750db0be15d5048b2cb0e1272b6bed0c2ac807c92667ab27d4ca', '0b7b64446330943c772f9f964ff3b8604ab48908153ff04168800767b6846629'),
  fifty: source(153, 'continuous-supervised-2026-11-01T05-18-43-216Z', 'bfbc7cc8-510d-4133-82f7-1a432fa97af7', 'dc814094426101581fa98d2db6cffdc0c5dca7f974db647e340c767cfa600db6', '1995fac28f19705b36a02e0dfe8466195c3a159ac3457016b9f1ddfae724fdc8'),
  regression20: source(192, 'staged-2026-11-01T11-30-56-472Z', 'd974083a-8310-49d9-ac1d-7ccc99bd511c', '650ae571988698161b3d7b7217d7d0f34000784fb990905a7c6ff2214c97763c', '583f67abd3bca25488286ccce009f0d2807b73c9720461333ab5cb144c658069', 'regression'),
};
const candidates = [
  { option: { rewardCoins: 50, requiredMs: 25000 } as LearnedBrowseOptions, provenance: [sources.twentyFive, sources.fifty, sources.completed50] },
  { option: { rewardCoins: 20 } as LearnedBrowseOptions, provenance: [sources.twenty, sources.regression20, sources.fifty, sources.completed20] },
  { option: { rewardCoins: 50 } as LearnedBrowseOptions, provenance: [sources.fifty, sources.completed50] },
];
const bound = new WeakMap<ContinuousContract, Owner & { policy?: 'current-components-v1' }>();
async function verified(provenance: readonly Source[]) {
  try {
    for (const s of provenance) for (const [extension, expected] of [['png', s.pngSha256], ['json', s.jsonSha256]]) {
      const bytes = await readFile(new URL(`../../evidence/${s.directory}/${s.frameId}.${extension}`, import.meta.url));
      if (createHash('sha256').update(bytes).digest('hex') !== expected) return false;
    }
    return true;
  } catch { return false; }
}

/** Offline component only: no entry dispatch, device operation or runtime integration.
 * A supplied inspector is a negative-test seam and can never grant a contract. */
export async function selectContinuousContract(frame: DeviceFrame, owner: Owner, dependencies: { inspect?: Inspector } = {}, options?: ContinuousPolicy): Promise<ContinuousContract | null> {
  if (options !== undefined && options.policy !== 'current-components-v1') return null;
  const inspect = options ? inspectCurrentLearnedBrowse : inspectLearnedBrowse;
  const matches: { candidate: typeof candidates[number]; inspection: Inspection }[] = [];
  try {
    for (const candidate of candidates) {
      const inspection = await (dependencies.inspect ?? inspect)(frame, owner, candidate.option);
      if (inspection?.state === 'browsing') matches.push({ candidate, inspection });
    }
    if (matches.length !== 1 || dependencies.inspect) return null;
    const { candidate, inspection } = matches[0];
    if (!await verified(candidate.provenance)) return null;
    const option = Object.freeze({ ...candidate.option });
    const result: ContinuousContract = Object.freeze({ option, inspection,
      budget: Object.freeze(option.requiredMs === 25000 ? { maxSwipes: 30, maxMs: 35000, requiredMs: 25000 as const } : { maxSwipes: 16, maxMs: 18000 }),
      provenance: Object.freeze([...candidate.provenance]),
    });
    bound.set(result, { ...owner, ...(options ? { policy: options.policy } : {}) });
    return result;
  } catch { return null; }
}

/** Reuse the selected option, including for receipts; never select from a later
 * countdown or completion page. Unknown evidence returns no authority. */
export async function inspectSelectedContinuousContract(frame: DeviceFrame, owner: Owner, selected: ContinuousContract, options?: ContinuousPolicy): Promise<{
  inspection: Inspection | null; needsLearning: boolean;
}> {
  const binding = bound.get(selected);
  if (!binding || !owner || binding.package !== owner.package || binding.userId !== owner.userId
    || binding.policy !== options?.policy)
    return { inspection: null, needsLearning: true };
  if (!await verified(selected.provenance))
    return { inspection: null, needsLearning: true };
  const inspection = await (options ? inspectCurrentLearnedBrowse : inspectLearnedBrowse)(frame, owner, selected.option);
  return { inspection, needsLearning: inspection === null };
}
