import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { DeviceAction, DeviceFrame } from './device.ts';
import { type CandidateOwner, type EvidenceRef, type LocalContract, componentMatches, historicalContract, normalize,
  one, panelIdentity, pngPixels, readHistoricalFrame, sealContract, sha256, validCandidateFrame, verifyContract } from './panel-claim.ts';

export type ShopCard = { name: string; button: 'fresh' | 'again'; bounds: number[]; point: [number, number] };
export type ShopInspection = { page: 'activity' | 'shopList' | 'store'; completed: boolean; cards: ShopCard[];
  storeName?: string; quote?: string; amount?: number; pngSha256: string };
const run136 = 'staged-2026-11-01T02-34-47-568Z';
const run137 = 'staged-2026-11-01T03-05-55-412Z';

export async function buildShopBrowseContract(root: string) {
  const c = await historicalContract(root, 138, 'shop-browse');
  const refs = [...c.refs];
  for (const directory of [run136, run137]) {
    const path = join(root, 'evidence', directory, 'result.json');
    refs.push({ path, sha256: sha256(await readFile(path)) });
  }
  const result = JSON.parse(await readFile(refs[0].path, 'utf8'));
  const original = JSON.parse(await readFile(refs[1].path, 'utf8'));
  const recovery = JSON.parse(await readFile(refs[2].path, 'utf8'));
  if (result.runId !== 138 || result.sourceRunId !== 136 || result.recoveryRunId !== 137 || result.gainCoins !== 30
    || result.automaticRunnerAcceptance !== false || result.taskAttemptId !== original.taskAttemptId
    || result.taskAttemptId !== recovery.taskAttemptId || recovery.sourceRunId !== 136) throw Error('Unproven shop source ownership');
  const contract = sealContract({ ...c, refs });
  await verifyContract(contract);
  return contract;
}
export async function loadShopBrowseReplay(c: LocalContract) {
  await verifyContract(c);
  const settlement = JSON.parse(await readFile(c.refs[0].path, 'utf8'));
  return { frames: await Promise.all(c.fixtures.map(f => readHistoricalFrame(f))), taskAttemptId: settlement.taskAttemptId,
    settlement, historicalEntryOwnershipVerified: false };
}
function within(b: number[], x: number, y: number, tolerance: number) { return Math.abs(b[0] - x) <= tolerance && Math.abs(b[1] - y) <= tolerance; }
function ink(pixels: Buffer, box: number[]) {
  let low = 255, high = 0;
  for (let y = Math.ceil(box[1]); y < Math.floor(box[3]); y += 2) for (let x = Math.ceil(box[0]); x < Math.floor(box[2]); x += 2) {
    const i = (y * 1080 + x) * 3, value = (pixels[i] + pixels[i + 1] + pixels[i + 2]) / 3;
    low = Math.min(low, value); high = Math.max(high, value);
  }
  return high - low > 90;
}

/** Local spatial PNG/OCR contracts; no device/model access, no completion from gain totals. */
export async function inspectShopBrowse(frame: DeviceFrame, owner: CandidateOwner, c: LocalContract): Promise<ShopInspection | null> {
  try {
    if (!validCandidateFrame(frame, owner) || c.family !== 'shop-browse') return null;
    await verifyContract(c);
    const image = await pngPixels(frame.path), lines = frame.lines;
    const base = { cards: [] as ShopCard[], completed: false, pngSha256: image.hash };
    if (await panelIdentity(frame, image.pixels, c.fixtures[0])) return { ...base, page: 'activity' };
    const title = one(lines.filter(l => normalize(l.text) === '逛好店得金币'));
    if (title) {
      const requirement = one(lines.filter(l => /^今日推荐[1-9]\d?家好店,店铺支持金币抵扣$/.test(normalize(l.text))));
      if (!requirement || requirement.bounds[1] < 250 || requirement.bounds[3] > 350) return null;
      let reference: Buffer | undefined;
      for (const index of [1, 4]) {
        const f = await readHistoricalFrame(c.fixtures[index]);
        const t = one(f.lines.filter(l => normalize(l.text) === '逛好店得金币'))!;
        const dx = Math.round(title.bounds[0] - t.bounds[0]), dy = Math.round(title.bounds[1] - t.bounds[1]);
        const pixels = (await pngPixels(c.fixtures[index].png.path)).pixels;
        if (Math.abs(dx) <= 110 && Math.abs(dy) <= 5 && componentMatches(pixels, image.pixels,
          [Math.floor(t.bounds[0]) - 4, 110, Math.ceil(t.bounds[2]) + 4, 190], dx, dy)) { reference = pixels; break; }
      }
      if (!reference) return null;
      const names = lines.filter(l => /(?:店|行)$/.test(normalize(l.text)) && l.bounds[0] > 80 && l.bounds[0] < 260
        && l.bounds[1] >= 480 && l.bounds[3] < 2250 && l.bounds[3] - l.bounds[1] >= 35);
      const buttons = lines.filter(l => /^(?:逛店铺[币(]?|再逛逛)$/.test(normalize(l.text)) && l.bounds[0] > 600);
      const freshReference = (await pngPixels(c.fixtures[1].png.path)).pixels;
      const againReference = (await pngPixels(c.fixtures[4].png.path)).pixels;
      const cards: ShopCard[] = [];
      for (const button of buttons) {
        const name = one(names.filter(l => button.bounds[1] - l.bounds[1] >= 10 && button.bounds[1] - l.bounds[1] <= 50));
        if (!name || !ink(image.pixels, name.bounds)) return null;
        const again = normalize(button.text) === '再逛逛';
        const amount = lines.filter(l => /[+＋]10$/.test(normalize(l.text)) && Math.abs(l.bounds[1] - button.bounds[1]) < 15 && l.bounds[0] > button.bounds[0]);
        if (!again && amount.length !== 1) return null;
        // Compare observed button components; card names come from the current
        // uniquely paired title and are never hardcoded selection criteria.
        let matched = false;
        for (const index of again ? [4] : [1, 4]) {
          const source = await readHistoricalFrame(c.fixtures[index]);
          const sourcePixels = index === 4 ? againReference : freshReference;
          for (const b of source.lines.filter(l => again ? normalize(l.text) === '再逛逛' : /^逛店铺[币(]?$/.test(normalize(l.text)))) {
            const dx = Math.round(button.bounds[0] - b.bounds[0]), dy = Math.round(button.bounds[1] - b.bounds[1]);
            const box = [Math.floor(b.bounds[0]) - (again ? 90 : 28), Math.floor(b.bounds[1]) - 18,
              Math.ceil(b.bounds[0]) + (again ? 222 : 286), Math.ceil(b.bounds[1]) + 66];
            for (let yy = -2; yy <= 2 && !matched; yy++) for (let xx = -2; xx <= 2 && !matched; xx++)
              matched = componentMatches(sourcePixels, image.pixels, box, dx + xx, dy + yy);
          }
        }
        if (!matched) return null;
        const bounds = [button.bounds[0] - 10, button.bounds[1] - 8,
          again ? button.bounds[2] + 10 : amount[0].bounds[2] + 10, button.bounds[3] + 8];
        cards.push({ name: normalize(name.text), button: again ? 'again' : 'fresh', bounds,
          point: [Math.round((bounds[0] + bounds[2]) / 2), Math.round((bounds[1] + bounds[3]) / 2)] });
      }
      if (!cards.length || new Set(cards.map(c => c.name)).size !== cards.length) return null;
      const completed = lines.filter(l => normalize(l.text) === '任务已完成');
      const secondary = lines.filter(l => normalize(l.text) === '继续逛逛吧');
      if (completed.length || secondary.length) {
        if (completed.length !== 1 || secondary.length !== 1 || !within(completed[0].bounds, 902, 1842, 5)
          || !within(secondary[0].bounds, 902, 1876, 5)
          || !componentMatches(againReference, image.pixels, [894, 1825, 1048, 1918])) return null;
        return { ...base, page: 'shopList', cards, completed: true, quote: '任务已完成 继续逛逛吧' };
      }
      return { ...base, page: 'shopList', cards };
    }
    const childTitle = one(lines.filter(l => normalize(l.text) === '<浏览送金币'));
    if (!childTitle || !within(childTitle.bounds, 49, 139, 5)) return null;
    const childReference = (await pngPixels(c.fixtures[2].png.path)).pixels;
    if (!componentMatches(childReference, image.pixels, [40, 132, 340, 200])) return null;
    const store = one(lines.filter(l => /店$/.test(normalize(l.text)) && l.bounds[0] > 100 && l.bounds[0] < 250
      && l.bounds[1] > 240 && l.bounds[3] < 320));
    if (!store || !ink(image.pixels, store.bounds)) return null;
    const completed = one(lines.filter(l => normalize(l.text) === '浏览完成('));
    const browsing = one(lines.filter(l => normalize(l.text) === '滑动浏览('));
    const amount = one(lines.filter(l => normalize(l.text) === '+10' && within(l.bounds, 860, 150, 6)));
    if (!amount || (!!completed === !!browsing)) return null;
    const status = completed ?? browsing!;
    if (!within(status.bounds, 648, 143, 5)) return null;
    const ref = (await pngPixels(c.fixtures[completed ? 3 : 2].png.path)).pixels;
    if (!componentMatches(ref, image.pixels, completed ? [638, 132, 940, 202] : [638, 132, 940, 202])) return null;
    return { ...base, page: 'store', storeName: normalize(store.text), completed: !!completed, amount: 10,
      ...(completed ? { quote: '浏览完成 +10' } : {}) };
  } catch { return null; }
}

export type ShopBrowseState = {
  contract: LocalContract; taskAttemptId: string;
  phase: 'ready' | 'awaitShopList' | 'awaitStore' | 'awaitStoreReceipt' | 'awaitShopListReceipt' | 'awaitActivity' | 'awaitSettlement';
  entry?: { frameId: string; capturedAt: number; pngSha256: string };
  selectedCardName?: string;
  selected?: { name: string; frameId: string; capturedAt: number; pngSha256: string };
  lastAction?: { frameId: string; capturedAt: number };
  learningBudget?: { status: 'candidate'; maxGestures: number; gestureMs: number; observationBudgetMs: number };
  gesturesProposed?: number;
  receipts?: ShopReceipt[];
};
export type ShopReceipt = { layer: 'store' | 'shopList'; taskAttemptId: string; frameId: string; pngSha256: string; quote: string; amount?: number; sourceResult: EvidenceRef };
export type ShopPlan = { kind: 'action' | 'needsLearning' | 'unknown' | 'awaitSettlement'; reason: string; nextState: ShopBrowseState;
  action?: DeviceAction; receipt?: ShopReceipt; learning?: { status: 'candidate'; remainingGestures: number; observationBudgetMs: number } };
export function createShopBrowseState(contract: LocalContract, taskAttemptId: string): ShopBrowseState {
  return { contract, taskAttemptId, phase: 'ready' };
}
export async function planShopBrowse(f: DeviceFrame, owner: CandidateOwner, s: ShopBrowseState): Promise<ShopPlan> {
  const stop = (reason: string, kind: 'unknown' | 'needsLearning' = 'unknown'): ShopPlan => ({ kind, reason, nextState: s });
  try {
    if (owner.taskAttemptId !== s.taskAttemptId) return stop('Wrong attempt ownership');
    const p = await inspectShopBrowse(f, owner, s.contract);
    if (!p) return stop('Unmatched current raw PNG/OCR page; no repeated tap');
    if (s.lastAction && (f.id === s.lastAction.frameId || f.capturedAt <= s.lastAction.capturedAt)) return stop('Require different later frame after dispatched intent');
    const act = (action: DeviceAction, phase: ShopBrowseState['phase'], extra: Partial<ShopBrowseState> = {}, receipt?: ShopReceipt): ShopPlan => ({
      kind: 'action', reason: 'Candidate current-page action; runtime owns dispatch and one-shot consumption', action, receipt,
      nextState: { ...s, ...extra, phase, lastAction: { frameId: f.id, capturedAt: f.capturedAt } } });
    if (s.phase === 'ready') {
      if (p.page !== 'activity') return stop('Independent outer activity entry required');
      const title = one(f.lines.filter(l => normalize(l.text) === '逛好店赚一大波金币(0/1)'));
      if (!title) return stop('Unique current outer task row missing');
      const instruction = one(f.lines.filter(l => normalize(l.text) === '浏览15秒' && l.bounds[1] - title.bounds[1] > 50 && l.bounds[1] - title.bounds[1] < 90));
      const button = one(f.lines.filter(l => normalize(l.text) === '逛一逛' && l.bounds[0] > 850
        && l.bounds[1] - title.bounds[1] > 15 && l.bounds[1] - title.bounds[1] < 60));
      if (!instruction || !button || !componentMatches((await pngPixels(s.contract.fixtures[0].png.path)).pixels, (await pngPixels(f.path)).pixels,
        [225, 1170, 1030, 1300])) return stop('Outer row independent requirement or PNG mismatch');
      return act({ type: 'tap', x: Math.round((button.bounds[0] + button.bounds[2]) / 2), y: Math.round((button.bounds[1] + button.bounds[3]) / 2) },
        'awaitShopList', { entry: { frameId: f.id, capturedAt: f.capturedAt, pngSha256: p.pngSha256 } });
    }
    if (!s.entry) return stop('Missing original outer-entry provenance');
    if (s.phase === 'awaitShopList') {
      if (p.page !== 'shopList' || p.completed) return stop('Await distinct shop list; outer entry remains consumed');
      const cards = p.cards.filter(c => c.button === 'fresh' && (!s.selectedCardName || c.name === s.selectedCardName));
      const card = one(cards);
      if (!card) return stop('Select exactly one fresh current card; historical second tap ownership remains unproven', 'needsLearning');
      return act({ type: 'tap', x: card.point[0], y: card.point[1] }, 'awaitStore',
        { selected: { name: card.name, frameId: f.id, capturedAt: f.capturedAt, pngSha256: p.pngSha256 } });
    }
    if (s.phase === 'awaitStore' || s.phase === 'awaitStoreReceipt') {
      if (p.page !== 'store' || !s.selected || p.storeName !== s.selected.name) return stop('Selected current store and child-page provenance mismatch');
      if (p.completed) {
        const receipt: ShopReceipt = { layer: 'store', taskAttemptId: owner.taskAttemptId, frameId: f.id, pngSha256: p.pngSha256,
          quote: p.quote!, amount: 10, sourceResult: s.contract.refs[0] };
        return act({ type: 'back' }, 'awaitShopListReceipt', { receipts: [...s.receipts ?? [], receipt] }, receipt);
      }
      const budget = s.learningBudget, used = s.gesturesProposed ?? 0;
      if (!budget || budget.status !== 'candidate' || !Number.isSafeInteger(budget.maxGestures) || budget.maxGestures < 1
        || owner.executionPolicy !== 'development-unbounded-v1' && budget.maxGestures > 5 || !Number.isSafeInteger(budget.gestureMs) || budget.gestureMs < 200 || budget.gestureMs > 1500
        || !Number.isSafeInteger(budget.observationBudgetMs) || budget.observationBudgetMs < 1 || owner.executionPolicy !== 'development-unbounded-v1' && budget.observationBudgetMs > 20000
        || used >= budget.maxGestures || owner.executionPolicy !== 'development-unbounded-v1' && f.capturedAt - s.selected.capturedAt > budget.observationBudgetMs)
        return stop('Store gesture sequence not historically learned; explicit candidate learning budget missing or exhausted', 'needsLearning');
      const plan = act({ type: 'swipe', fromX: 540, fromY: 1900, toX: 540, toY: 800, ms: budget.gestureMs }, 'awaitStoreReceipt', { gesturesProposed: used + 1 });
      return { ...plan, learning: { status: 'candidate', remainingGestures: budget.maxGestures - used - 1, observationBudgetMs: budget.observationBudgetMs } };
    }
    if (s.phase === 'awaitShopListReceipt') {
      if (p.page !== 'shopList' || !p.completed || !s.selected || !one(p.cards.filter(c => c.name === s.selected!.name && c.button === 'again')))
        return stop('Require real outer task completion and selected current-card again button');
      const receipt: ShopReceipt = { layer: 'shopList', taskAttemptId: owner.taskAttemptId, frameId: f.id, pngSha256: p.pngSha256,
        quote: p.quote!, sourceResult: s.contract.refs[0] };
      return act({ type: 'back' }, 'awaitActivity', { receipts: [...s.receipts ?? [], receipt] }, receipt);
    }
    if ((s.phase === 'awaitActivity' || s.phase === 'awaitSettlement') && p.page === 'activity')
      return { kind: 'awaitSettlement', reason: 'Both layered receipts retained; runtime must verify positive stable owning-activity balance, without 20+10 inference',
        nextState: { ...s, phase: 'awaitSettlement' } };
    return stop('Unexpected page for current layer; no fallback tap');
  } catch { return stop('Invalid candidate state or unreadable source image'); }
}
