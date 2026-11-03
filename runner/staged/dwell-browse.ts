import { createHash } from 'node:crypto';
import { readFile, readdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import sharp from 'sharp';
import {Storage,isStorageMigrated,documentKey} from '../storage/index.ts';
import {readStructured} from '../storage/structured.ts';
import type { DeviceFrame } from './device.ts';

export type Box = [number, number, number, number];
export type Owner = { package: string; userId: number };
export type Anchor = { pattern: string; bounds: Box };
export type Reference = { path: string; sha256: string; ocrPath: string; ocrSha256: string; frameId: string; derivation?: { summaryPath: string; summarySha256: string; owner: Owner } };
export type Page = { reference: Reference; identity: Anchor[]; anchors: Anchor[]; visualBoxes: Box[]; componentOcr?: 'partial-with-full-component-pixels' };
export type DwellContract = {
  task: { name: string; instruction: string };
  version: string;
  sourceRunIds: number[];
  source: { resultPath: string; resultSha256: string; sessionPath: string; sessionSha256: string };
  owner: Owner; width: number; height: number; dwellMs: number;
  knownRequirements: Anchor[];
  browsing: Page;
  receipt: Page & { quote: string };
  receiptOnly?: boolean;
  provenance?: import('./dwell-evidence.ts').HistoricalDwellEvidence['provenance'];
  requirementEvidence?: Reference;
  /** Explicit opt-in; absent contracts retain the original pixel/receiptOnly path. */
  textPolicy?: { version: 'dwell-text-v2'; title: Anchor; componentBox: Box; completion: Anchor[] };
  learningRequirementEvidence?: Reference & { rawPath: string; rawSha256: string };
};
export type DwellInspection = { state: 'browsing' | 'completed'; waitMs?: number; quote?: string; version: string };
const prefix = 'dwell-browse-candidate-v1';
const norm = (s: string) => s.normalize('NFKC').replace(/\s/g, '');
const digest = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const anchor = (line: DeviceFrame['lines'][number]): Anchor => ({ pattern: '^' + escape(norm(line.text)) + '$', bounds: line.bounds.map(Math.round) as Box });
const hasVisibleReceipt = (frame: DeviceFrame) => frame.lines.some(l => /任务已完成|继续逛逛吧/.test(norm(l.text)));
const blocked = (frame: DeviceFrame) => frame.lines.some(l => /赚金币抵钱|任务列表|去完成|登[录陆]|验证码|安全验证|授权|允许访问|隐私政策|同意并|温馨提示|广告|继续观看|领取成功/.test(norm(l.text)));
function box(b: unknown, width: number, height: number): b is Box {
  return Array.isArray(b) && b.length === 4 && b.every(Number.isSafeInteger)
    && b[0] >= 0 && b[1] >= 0 && b[0] < b[2] && b[1] < b[3] && b[2] <= width && b[3] <= height;
}
function valid(frame: DeviceFrame, owner: Owner) {
  return owner?.package === 'com.taobao.taobao' && Number.isSafeInteger(owner.userId) && owner.userId >= 0
    && frame?.package === owner.package && frame.userId === owner.userId && !frame.observationError
    && frame.width === 1080 && frame.height === 2400 && typeof frame.path === 'string' && !!frame.path
    && typeof frame.id === 'string' && !!frame.id && Number.isSafeInteger(frame.capturedAt)
    && Array.isArray(frame.lines) && frame.lines.length > 0 && frame.lines.every(l => typeof l?.text === 'string'
      && Array.isArray(l.bounds) && l.bounds.length === 4 && l.bounds.every(Number.isFinite)
      && l.bounds[0] >= 0 && l.bounds[1] >= 0 && l.bounds[0] < l.bounds[2] && l.bounds[1] < l.bounds[3]
      && l.bounds[2] <= frame.width && l.bounds[3] <= frame.height);
}
async function decode(path: string, hash?: string) {
  const bytes = await readFile(path);
  if (bytes.length > 20 * 1024 * 1024 || (hash && digest(bytes) !== hash)) throw Error('Reference hash mismatch');
  const image = sharp(bytes, { failOn: 'warning', limitInputPixels: 1080 * 2400 });
  const meta = await image.metadata();
  if (meta.format !== 'png' || meta.width !== 1080 || meta.height !== 2400 || (meta.pages ?? 1) !== 1) throw Error('Invalid PNG');
  return image.removeAlpha().toColourspace('srgb').raw().toBuffer();
}
const json = async (path: string) => JSON.parse(await readFile(path, 'utf8'));
const contractVersion = (contract: DwellContract) => {
  const { version, ...body } = contract;
  return `${prefix}:sha256:${digest(canonical(body))}`;
};
function canonical(value: any): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
  return JSON.stringify(value);
}
function successful(result: any, runId: number) {
  return result?.runId === runId && result.status === 'completed' && Number.isSafeInteger(result.gainCoins) && result.gainCoins > 0
    && Number.isSafeInteger(result.balanceBefore) && result.balanceBefore > 0 && Number.isSafeInteger(result.balanceAfter)
    && result.balanceAfter - result.balanceBefore === result.gainCoins && typeof result.taskAttemptId === 'string' && !!result.taskAttemptId
    && result.receipt?.taskAttemptId === result.taskAttemptId && typeof result.receipt.frameId === 'string'
    && typeof result.task?.name === 'string' && !!result.task.name && result.task.instruction === '浏览5秒';
}
async function reference(frame: DeviceFrame): Promise<Reference> {
  const ocrPath = frame.path.replace(/\.png$/, '.json');
  await decode(frame.path);
  const saved = await json(ocrPath);
  if (canonical(saved) !== canonical(frame)) throw Error('Frame differs from saved OCR evidence');
  return { path: frame.path, sha256: digest(await readFile(frame.path)), ocrPath,
    ocrSha256: digest(await readFile(ocrPath)), frameId: frame.id };
}
function identity(frame: DeviceFrame, runId: number): Anchor[] {
  const chrome: Record<number, string[]> = {
    160: frame.lines.some(l => norm(l.text) === '施肥') ? ['^施肥$', '^肥料0$'] : ['^芭芭农场$', '^好物上新$'],
    161: ['淘宝首钱卡', '^省钱精选$'],
    162: ['^找到以下宝贝$', '^综合$'],
    164: ['^青铜会员$', '^青铜$'],
    165: ['^关注$', '^分类$'],
    168: ['^薅羊毛赚话费$', '^兑话费$'],
  };
  if (chrome[runId]) return chrome[runId].map(pattern => {
    const matches = frame.lines.filter(l => new RegExp(pattern, 'u').test(norm(l.text)));
    if (matches.length !== 1) throw Error('Missing source-backed destination chrome: ' + pattern);
    return anchor(matches[0]);
  });
  // Evidence-derived visible labels, never task-name classification. Prefer the
  // destination chrome; conservative source-specific body labels are a fallback.
  const candidates = frame.lines.filter(l => l.bounds[1] >= 102 && l.bounds[3] < 2280
    && norm(l.text).length >= 3 && !/^[-+¥￥\d]/.test(norm(l.text))
    && !/浏览|得奖励|任务已完成|继续逛逛/.test(norm(l.text)));
  if (candidates.length < 2) throw Error('Insufficient destination identity evidence');
  return candidates.slice(0, 3).map(anchor);
}
function component(frame: DeviceFrame, patterns: string[]): Anchor[] {
  return patterns.map(pattern => {
    const lines = frame.lines.filter(l => new RegExp(pattern, 'u').test(norm(l.text))
      && l.bounds[0] >= 890 && l.bounds[2] <= 1050 && l.bounds[1] >= 1680 && l.bounds[3] <= 1918);
    if (lines.length !== 1) throw Error('Incomplete reward component OCR: ' + pattern);
    return { pattern, bounds: lines[0].bounds.map(Math.round) as Box };
  });
}
/** Build only from an archived positive-gain run. Throws for incomplete evidence.
 * Returned absolute reference paths are JSON serializable. No task-name inference,
 * account mutation, capture, model call, or stable-validation claim is performed. */
export async function buildDwellContract(root: string, sourceRunId: number): Promise<DwellContract> {
  if (!Number.isSafeInteger(sourceRunId) || sourceRunId <= 0) throw Error('Invalid source run id');
  const directory = resolve(root, 'data/stage-records/accounts/taobao/tb_main/tb_coin/sessions');
  let sessions: {path:string;value:any}[];
  if(isStorageMigrated(root)){
    const store=new Storage(root),prefix=documentKey(root,directory)+'/';
    try{sessions=store.listDocuments(prefix).filter(key=>key.endsWith('.json')&&!key.slice(prefix.length).includes('/')).map(key=>({path:resolve(root,key),value:readStructured(root,key)}));}
    finally{store.close();}
  }else sessions=await Promise.all((await readdir(directory)).filter(f => f.endsWith('.json')).map(async f => ({ path: join(directory, f), value: await json(join(directory, f)) })));
  const matches = sessions.filter(s => s.value.runId === sourceRunId);
  if (matches.length !== 1) throw Error('Missing or ambiguous source session');
  const session = matches[0], dir = resolve(root, session.value.evidenceDir), resultPath = join(dir, 'result.json');
  const result = await json(resultPath);
  if (!successful(result, sourceRunId) || result.sessionId !== session.value.sessionId) throw Error('Source result is not an owned positive-gain success');
  const stages = await json(join(dir, 'stages.json'));
  const opening = stages.find((s: any) => s.stageId === 'open_task' && s.status === 'completed');
  const receiptStage = stages.find((s: any) => s.stageId === 'task_receipt' && s.status === 'completed');
  const entry: DeviceFrame = opening?.events.filter((e: any) => e.type === 'observed').at(-1)?.frame;
  const receipt: DeviceFrame = await json(join(dir, result.receipt.frameId + '.json'));
  if (!receiptStage?.events.some((e: any) => e.type === 'observed' && e.frame?.id === receipt.id)
    || result.receipt.path !== receipt.path || entry?.capturedAt >= receipt.capturedAt) throw Error('Missing source destination/receipt observation');
  const owner = { package: 'com.taobao.taobao', userId: session.value.scope.userId };
  for (const frame of [entry, receipt]) if (!valid(frame, owner) || blocked(frame)) throw Error('Invalid or obstructed source frame');
  const partial = [164, 165].includes(sourceRunId);
  const requirements = partial ? component(entry, ['^得奖励$']) : component(entry, ['^浏览5秒$', '^得奖励$']);
  const receipts = component(receipt, partial && sourceRunId === 165 ? ['^继续逛逛吧$'] : ['^\\+' + result.gainCoins + '$', '^任务已完成$', '^继续逛逛吧$']);
  const browsing: Page = { reference: await reference(entry), identity: identity(entry, sourceRunId), anchors: requirements,
    visualBoxes: [[900, 1834, 1048, 1918], [926, 1740, 1006, 1800]] };
  const completed: Page & { quote: string } = { reference: await reference(receipt), identity: identity(receipt, sourceRunId), anchors: receipts,
    visualBoxes: [[896, 1682, 1055, 1734], [926, 1740, 1006, 1800], [900, 1834, 1048, 1918]],
    quote: receipts.map(a => receipt.lines.find(l => new RegExp(a.pattern, 'u').test(norm(l.text)))!.text).join(' ') };
  if (partial) {
    browsing.componentOcr = completed.componentOcr = 'partial-with-full-component-pixels';
    // Original OCR misses/merges the top line. Bind all task text pixels,
    // including the missing line, rather than synthesizing OCR from an audit.
    browsing.visualBoxes = [[898, 1830, 1048, 1914], [926, 1740, 1006, 1800]];
    completed.visualBoxes = [[898, 1830, 1048, 1914], [926, 1740, 1006, 1800]];
  }
  const contract: DwellContract = { task: { name: result.task.name, instruction: result.task.instruction }, version: '', sourceRunIds: [sourceRunId],
    source: { resultPath, resultSha256: digest(await readFile(resultPath)), sessionPath: session.path, sessionSha256: digest(await readFile(session.path)) },
    owner, width: 1080, height: 2400, dwellMs: 5000, knownRequirements: requirements, browsing, receipt: completed };
  if (partial) {
    const before = await json(result.task.beforeFrame.ocrPath);
    if (!valid(before, owner) || !before.lines.some((l: any) => norm(l.text).startsWith('浏览5秒') && Math.abs(l.bounds[1] - result.task.bounds[3]) < 100)) throw Error('Missing full task requirement evidence');
    contract.requirementEvidence = await reference(before);
  }
  contract.version = contractVersion(contract);
  if (!(await inspectDwellBrowse(entry, owner, contract))) throw Error('Source contract does not replay browsing: ' + sourceRunId);
  if (!(await inspectDwellBrowse(receipt, owner, contract))) throw Error('Source contract does not replay receipt: ' + sourceRunId);
  return contract;
}
export async function buildHistoricalDwellContract(root: string, sourceRunId: number): Promise<DwellContract> {
  const source = await (await import('./dwell-evidence.ts')).loadHistoricalDwellEvidence(root, sourceRunId);
  const page = (frame: DeviceFrame, ref: Reference, completed: boolean): Page => {
    const ids = source.identityPatterns.map(pattern => {
      const lines = frame.lines.filter(l => new RegExp(pattern, 'u').test(norm(l.text)));
      if (lines.length !== 1) throw Error('Missing source-backed destination chrome: ' + pattern);
      return anchor(lines[0]);
    });
    const [x1,y1,x2,y2] = source.componentBox;
    const patterns = completed ? [/任务已完成/, /^继续逛逛吧$/] : [/^浏览\d+秒$/, /^得奖励$/];
    const anchors = patterns.flatMap(pattern => frame.lines.filter(l => pattern.test(norm(l.text))
      && l.bounds[0] >= x1 && l.bounds[1] >= y1 && l.bounds[2] <= x2 && l.bounds[3] <= y2).map(anchor));
    if (!anchors.length) throw Error('Missing historical reward OCR');
    return { reference: ref, identity: ids, anchors, componentOcr: 'partial-with-full-component-pixels',
      visualBoxes: [source.componentBox, [926, y1 - 95, 1006, y1 - 35]] };
  };
  const browsing = page(source.browsing, source.browsingReference, source.receiptOnly);
  const receipt = { ...page(source.receipt, source.receiptReference, true), quote: source.receipt.lines.filter(l => /任务已完成|继续逛逛吧/.test(norm(l.text))).map(l => l.text).join(' ') };
  const contract: DwellContract = { task: source.task, version: '', sourceRunIds: [sourceRunId],
    source: { resultPath: source.resultPath, resultSha256: source.resultSha256, sessionPath: source.mappingPath, sessionSha256: source.mappingSha256 },
    owner: source.owner, width: 1080, height: 2400, dwellMs: source.dwellMs, knownRequirements: source.receiptOnly ? [] : browsing.anchors,
    browsing, receipt, receiptOnly: source.receiptOnly, provenance: source.provenance };
  contract.version = contractVersion(contract);
  for (const frame of [source.browsing, source.receipt]) if (!await inspectDwellBrowse(frame, source.owner, contract)) throw Error('Historical source contract does not replay: ' + sourceRunId + ':' + frame.id);
  return contract;
}

/** Extend an existing verified receipt contract with an independently observed
 * requirement. Learning a wait never asserts that its source run completed. */
export async function buildTextDwellContract(base: DwellContract,
  sourceRef: NonNullable<DwellContract['learningRequirementEvidence']>): Promise<DwellContract> {
  if (base.textPolicy || base.version !== contractVersion(base)) throw Error('Expected original v1 contract');
  const receipt: DeviceFrame = await (await import('./dwell-evidence.ts')).readDwellReference(base.receipt.reference);
  if ((await inspectDwellBrowse(receipt, base.owner, base))?.state !== 'completed') throw Error('Invalid base receipt contract');
  const learned: DeviceFrame = await (await import('./dwell-evidence.ts')).readDwellReference(sourceRef);
  if (!valid(learned, base.owner) || blocked(learned) || hasVisibleReceipt(learned)) throw Error('Invalid requirement source');
  const titles = base.receipt.identity.filter(a => a.bounds[3] < 220 && matchAnchor(learned, a));
  if (titles.length !== 1) throw Error('Missing unique source-backed destination title');
  const requirements = component(learned, ['^浏览5秒$', '^得奖励$']);
  const completion = base.receipt.anchors.filter(a => /任务已完成|继续逛逛吧/.test(a.pattern))
    .map(a => /任务已完成/.test(a.pattern) ? { ...a, pattern: '^[一“”]?任务已完成[“”]?$' } : a);
  if (completion.length !== 2 || !completion.some(a => /任务已完成/.test(a.pattern))
    || !completion.some(a => /继续逛逛吧/.test(a.pattern))) throw Error('Missing full completion text');
  const all = [...requirements, ...completion];
  const componentBox: Box = [Math.min(...all.map(a => a.bounds[0])) - 6, Math.min(...all.map(a => a.bounds[1])) - 6,
    Math.max(...all.map(a => a.bounds[2])) + 6, Math.max(...all.map(a => a.bounds[3])) + 6];
  if (componentBox[0] < 880 || componentBox[1] < 1800 || componentBox[2] > 1060 || componentBox[3] > 1930) throw Error('Unsupported reward component location');
  const next: DwellContract = { ...structuredClone(base), receiptOnly: false, dwellMs: 5000, knownRequirements: requirements,
    browsing: { reference: sourceRef, identity: [titles[0]], anchors: requirements, visualBoxes: [] },
    learningRequirementEvidence: sourceRef,
    textPolicy: { version: 'dwell-text-v2', title: titles[0], componentBox, completion }, version: '' };
  next.version = contractVersion(next);
  if ((await inspectDwellBrowse(learned, base.owner, next))?.state !== 'browsing'
    || (await inspectDwellBrowse(receipt, base.owner, next))?.state !== 'completed') throw Error('Text source does not replay');
  return next;
}

// The current raw OCR must belong to this exact capture. Compare only task text:
// independent title refinements and unrelated faint product OCR may differ.
async function boundTextFrame(frame: DeviceFrame, contract: DwellContract, rawRef?: { rawPath: string; rawSha256: string }) {
  const saved = await json(frame.path.replace(/\.png$/, '.json'));
  if (saved.id !== frame.id || saved.path !== frame.path || saved.capturedAt !== frame.capturedAt
    || saved.width !== frame.width || saved.height !== frame.height || saved.package !== frame.package || saved.userId !== frame.userId) return false;
  const rawPath = rawRef?.rawPath ?? frame.path.replace(/\.png$/, '.ocr.json');
  const bytes = await readFile(rawPath);
  if (rawRef && digest(bytes) !== rawRef.rawSha256) return false;
  const raw = JSON.parse(bytes.toString()), page = raw.pages?.length === 1 ? raw.pages[0] : null;
  if (!page || page.file !== frame.path || page.width !== frame.width || page.height !== frame.height || !Array.isArray(page.lines)) return false;
  const title = new RegExp(contract.textPolicy!.title.pattern, 'u');
  const relevant = (l: DeviceFrame['lines'][number]) => title.test(norm(l.text)) || /浏览.*秒|得奖励|任务已完成|继续逛逛吧/.test(norm(l.text));
  const lines = (xs: DeviceFrame['lines']) => xs.filter(relevant).map(l => ({ text: l.text, bounds: l.bounds }));
  return canonical(lines(page.lines)) === canonical(lines(frame.lines)) && canonical(lines(saved.lines)) === canonical(lines(frame.lines));
}
async function inspectTextDwell(frame: DeviceFrame, owner: Owner, contract: DwellContract): Promise<DwellInspection | null> {
  const p = contract.textPolicy!, ref = contract.learningRequirementEvidence;
  if (p.version !== 'dwell-text-v2' || !ref || contract.receiptOnly || contract.dwellMs !== 5000
    || !box(p.componentBox, frame.width, frame.height) || !matchAnchor(frame, p.title)) return null;
  const learned = await (await import('./dwell-evidence.ts')).readDwellReference(ref);
  await decode(ref.path, ref.sha256);
  if (!valid(learned, owner) || blocked(learned) || !matchAnchor(learned, p.title)
    || !await boundTextFrame(learned, contract, ref) || !await boundTextFrame(frame, contract)) return null;
  const inside = (a: Anchor) => a.bounds[0] >= p.componentBox[0] && a.bounds[1] >= p.componentBox[1]
    && a.bounds[2] <= p.componentBox[2] && a.bounds[3] <= p.componentBox[3];
  if (contract.knownRequirements.length !== 2 || !contract.knownRequirements.every(a => inside(a) && matchAnchor(learned, a))
    || canonical(contract.knownRequirements.map(a => a.pattern)) !== canonical(['^浏览5秒$', '^得奖励$'])) return null;
  // Decode the current PNG for frame validity, never compare product/background pixels.
  await decode(frame.path);
  if (frame.lines.some(l => /浏览.*秒/.test(norm(l.text)) && norm(l.text) !== '浏览5秒')) return null;
  if (hasVisibleReceipt(frame)) {
    if (frame.lines.some(l => /浏览.*秒|得奖励/.test(norm(l.text))) || p.completion.length !== 2
      || frame.lines.filter(l => /任务已完成/.test(norm(l.text))).length !== 1
      || frame.lines.filter(l => /继续逛逛吧/.test(norm(l.text))).length !== 1
      || !p.completion.every(a => inside(a) && matchAnchor(frame, a))) return null;
    const quote = p.completion.map(a => frame.lines.find(l => new RegExp(a.pattern, 'u').test(norm(l.text)))!.text).join('\n');
    return { state: 'completed', quote, version: contract.version };
  }
  if (frame.lines.some(l => /已完成|已得|继续逛逛吧/.test(norm(l.text)))
    || !contract.knownRequirements.every(a => matchAnchor(frame, a))) return null;
  return { state: 'browsing', waitMs: 5000, version: contract.version };
}

function matchAnchor(frame: DeviceFrame, expected: Anchor) {
  if (typeof expected?.pattern !== 'string' || expected.pattern.length > 256 || !expected.pattern.startsWith('^') || !expected.pattern.endsWith('$')
    || !box(expected.bounds, frame.width, frame.height)) return false;
  const regex = new RegExp(expected.pattern, 'u');
  const all = frame.lines.filter(l => regex.test(norm(l.text)));
  const lines = all.filter(l => l.bounds.every((v, i) => Math.abs(v - expected.bounds[i]) <= 6));
  return all.length === 1 && lines.length === 1;
}
// Per-tile matching rejects a local obstruction that an image-wide mean hides.
function pixelsMatch(reference: Buffer, current: Buffer, b: Box) {
  for (let y = b[1]; y < b[3]; y += 16) for (let x = b[0]; x < b[2]; x += 16) {
    let changed = 0, total = 0;
    for (let yy = y; yy < Math.min(y + 16, b[3]); yy++) for (let xx = x; xx < Math.min(x + 16, b[2]); xx++) {
      const i = (yy * 1080 + xx) * 3;
      if (Math.max(...[0, 1, 2].map(k => Math.abs(reference[i + k] - current[i + k]))) > 24) changed++;
      total++;
    }
    if (changed / total > .08) return false;
  }
  return true;
}
function ink(pixels: Buffer, b: number[]) {
  let low = 255, high = 0;
  for (let y = Math.ceil(b[1]); y < b[3]; y += 2) for (let x = Math.ceil(b[0]); x < b[2]; x += 2) {
    const i = (y * 1080 + x) * 3, value = (pixels[i] + pixels[i + 1] + pixels[i + 2]) / 3;
    low = Math.min(low, value); high = Math.max(high, value);
  }
  return high - low > 50;
}
// Only the learned two-label destination uses this layout. Contract bytes and
// hashes stay unchanged; a task name never selects this recognition path.
const photoDestination = (page: Page) => page?.identity?.length === 2
  && page.identity[0].pattern === '^找到以下宝贝$' && page.identity[1].pattern === '^综合$';
const runLocal = promisify(execFile);
async function componentText(pixels: Buffer, variant: 'component' | 'foreground' | 'sort' = 'component') {
  const directory = await mkdtemp(join(tmpdir(), 'dwell-component-'));
  try {
    const path = join(directory, 'crop.png'), output = join(directory, 'ocr.json');
    const region = variant === 'sort' ? {left:690,top:250,width:110,height:65}
      : variant === 'foreground' ? {left:900,top:1838,width:140,height:74}
      : {left:890,top:1680,width:165,height:240};
    const scale = variant === 'component' ? 3 : 4;
    let crop=sharp(pixels, { raw: { width: 1080, height: 2400, channels: 3 } }).extract(region).resize(region.width*scale);
    if(variant === 'foreground')crop=crop.grayscale().threshold(190);
    await writeFile(path, await crop.png().toBuffer());
    await runLocal('/Users/mater/.hermes/cache/scratch/checkin-apple-ocr', [output, path], { timeout: 5000, maxBuffer: 1024 * 1024 });
    const result = await json(output);
    if (result.pages?.length !== 1 || result.pages[0].width !== region.width*scale || result.pages[0].height !== region.height*scale) return [];
    return result.pages[0].lines.map((l: any) => ({ text: l.text, bounds: l.bounds.map((v: number, i: number) => v / scale + (i % 2 ? region.top : region.left)) }));
  } finally { await rm(directory, { recursive: true, force: true }); }
}
async function photoAnchorPresent(frame: DeviceFrame, expected: Anchor, pixels: Buffer) {
  const regex = new RegExp(expected.pattern, 'u');
  // Exact contradictory/duplicate OCR is not partial recognition.
  const exact = frame.lines.filter(l => regex.test(norm(l.text)));
  if (exact.length && (exact.length !== 1 || expected.pattern !== '^浏览5秒$')) return matchAnchor(frame, expected);
  if (exact.length === 1 && !(exact[0].bounds[0] >= 890 && exact[0].bounds[2] <= 1055
    && exact[0].bounds[1] >= expected.bounds[1] - 6 && exact[0].bounds[3] <= expected.bounds[3] + 6)) return false;
  if (expected.pattern === '^浏览5秒$' && frame.lines.some(l => /浏览\d+秒/.test(norm(l.text)) && !/浏览5秒(?!\d)/.test(norm(l.text)))) return false;
  if (matchAnchor(frame, expected)) return true;
  if (expected.pattern === '^综合$') {
    // Require a single observed line overlapping the learned control, then
    // recover its exact text from that control's pixels rather than accepting
    // arbitrary brand/product prefixes as part of its identity.
    const lines = frame.lines.filter(l => l.bounds[0] <= expected.bounds[0] + 6
      && l.bounds[2] >= expected.bounds[2] - 6 && l.bounds[2] <= 1060
      && Math.abs(l.bounds[1] - expected.bounds[1]) <= 6 && Math.abs(l.bounds[3] - expected.bounds[3]) <= 6);
    if (lines.length !== 1) return false;
    const local = (await componentText(pixels, 'sort')).filter((l: {text: string; bounds: number[]}) => norm(l.text) === '综合');
    return local.length === 1 && local[0].bounds.every((v: number, i: number) => Math.abs(v - expected.bounds[i]) <= 6);
  }
  const grouped = frame.lines.filter(l => /^浏览\d+秒得奖励$/.test(norm(l.text))
    && l.bounds[0] >= 900 && l.bounds[2] <= 1048 && l.bounds[1] >= 1834 && l.bounds[3] <= 1918);
  if ((expected.pattern === '^浏览5秒$' || expected.pattern === '^得奖励$') && grouped.length === 1) return true;
  if (!/^\^浏览\d+秒\$$/.test(expected.pattern)) return false;
  // A partially recognized requirement must still be observed at the component,
  // then independently read from current pixels. Never whitelist OCR misspellings.
  return frame.lines.some(l => l.bounds[0] >= 890 && l.bounds[2] <= 1055
    && l.bounds[1] >= expected.bounds[1] - 6 && l.bounds[3] <= expected.bounds[3] + 6
    && l.bounds[0] < expected.bounds[2] && l.bounds[2] > expected.bounds[0]);
}
function textForegroundMatches(reference: Buffer, current: Buffer, bounds: Box) {
  const bright = (pixels: Buffer, x: number, y: number, level: number) => {
    const i = (y * 1080 + x) * 3;
    return Math.min(pixels[i], pixels[i + 1], pixels[i + 2]) > level;
  };
  // The panel is translucent: product ink underneath is variable. Compare both
  // directions of the white glyphs, including every tile, with 1px raster slack.
  for (const [from, to] of [[reference, current], [current, reference]]) {
    for (let y = bounds[1]; y < bounds[3]; y += 16) for (let x = bounds[0]; x < bounds[2]; x += 16) {
      let count = 0, missing = 0;
      for (let yy = y; yy < Math.min(y + 16, bounds[3]); yy++) for (let xx = x; xx < Math.min(x + 16, bounds[2]); xx++) {
        if (!bright(from, xx, yy, 210)) continue;
        count++;
        let found = false;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (bright(to, xx + dx, yy + dy, 190)) found = true;
        if (!found) missing++;
      }
      if (missing > Math.max(1, count * .08)) return false;
    }
  }
  return true;
}
async function matchesPage(frame: DeviceFrame, pixels: Buffer, page: Page) {
  const photo = photoDestination(page);
  const browsing = page.anchors.some(a => a.pattern === '^浏览5秒$');
  if (!page || !Array.isArray(page.identity) || page.identity.length < 2 || !Array.isArray(page.anchors) || page.anchors.length < (page.componentOcr ? 1 : 2)
    || !Array.isArray(page.visualBoxes) || page.visualBoxes.length < 2) return false;
  for (const anchor of [...page.identity, ...page.anchors]) {
    if (!(photo ? await photoAnchorPresent(frame, anchor, pixels) : matchAnchor(frame, anchor))) return false;
  }
  const ocrBytes = await readFile(page.reference.ocrPath);
  if (digest(ocrBytes) !== page.reference.ocrSha256) return false;
  const saved = page.reference.derivation
    ? await (await import('./dwell-evidence.ts')).readDwellReference(page.reference) : JSON.parse(ocrBytes.toString());
  if (saved.id !== page.reference.frameId || saved.path !== page.reference.path || !valid(saved, { package: frame.package, userId: frame.userId })) return false;
  const learned = await decode(page.reference.path, page.reference.sha256);
  if (photo) {
    if (!page.identity.every(a => box(a.bounds, frame.width, frame.height) && pixelsMatch(learned, pixels, a.bounds))) return false;
    // Compare the complete learned text panel and opaque coin interior for
    // both states. White glyph matching tolerates the translucent product
    // background; every tile and both matching directions remain mandatory.
    if (!textForegroundMatches(learned, pixels, [900,1840,1040,1908])
      || !pixelsMatch(learned, pixels, [926,1740,1006,1800])) return false;
    if (!browsing) {
      // The receipt's outer amount box crosses the rounded badge into product
      // pixels (175 worst tile: 41/64 changed). Its source OCR bounds plus 3px
      // contain the complete opaque amount and are byte-identical in 162/175.
      // Keep the same per-tile threshold and exact full receipt OCR above;
      // requiring crop OCR for every line would reject source 162's “务已完成”.
      // The yellow continuation line is invisible to the white-ink mask.
      // Read it from current pixels; do not tune a new color/raster tolerance.
      const continuation = page.anchors.find(a => a.pattern === '^继续逛逛吧$');
      const lines = (await componentText(pixels)).filter((l: any) => norm(l.text) === '继续逛逛吧');
      if (!continuation || lines.length !== 1 || lines[0].bounds[0] < 900 || lines[0].bounds[2] > 1048
        || lines[0].bounds[1] < continuation.bounds[1] - 6 || lines[0].bounds[3] > continuation.bounds[3] + 6) return false;
      const amounts = page.anchors.filter(a => a.pattern.startsWith('^\\+'));
      if (amounts.length !== 1) return false;
      const b = amounts[0].bounds;
      const crop: Box = [b[0] - 3, b[1] - 3, b[2] + 3, b[3] + 3];
      return box(crop, frame.width, frame.height) && pixelsMatch(learned, pixels, crop);
    }
    if (!page.visualBoxes.filter(b => b[3] <= 1740).every(b => box(b, frame.width, frame.height) && pixelsMatch(learned, pixels, b))) return false;
    const supports=(lines:any[])=>page.anchors.every(a => {
      const matches = lines.filter((l: any) => new RegExp(a.pattern, 'u').test(norm(l.text)));
      return matches.length === 1 && matches[0].bounds[0] >= 900 && matches[0].bounds[2] <= 1048
        && matches[0].bounds[1] >= a.bounds[1] - 6 && matches[0].bounds[3] <= a.bounds[3] + 6;
    });
    const lines = await componentText(pixels);
    return supports(lines)||supports(await componentText(pixels,'foreground'));
  }
  const boxes = [...page.visualBoxes, ...page.identity.map(a => a.bounds)];
  return boxes.every(b => box(b, frame.width, frame.height) && pixelsMatch(learned, pixels, b));
}
/** Local page evidence only. Caller MUST bind an actual selected entry attempt,
 * enforce capture age and bounded waiting, and reconcile owning-panel settlement.
 * An old receipt intentionally remains recognizable; it never proves a new attempt. */
export async function inspectDwellBrowse(frame: DeviceFrame, owner: Owner, contract: DwellContract): Promise<DwellInspection | null> {
  try {
    if (!valid(frame, owner) || blocked(frame) || !contract || contract.version !== contractVersion(contract)
      || canonical(contract.owner) !== canonical(owner) || contract.width !== frame.width || contract.height !== frame.height
      || !Number.isSafeInteger(contract.dwellMs) || contract.dwellMs < 1000 || contract.dwellMs > 20000 || !Array.isArray(contract.sourceRunIds) || contract.sourceRunIds.length !== 1
      || !Number.isSafeInteger(contract.sourceRunIds[0]) || canonical(contract.knownRequirements) !== canonical(contract.receiptOnly ? [] : contract.browsing.anchors)) return null;
    const resultBytes = await readFile(contract.source.resultPath), sessionBytes = await readFile(contract.source.sessionPath);
    if (digest(resultBytes) !== contract.source.resultSha256 || digest(sessionBytes) !== contract.source.sessionSha256) return null;
    const result = JSON.parse(resultBytes.toString()), session = JSON.parse(sessionBytes.toString());
    if (contract.provenance) {
      if (contract.provenance.sourceRunId !== contract.sourceRunIds[0]
        || !await (await import('./dwell-evidence.ts')).verifyHistoricalDwellProvenance(contract.provenance)) return null;
      const execution = session.executions?.filter((e: any) => e.runId === result.runId);
      if (execution?.length !== 1 || canonical(execution[0].result) !== canonical(result)) return null;
    } else if (!successful(result, contract.sourceRunIds[0]) || session.runId !== result.runId || session.sessionId !== result.sessionId
      || canonical(contract.task) !== canonical({ name: result.task.name, instruction: result.task.instruction })) return null;
    if (contract.requirementEvidence) {
      const ref = contract.requirementEvidence;
      if (digest(await readFile(ref.ocrPath)) !== ref.ocrSha256) return null;
      await decode(ref.path, ref.sha256);
    }
    if (contract.textPolicy) return await inspectTextDwell(frame, owner, contract);
    const pixels = await decode(frame.path);
    // Require visible OCR in the current content as well as the reward component.
    const content = frame.lines.filter(l => l.bounds[1] >= 102 && l.bounds[3] <= 2280 && norm(l.text).length >= 3);
    const photo = photoDestination(contract.browsing);
    const visibleContent = content.filter(l => ink(pixels, l.bounds)).length;
    // Tiny/faint product labels are not destination identity. A large region
    // containing several stale OCR labels still signals a blanking obstruction.
    const blankContentArea = content.filter(l => !ink(pixels, l.bounds))
      .reduce((sum, l) => sum + (l.bounds[2] - l.bounds[0]) * (l.bounds[3] - l.bounds[1]), 0);
    if (content.length < 4 || (photo ? blankContentArea > 128 * 64 : contract.browsing.componentOcr
      ? (hasVisibleReceipt(frame) ? contract.receipt.anchors : contract.browsing.anchors).some(a => !ink(pixels, a.bounds))
      : visibleContent !== content.length)) return null;
    const hasReceipt = hasVisibleReceipt(frame);
    if (hasReceipt) {
      if (frame.lines.some(l => /^浏览\d+秒$/.test(norm(l.text)))) return null;
      if (!(await matchesPage(frame, pixels, contract.receipt)) && !(contract.receiptOnly && await matchesPage(frame, pixels, contract.browsing))) return null;
      return { state: 'completed', quote: contract.receipt.quote, version: contract.version };
    }
    if (contract.receiptOnly || frame.lines.some(l => /已完成|已得|继续逛逛吧/.test(norm(l.text))) || !(await matchesPage(frame, pixels, contract.browsing))) return null;
    return { state: 'browsing', waitMs: contract.dwellMs, version: contract.version };
  } catch { return null; }
}

/** Explicit current-components-v1 entry point. Observation only: the caller owns
 * attempt binding, freshness, bounded waiting and owning-panel settlement.
 * Historical hashes establish provenance; current text locates the component. */
export async function inspectCurrentDwellBrowse(frame: DeviceFrame, owner: Owner, contract: DwellContract): Promise<DwellInspection | null> {
  try {
    if (!valid(frame, owner) || blocked(frame) || !contract || contract.version !== contractVersion(contract)
      || canonical(contract.owner) !== canonical(owner) || contract.width !== frame.width || contract.height !== frame.height
      || !Number.isSafeInteger(contract.dwellMs) || contract.dwellMs < 1000 || contract.dwellMs > 20000
      || contract.sourceRunIds?.length !== 1
      || canonical(contract.knownRequirements) !== canonical(contract.receiptOnly ? [] : contract.browsing.anchors)) return null;
    const resultBytes = await readFile(contract.source.resultPath), sessionBytes = await readFile(contract.source.sessionPath);
    if (digest(resultBytes) !== contract.source.resultSha256 || digest(sessionBytes) !== contract.source.sessionSha256) return null;
    const result = JSON.parse(resultBytes.toString()), session = JSON.parse(sessionBytes.toString());
    if (contract.provenance) {
      if (contract.provenance.sourceRunId !== contract.sourceRunIds[0]
        || !await (await import('./dwell-evidence.ts')).verifyHistoricalDwellProvenance(contract.provenance)) return null;
      const execution = session.executions?.filter((e: any) => e.runId === result.runId);
      if (execution?.length !== 1 || canonical(execution[0].result) !== canonical(result)) return null;
    } else if (!successful(result, contract.sourceRunIds[0]) || session.runId !== result.runId || session.sessionId !== result.sessionId
      || canonical(contract.task) !== canonical({ name: result.task.name, instruction: result.task.instruction })) return null;
    const readReference = (await import('./dwell-evidence.ts')).readDwellReference;
    if (contract.requirementEvidence) {
      const ref = contract.requirementEvidence;
      await readReference(ref); await decode(ref.path, ref.sha256);
    }
    const sources = await Promise.all([readReference(contract.browsing.reference), readReference(contract.receipt.reference)]);
    const identities = contract.textPolicy ? [contract.textPolicy.title] : [...contract.browsing.identity, ...contract.receipt.identity];
    const relevant = (l: DeviceFrame['lines'][number]) => /浏览.*秒|得奖励|完成|已得|继续逛逛|^\+\d+$|赚金币抵钱|任务列表|去完成|登[录陆]|验证码|安全验证|授权|允许访问|隐私政策|同意并|温馨提示|广告|继续观看|领取成功/.test(norm(l.text))
      || identities.some(a => new RegExp(a.pattern, 'u').test(norm(l.text)));
    const bindingLines = (lines: DeviceFrame['lines']) => lines.filter(relevant).map(l => ({ text: l.text, bounds: l.bounds }));
    const rawBound = async (f: DeviceFrame, ref?: DwellContract['learningRequirementEvidence']) => {
      const bytes = await readFile(ref?.rawPath ?? f.path.replace(/\.png$/, '.ocr.json'));
      if (ref && digest(bytes) !== ref.rawSha256) return false;
      const raw = JSON.parse(bytes.toString()), p = raw.pages?.length === 1 ? raw.pages[0] : null;
      return !!p && p.file === f.path && p.width === f.width && p.height === f.height
        && canonical(bindingLines(p.lines)) === canonical(bindingLines(f.lines));
    };
    for (const [i, ref] of [contract.browsing.reference, contract.receipt.reference].entries()) {
      await decode(ref.path, ref.sha256);
      if (!valid(sources[i], owner) || blocked(sources[i])) return null;
      // Coordinates constrain historical provenance only, never current matching.
      const sourcePage = i === 0 ? contract.browsing : contract.receipt;
      if (!sourcePage.identity.every(a => matchAnchor(sources[i], a))) return null;
    }
    const saved = await json(frame.path.replace(/\.png$/, '.json'));
    // Early captures store raw pages directly. Accept their derived frame only
    // through the exact pinned reference/summary, never invented capture metadata.
    const originalIndex = [contract.browsing.reference, contract.receipt.reference]
      .findIndex(ref => ref.path === frame.path && !!ref.derivation);
    if (originalIndex >= 0) {
      if (canonical(frame) !== canonical(sources[originalIndex])) return null;
    } else if (!await rawBound(frame) || saved.id !== frame.id || saved.path !== frame.path
      || saved.capturedAt !== frame.capturedAt || saved.width !== frame.width || saved.height !== frame.height
      || saved.package !== frame.package || saved.userId !== frame.userId || saved.observationError
      || canonical(bindingLines(saved.lines)) !== canonical(bindingLines(frame.lines))) return null;
    await decode(frame.path);
    const unique = (pattern: string) => {
      if (!pattern.startsWith('^') || !pattern.endsWith('$') || pattern.length > 256) return null;
      const matches = frame.lines.filter(l => new RegExp(pattern, 'u').test(norm(l.text)));
      return matches.length === 1 ? matches[0] : null;
    };
    // Current geometry only: two adjacent lines of one narrow floating component.
    // Their historical screen position and the merchandise beneath them are irrelevant.
    const stacked = (a: DeviceFrame['lines'][number], b: DeviceFrame['lines'][number]) => {
      const h = Math.max(a.bounds[3] - a.bounds[1], b.bounds[3] - b.bounds[1]);
      const overlap = Math.min(a.bounds[2], b.bounds[2]) - Math.max(a.bounds[0], b.bounds[0]);
      return b.bounds[1] > a.bounds[1] && b.bounds[1] - a.bounds[3] >= -h * .3
        && b.bounds[1] - a.bounds[3] <= h && overlap >= Math.min(a.bounds[2] - a.bounds[0], b.bounds[2] - b.bounds[0]) * .7
        && Math.max(a.bounds[2], b.bounds[2]) - Math.min(a.bounds[0], b.bounds[0]) <= h * 7;
    };
    const completed = hasVisibleReceipt(frame), pageContract = completed ? contract.receipt : contract.browsing;
    if (contract.textPolicy) {
      const p = contract.textPolicy, ref = contract.learningRequirementEvidence;
      if (p.version !== 'dwell-text-v2' || !ref || contract.receiptOnly || contract.dwellMs !== 5000
        || !await rawBound(sources[0], ref) || !unique(p.title.pattern)
        || !sources[0].lines.some(l => new RegExp(p.title.pattern, 'u').test(norm(l.text)))) return null;
    } else if (pageContract.identity.length < 2 || !pageContract.identity.every(a => unique(a.pattern))) return null;
    const currentIds = (contract.textPolicy ? [contract.textPolicy.title] : pageContract.identity).map(a => unique(a.pattern)!);
    // Preserve relative ordering of independently identified current page labels.
    // No historical coordinate becomes an allowed current location.
    if (!contract.textPolicy) for (let i = 0; i < pageContract.identity.length; i++) {
      for (let j = i + 1; j < pageContract.identity.length; j++) {
        const a = pageContract.identity[i].bounds, b = pageContract.identity[j].bounds;
        if (b[1] > a[3] && currentIds[j].bounds[1] <= currentIds[i].bounds[1]) return null;
        if (a[1] > b[3] && currentIds[i].bounds[1] <= currentIds[j].bounds[1]) return null;
      }
    }
    if (completed) {
      if (frame.lines.some(l => /浏览.*秒|得奖励/.test(norm(l.text)))) return null;
      // Quotation punctuation surrounds the exact completion phrase in source
      // 134. Missing/substituted characters and prefixed words remain unknown.
      const done = unique('^[“”]?任务已完成[“”]?$'), continuation = unique('^继续逛逛吧$');
      if (!done || !continuation || !stacked(done, continuation)
        || frame.lines.filter(l => /完成/.test(norm(l.text))).length !== 1
        || frame.lines.filter(l => /继续逛逛/.test(norm(l.text))).length !== 1
        || currentIds[0].bounds[3] >= done.bounds[1]) return null;
      const amountAnchors = contract.receipt.anchors.filter(a => a.pattern.startsWith('^\\+'));
      const amounts = frame.lines.filter(l => /^\+\d+$/.test(norm(l.text)));
      if (amountAnchors.length) {
        if (amountAnchors.length !== 1 || amounts.length !== 1 || !unique(amountAnchors[0].pattern)) return null;
        const amount = amounts[0], h = amount.bounds[3] - amount.bounds[1];
        if (amount.bounds[3] >= done.bounds[1] || done.bounds[1] - amount.bounds[3] > h * 8
          || Math.min(amount.bounds[2], done.bounds[2]) <= Math.max(amount.bounds[0], done.bounds[0])) return null;
      }
      return { state: 'completed', quote: [...amounts, done, continuation].map(l => l.text).join('\n'), version: contract.version };
    }
    if (contract.receiptOnly) return null;
    const expectedRequirement = '浏览' + contract.dwellMs / 1000 + '秒';
    const sourceRequirements = sources[0].lines.filter(l => /浏览.*秒/.test(norm(l.text)));
    const sourceRewards = sources[0].lines.filter(l => norm(l.text) === '得奖励');
    if (sourceRequirements.length !== 1 || norm(sourceRequirements[0].text) !== expectedRequirement
      || sourceRewards.length !== 1 || !stacked(sourceRequirements[0], sourceRewards[0])) return null;
    const requirement = unique('^' + expectedRequirement + '$'), reward = unique('^得奖励$');
    if (!requirement || !reward || !stacked(requirement, reward)
      || frame.lines.filter(l => /浏览.*秒/.test(norm(l.text))).length !== 1
      || frame.lines.some(l => /已完成|已得|继续逛逛/.test(norm(l.text)))) return null;
    return { state: 'browsing', waitMs: contract.dwellMs, version: contract.version };
  } catch { return null; }
}
