import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import sharp from 'sharp';
import type { DeviceAction, DeviceFrame } from './device.ts';
import { currentCompletionQuote, hasIdentityChallenge, observationTexts, splitOcrObservation } from './observations.ts';
import type { TaskIdentity } from './contracts.ts';

export type PanelClaimSelection = { policy: 'current-semantic-v1'; task: TaskIdentity };
export type PanelReceiptObservation = {
  frameId: string; pngSha256: string; taskAttemptId: string; isPanel: boolean; blocked: boolean;
  quote: string; evidence: EvidenceRef;
};
export type PanelClaimDeps = { readReceipt?: (request: {
  frame: DeviceFrame; task: TaskIdentity; taskAttemptId: string; pngSha256: string;
}) => Promise<PanelReceiptObservation | null> };
/** Current-purpose validation: unrelated OCR geometry does not grant or veto click authority. */
export function validCurrentPanelFrame(f: DeviceFrame, o: CandidateOwner) {
  return o?.package === 'com.taobao.taobao' && Number.isSafeInteger(o.userId) && o.userId >= 0 && !!o.taskAttemptId
    && f?.package === o.package && f.userId === o.userId && !f.observationError && !!f.id && !!f.path
    && f.width === 1080 && f.height === 2400 && Number.isSafeInteger(f.capturedAt) && Number.isSafeInteger(o.now)
    && o.now >= f.capturedAt && (o.executionPolicy === 'development-unbounded-v1' || o.now - f.capturedAt <= 5000)
    && Array.isArray(f.lines) && !hasIdentityChallenge(observationTexts(f));
}
export function currentPanelIdentity(f: DeviceFrame) {
  return observationTexts(f).filter(t => normalize(t) === '赚金币抵钱').length === 1;
}
function currentClaimTarget(frame: DeviceFrame, task: TaskIdentity) {
  if (!task.name?.trim() || !task.instruction?.trim()) return;
  const lines = splitOcrObservation(frame.lines, frame.width, frame.height).lines;
  const titles = lines.filter(l => /^.+\(\d+\/\d+\)$/.test(normalize(l.text))).sort((a,b) => a.bounds[1]-b.bounds[1]);
  const title = one(titles.filter(l => normalize(l.text).replace(/\(\d+\/\d+\)$/, '') === normalize(task.name!)));
  if (!title) return;
  const quota = normalize(title.text).match(/\((\d+)\/(\d+)\)$/)!;
  if (+quota[1] >= +quota[2]) return;
  const end = titles[titles.indexOf(title)+1]?.bounds[1] ?? frame.height;
  const buttons = lines.filter(l => normalize(l.text) === '领取奖励' && l.bounds[0] > title.bounds[2]
    && l.bounds[1] >= title.bounds[1] && l.bounds[3] < end);
  const button = one(buttons);
  if (!button) return;
  const body = lines.filter(l => l !== title && l.bounds[1] >= title.bounds[3]-3 && l.bounds[3] < end
    && l.bounds[0] >= title.bounds[0]-15 && l.bounds[2] <= button.bounds[0]).sort((a,b) => a.bounds[0]-b.bounds[0]);
  const requirement = (s: string) => normalize(s).replace(/(?:最高)?[+＋]\d+(?:[~～-]\d+)?/g, '').replace(/[币市③⑥，,、;；()]/g, '');
  if (requirement(body.map(l => l.text).join('')) !== requirement(task.instruction)) return;
  if (lines.some(l => l !== button && l.bounds[0] < button.bounds[2] && l.bounds[2] > button.bounds[0]
    && l.bounds[1] < button.bounds[3] && l.bounds[3] > button.bounds[1])) return;
  return button;
}

export type CandidateOwner = { package: string; userId: number; taskAttemptId: string; now: number; executionPolicy?: 'development-unbounded-v1' };
export type EvidenceRef = { path: string; sha256: string };
export type LocalContract = {
  version: string; status: 'candidate'; family: 'panel-claim' | 'shop-browse';
  sourceRunIds: number[]; refs: EvidenceRef[]; fixtures: { png: EvidenceRef; ocr: EvidenceRef; rawOcr?: EvidenceRef }[];
};
export const sha256 = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');
export const normalize = (value: string) => value.normalize('NFKC').replace(/\s/g, '');
export const one = <T>(values: T[]) => values.length === 1 ? values[0] : undefined;
const digest = (c: LocalContract) => sha256(JSON.stringify({ ...c, version: '' }));
export function sealContract(c: LocalContract) { return { ...c, version: `${c.family}-candidate-v1:${digest(c)}` }; }
export async function verifyContract(c: LocalContract) {
  if (!c || c.status !== 'candidate' || c.version !== `${c.family}-candidate-v1:${digest(c)}`) throw Error('Invalid candidate contract');
  for (const r of [...c.refs, ...c.fixtures.flatMap(f => [f.png, f.ocr, ...(f.rawOcr ? [f.rawOcr] : [])])])
    if (sha256(await readFile(r.path)) !== r.sha256) throw Error('Source hash mismatch');
}
export async function historicalContract(root: string, runId: number, family: LocalContract['family']) {
  const proposal = JSON.parse(await readFile(join(root, 'docs/历史已学任务本地合同草案.json'), 'utf8'));
  const source = proposal.contracts.find((c: any) => c.sourceRunId === runId);
  if (!source) throw Error('Missing historical source');
  const ref = (path: string, hash: string): EvidenceRef => ({ path: join(root, path), sha256: hash });
  const fixtures = [];
  for (const f of source.historicalFixtures) {
    const item: LocalContract['fixtures'][number] = { png: ref(f.png, f.pngSha256), ocr: ref(f.ocr, f.ocrSha256) };
    const raw = item.ocr.path.replace(/\.json$/, '.ocr.json');
    if (f.ocrSchema === 'device_frame') item.rawOcr = { path: raw, sha256: sha256(await readFile(raw)) };
    fixtures.push(item);
  }
  return sealContract({ version: '', status: 'candidate', family, sourceRunIds: source.executionSourceRunIds,
    refs: [ref(source.sourceResult.path, source.sourceResult.sha256)], fixtures });
}

/** A derived frame preserves original OCR bytes and capture metadata. It is never a fresh capture. */
export async function readHistoricalFrame(f: LocalContract['fixtures'][number], metadata?: { id: string; capturedAt: number }): Promise<DeviceFrame> {
  const original = JSON.parse(await readFile(f.ocr.path, 'utf8'));
  if (original.pages) {
    if (!metadata) throw Error('Early OCR requires original capture provenance');
    const page = original.pages[0];
    return { ...metadata, path: f.png.path, width: page.width, height: page.height,
      package: 'com.taobao.taobao', userId: 0, lines: page.lines,
      page: { historicalReplay: { derived: true, originalOcr: f.ocr, originalPng: f.png, captureProvenance: metadata } } };
  }
  // 136's intermediate frame has invalid flattened lines, but valid raw OCR.
  const raw = f.rawOcr ? JSON.parse(await readFile(f.rawOcr.path, 'utf8')) : undefined;
  const derivedFromRaw = !original.lines?.length && raw?.pages?.[0]?.lines?.length > 0;
  // The archived capture error remains in the hashed original. This derived
  // replay uses independently saved successful raw OCR, never pretends capture succeeded.
  return { ...original, path: f.png.path, observationError: derivedFromRaw ? undefined : original.observationError,
    page: { historicalReplay: { derived: true, originalOcr: f.ocr, originalPng: f.png, rawOcr: f.rawOcr,
      originalObservationError: original.observationError, captureProvenance: { id: original.id, capturedAt: original.capturedAt } } },
    lines: original.lines?.length ? original.lines : raw?.pages?.[0]?.lines ?? [] };
}
export async function pngPixels(path: string) {
  const bytes = await readFile(path);
  const image = sharp(bytes, { failOn: 'warning', limitInputPixels: 1080 * 2400 });
  const m = await image.metadata();
  if (m.format !== 'png' || m.width !== 1080 || m.height !== 2400 || (m.pages ?? 1) !== 1) throw Error('Unreadable PNG');
  return { pixels: await image.removeAlpha().toColourspace('srgb').raw().toBuffer(), hash: sha256(bytes) };
}
/** Small spatial tiles reject localized occlusions, including stale OCR on another PNG. */
export function componentMatches(a: Buffer, b: Buffer, box: number[], dx = 0, dy = 0) {
  for (let y = Math.floor(box[1]); y < Math.ceil(box[3]); y += 16) for (let x = Math.floor(box[0]); x < Math.ceil(box[2]); x += 16) {
    let changed = 0, count = 0;
    for (let yy = y; yy < Math.min(y + 16, Math.ceil(box[3])); yy++) for (let xx = x; xx < Math.min(x + 16, Math.ceil(box[2])); xx++) {
      const tx = xx + dx, ty = yy + dy;
      if (tx < 0 || tx >= 1080 || ty < 0 || ty >= 2400) return false;
      const i = (yy * 1080 + xx) * 3, j = (ty * 1080 + tx) * 3;
      if ([0, 1, 2].some(k => Math.abs(a[i + k] - b[j + k]) > 24)) changed++;
      count++;
    }
    if (changed / count > .035) return false;
  }
  return true;
}
export function validCandidateFrame(f: DeviceFrame, o: CandidateOwner) {
  return o?.package === 'com.taobao.taobao' && Number.isSafeInteger(o.userId) && o.userId >= 0 && !!o.taskAttemptId
    && f?.package === o.package && f.userId === o.userId && !f.observationError && !!f.id && !!f.path
    && f.width === 1080 && f.height === 2400 && Number.isSafeInteger(f.capturedAt) && Number.isSafeInteger(o.now)
    && o.now >= f.capturedAt && (o.executionPolicy === 'development-unbounded-v1' || o.now - f.capturedAt <= 5000) && Array.isArray(f.lines) && f.lines.length > 0
    && f.lines.every(l => typeof l.text === 'string' && l.bounds?.length === 4 && l.bounds.every(Number.isFinite)
      && l.bounds[0] >= -1 && l.bounds[1] >= -1 && l.bounds[2] <= 1081 && l.bounds[3] <= 2401
      && l.bounds[0] < l.bounds[2] && l.bounds[1] < l.bounds[3])
    && !f.lines.some(l => /登录|登陆|验证|请求授权|授权登录|允许|温馨提示|确定要|^广告$/.test(normalize(l.text)));
}
export async function panelIdentity(f: DeviceFrame, pixels: Buffer, reference: LocalContract['fixtures'][number]) {
  const title = one(f.lines.filter(l => normalize(l.text) === '赚金币抵钱'));
  if (!title || Math.abs(title.bounds[0] - 394) > 8 || Math.abs(title.bounds[1] - 477) > 8) return false;
  return componentMatches((await pngPixels(reference.png.path)).pixels, pixels, [380, 468, 700, 550]);
}

export async function buildPanelClaimContract(root: string) {
  const c = await historicalContract(root, 128, 'panel-claim');
  await verifyContract(c);
  const result = JSON.parse(await readFile(c.refs[0].path, 'utf8'));
  if (c.refs[0].sha256 !== 'e54ca95d892f72a8f113480ecdffe4570206b1a0d3614feb75ea2d1d00c2d8fc'
    || result.runId !== 128 || result.claimDispatches !== 1 || result.gainCoins !== 10) throw Error('Unproven source claim');
  const summaryPath = c.refs[0].path.replace(/result.json$/, 'summary.json');
  return sealContract({ ...c, refs: [...c.refs, { path: summaryPath, sha256: sha256(await readFile(summaryPath)) }] });
}
export async function loadPanelClaimReplay(c: LocalContract) {
  await verifyContract(c);
  const summary = JSON.parse(await readFile(c.refs[1].path, 'utf8'));
  const frames = await Promise.all(c.fixtures.map(f => {
    const id = f.png.path.split('/').at(-1)!.replace('.png', '');
    const capture = one(summary.captures.filter((x: any) => x.name === id)) as any;
    if (!capture) throw Error('Missing capture provenance');
    return readHistoricalFrame(f, { id, capturedAt: Date.parse(capture.at) });
  }));
  return { frames, taskAttemptId: 'historical:128:claim:frame-2' };
}
export type PanelClaimState = {
  contract: LocalContract; taskAttemptId: string; balanceBefore: number; phase: 'ready' | 'awaitReceipt' | 'awaitStableBalance';
  selection?: PanelClaimSelection;
  entry?: { frameId: string; capturedAt: number; pngSha256: string; row: string[] };
  receipt?: { frameId: string; capturedAt: number; pngSha256: string; taskAttemptId: string; quote: string; method: 'png-component-template' | 'current-ocr' | 'original-image-observer'; sourceResult: EvidenceRef; observation?: PanelReceiptObservation };
};
export function createPanelClaimState(contract: LocalContract, taskAttemptId: string, balanceBefore: number, selection?: PanelClaimSelection): PanelClaimState {
  return { contract, taskAttemptId, balanceBefore, phase: 'ready', ...(selection ? { selection: structuredClone(selection) } : {}) };
}
export type PanelClaimPlan = { kind: 'action' | 'receipt' | 'observe' | 'unknown' | 'needsLearning'; reason: string;
  action?: DeviceAction; receipt?: PanelClaimState['receipt']; nextState: PanelClaimState; captureBudget?: { frames: number; intervalMs: number } };

/** Read-only planner with optional original-image observation. Runtime reserves before dispatch and owns settlement. */
export async function planPanelClaim(frame: DeviceFrame, owner: CandidateOwner, state: PanelClaimState, deps: PanelClaimDeps = {}): Promise<PanelClaimPlan> {
  const stop = (reason: string): PanelClaimPlan => ({ kind: 'unknown', reason, nextState: state });
  try {
    if (state.selection?.policy === 'current-semantic-v1') {
      if (!validCurrentPanelFrame(frame, owner) || state.taskAttemptId !== owner.taskAttemptId || !Number.isFinite(state.balanceBefore)) return stop('Invalid frame or attempt ownership');
      await verifyContract(state.contract);
      if (state.contract.family !== 'panel-claim') return stop('Wrong contract family');
      const image = await pngPixels(frame.path);
      if (state.phase === 'awaitStableBalance') return { kind: 'observe', reason: 'Receipt retained; verify owning stable balance independently', nextState: state };
      if (state.phase === 'awaitReceipt') {
        if (!state.entry || state.entry.frameId === frame.id || frame.capturedAt <= state.entry.capturedAt || image.hash === state.entry.pngSha256) return stop('Receipt requires a different later original frame from same attempt');
        if (owner.executionPolicy !== 'development-unbounded-v1' && frame.capturedAt-state.entry.capturedAt > 5000) return { kind: 'needsLearning', reason: 'Receipt window exhausted; claim remains consumed', nextState: state };
        let quote = currentPanelIdentity(frame) ? currentCompletionQuote(observationTexts(frame)) : null;
        let observation: PanelReceiptObservation | undefined;
        if (!quote && deps.readReceipt) {
          const result = await deps.readReceipt({ frame, task: state.selection.task, taskAttemptId: owner.taskAttemptId, pngSha256: image.hash });
          if (result) {
            if (result.frameId !== frame.id || result.pngSha256 !== image.hash || result.taskAttemptId !== owner.taskAttemptId
              || result.isPanel !== true || result.blocked !== false || !result.evidence?.path || !result.evidence.sha256
              || sha256(await readFile(result.evidence.path)) !== result.evidence.sha256 || !currentCompletionQuote([result.quote])) return stop('Original-image receipt observation binding or evidence invalid');
            observation = result; quote = result.quote;
          }
        }
        if (!quote) return { kind: 'needsLearning', reason: 'No explicit current receipt; original-image observer required when OCR misses toast; claim remains consumed', nextState: state };
        const receipt: NonNullable<PanelClaimState['receipt']> = { frameId: frame.id, capturedAt: frame.capturedAt, pngSha256: image.hash,
          taskAttemptId: owner.taskAttemptId, quote, method: observation ? 'original-image-observer' : 'current-ocr',
          sourceResult: state.contract.refs[0], ...(observation ? { observation } : {}) };
        return { kind: 'receipt', reason: 'Explicit same-attempt current receipt; stable settlement still required', receipt, nextState: { ...state, phase: 'awaitStableBalance', receipt } };
      }
      if (!currentPanelIdentity(frame)) return stop('Current owning panel identity missing');
      if (currentCompletionQuote(observationTexts(frame))) return stop('Preexisting receipt cannot authorize claim');
      const button = currentClaimTarget(frame, state.selection.task);
      if (!button) return stop('Selected current claim row missing, ambiguous or not actionable');
      const b = button.bounds;
      return { kind: 'action', reason: 'Current selected row has a unique claim button; reserve once before dispatch',
        action: { type: 'tap', x: Math.round((b[0]+b[2])/2), y: Math.round((b[1]+b[3])/2) },
        captureBudget: { frames: 8, intervalMs: 250 }, nextState: { ...state, phase: 'awaitReceipt',
          entry: { frameId: frame.id, capturedAt: frame.capturedAt, pngSha256: image.hash, row: [state.selection.task.name!, state.selection.task.instruction!, button.text] } } };
    }
    if (!validCandidateFrame(frame, owner) || state.taskAttemptId !== owner.taskAttemptId || !Number.isFinite(state.balanceBefore)) return stop('Invalid frame or attempt ownership');
    await verifyContract(state.contract);
    if (state.contract.family !== 'panel-claim') return stop('Wrong contract family');
    const image = await pngPixels(frame.path);
    if (!await panelIdentity(frame, image.pixels, state.contract.fixtures[0])) return stop('Owning activity panel identity missing');
    if (state.phase === 'awaitStableBalance') return { kind: 'observe', reason: 'Receipt retained; runtime must verify positive stable balance on owning activity', nextState: state };
    const rowTexts = ['任务到访得金币(0/1)', '每日来任务面板币+10', '领取奖励'];
    const row = rowTexts.map(t => one(frame.lines.filter(l => normalize(l.text) === t)));
    if (row.some(l => !l)) return stop('Exact original current row missing or ambiguous; never reissue claim');
    const expected = await readHistoricalFrame(state.contract.fixtures[0], { id: 'reference', capturedAt: 0 });
    for (let i = 0; i < row.length; i++) {
      const ref = one(expected.lines.filter(l => normalize(l.text) === rowTexts[i]))!;
      if (row[i]!.bounds.some((n, k) => Math.abs(n - ref.bounds[k]) > 5)) return stop('Current row geometry differs');
    }
    const reference = (await pngPixels(state.contract.fixtures[0].png.path)).pixels;
    if (!componentMatches(reference, image.pixels, [225, 785, 1035, 915])) return stop('Current row PNG does not match OCR');
    if (state.phase === 'ready') {
      // Original OCR misses the toast: require the untouched source row's
      // immediate surrounding area too, so a pre-existing overlay never claims.
      if (!componentMatches(reference, image.pixels, [225, 785, 1035, 1145])) return stop('Current claim row is obscured or already shows receipt');
      const b = row[2]!.bounds;
      return { kind: 'action', reason: 'Unique exact current arrival row; reserve one claim before dispatch',
        action: { type: 'tap', x: Math.round((b[0] + b[2]) / 2), y: Math.round((b[1] + b[3]) / 2) },
        captureBudget: { frames: 8, intervalMs: 250 }, nextState: { ...state, phase: 'awaitReceipt',
          entry: { frameId: frame.id, capturedAt: frame.capturedAt, pngSha256: image.hash, row: rowTexts } } };
    }
    if (!state.entry || state.entry.frameId === frame.id || frame.capturedAt <= state.entry.capturedAt) return stop('Receipt requires a different later frame from same attempt');
    if (owner.executionPolicy !== 'development-unbounded-v1' && frame.capturedAt - state.entry.capturedAt > 5000) return { kind: 'needsLearning', reason: 'Bounded transient receipt window exhausted; claim remains consumed', nextState: state };
    const toast = (await pngPixels(state.contract.fixtures[1].png.path)).pixels;
    if (!componentMatches(toast, image.pixels, [270, 930, 810, 1140])) return stop('No readable source-backed toast component; claim remains consumed');
    const receipt: NonNullable<PanelClaimState['receipt']> = { frameId: frame.id, capturedAt: frame.capturedAt, pngSha256: image.hash,
      taskAttemptId: owner.taskAttemptId, quote: '任务完成！获得10淘金币', method: 'png-component-template', sourceResult: state.contract.refs[0] };
    return { kind: 'receipt', reason: 'Current raw PNG matches missed-OCR source toast; stable settlement still required', receipt,
      nextState: { ...state, phase: 'awaitStableBalance', receipt } };
  } catch { return stop('Unreadable PNG or invalid source contract'); }
}
