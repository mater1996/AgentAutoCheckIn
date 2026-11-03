import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import type { DeviceFrame } from './device.ts';
import type { Owner, Reference, Box } from './dwell-browse.ts';

const hash = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const norm = (s: string) => s.normalize('NFKC').replace(/\s/g, '');
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
export type SourceFile = { path: string; sha256: string };
export type HistoricalDwellEvidence = {
  owner: Owner; task: { name: string; instruction: string }; dwellMs: number; receiptOnly: boolean;
  browsing: DeviceFrame; receipt: DeviceFrame; browsingReference: Reference; receiptReference: Reference;
  identityPatterns: string[]; componentBox: Box;
  provenance: { kind: 'historical-dwell-v1'; sourceRunId: number; executionRunId: number; newSessionValidation: false;
    scopeSource: string; sourceOrigin: string; executionId: string; taskAttemptId?: string; files: SourceFile[]; requirementSource: string };
  resultPath: string; resultSha256: string; mappingPath: string; mappingSha256: string;
};
// Source annotations, keyed by archived run, are layout evidence, not task-name classification.
const layouts: Record<number, { before: string; after: string; identity: string[]; box: Box }> = {
  129: { before: 'frame-4', after: 'frame-5', identity: ['我的足迹', '^浏览过$', '^加购过$'], box: [898, 1830, 1048, 1914] },
  130: { before: 'frame-8', after: 'frame-9', identity: ['君乐宝百汇专卖店', '^君乐宝$'], box: [898, 1472, 1048, 1555] },
  131: { before: 'frame-6', after: 'frame-10', identity: ['淘宝闪购', '^搜索$'], box: [898, 1830, 1048, 1914] },
  // Only whitelisted nonpersonal chrome is exported for the private form fixture.
  132: { before: 'frame-4', after: 'frame-5', identity: ['充话费不只95折', '^官方直充秒到账$'], box: [898, 1472, 1048, 1555] },
  134: { before: '566d5d64-7027-4fc3-ad30-5199778c9e7a', after: 'c49cc7ff-85c7-45f9-8530-c861231fe0e8', identity: ['^淘宝成就$', '^更多$'], box: [886, 1825, 1056, 1910] },
};

async function checked(path: string, expected?: string) {
  const bytes = await readFile(path);
  const sha256 = hash(bytes);
  if (expected && sha256 !== expected) throw Error('Historical source hash mismatch: ' + basename(path));
  return { file: { path, sha256 }, value: JSON.parse(bytes.toString()) };
}

/** Derive only in memory. The saved OCR remains the original evidence authority. */
export async function readDwellReference(ref: Reference): Promise<DeviceFrame> {
  const { value } = await checked(ref.ocrPath, ref.ocrSha256);
  if (hash(await readFile(ref.path)) !== ref.sha256) throw Error('Historical PNG hash mismatch');
  if (!ref.derivation) {
    if (value.id !== ref.frameId || value.path !== ref.path) throw Error('Source frame identity mismatch');
    return value;
  }
  const { value: summary } = await checked(ref.derivation.summaryPath, ref.derivation.summarySha256);
  const matches = summary.frames.filter((f: any) => f.name === ref.frameId);
  const page = value.pages?.length === 1 ? value.pages[0] : null;
  if (!page || page.file !== ref.path || matches.length !== 1 || page.width !== matches[0].width || page.height !== matches[0].height
    || !Number.isSafeInteger(Date.parse(matches[0].at))) throw Error('Missing historical capture provenance');
  return { id: ref.frameId, path: ref.path, width: page.width, height: page.height, capturedAt: Date.parse(matches[0].at),
    lines: page.lines.map((l: any) => ({ text: l.text, bounds: l.bounds })), ...ref.derivation.owner };
}

export async function loadHistoricalDwellEvidence(root: string, sourceRunId: number): Promise<HistoricalDwellEvidence> {
  return loadDwellEvidence(root, sourceRunId);
}

async function loadDwellEvidence(root: string, sourceRunId: number, frozen?: SourceFile): Promise<HistoricalDwellEvidence> {
  const layout = layouts[sourceRunId];
  if (!layout) throw Error('No supported historical dwell source');
  const files: SourceFile[] = [];
  const load = async (path: string, expected?: string) => { const r = await checked(path, expected); files.push(r.file); return r; };
  const sourceOrigin = resolve(root, 'data/account-task-data/taobao/tb_main/tb_coin/bundle.json');
  const { value: bundle } = await checked(frozen?.path ?? sourceOrigin, frozen?.sha256);
  if (frozen && bundle.sourceOrigin !== sourceOrigin) throw Error('Historical snapshot origin mismatch');
  const expectedScope = { appId: 'taobao', accountId: 'tb_main', activityId: 'tb_coin' };
  if (bundle.schemaVersion !== 2 || !same(bundle.scope, expectedScope) || bundle.account?.id !== 'tb_main'
    || bundle.account.appId !== 'taobao' || bundle.account.userId !== 0) throw Error('Historical v2 scope mismatch');
  const unique = (xs: any[]) => { if (xs.length !== 1) throw Error('Missing or ambiguous original run mapping'); return xs[0]; };
  const execution = unique(bundle.executions.filter((e: any) => e.runId === sourceRunId));
  if (!same(execution.scope, expectedScope)) throw Error('Historical execution scope mismatch');
  const proposal = (await load(resolve(root, 'docs/历史已学任务本地合同草案.json'))).value;
  const annotation = unique(proposal.contracts.filter((c: any) => c.sourceRunId === sourceRunId));
  if (resolve(root, execution.resultFile) !== resolve(root, annotation.sourceResult.path)) throw Error('Historical result mapping mismatch');
  const result = await load(resolve(root, execution.resultFile), annotation.sourceResult.sha256), r = result.value;
  if (!same(r, execution.result) || r.runId !== sourceRunId || !['supervised_success', 'completed'].includes(r.status)
    || !Number.isSafeInteger(r.gainCoins) || r.gainCoins <= 0 || !Number.isSafeInteger(r.balanceBefore)
    || !Number.isSafeInteger(r.balanceAfter) || r.balanceAfter - r.balanceBefore !== r.gainCoins) throw Error('Historical positive gain/result mapping mismatch');
  const snapshot = unique(bundle.snapshots.filter((s: any) => s.id === execution.taskSnapshotId));
  const task = unique(bundle.tasks.filter((t: any) => t.id === snapshot.taskId));
  if (!same(snapshot.scope, expectedScope) || !same(task.scope, expectedScope)
    || norm(task.name) !== norm(typeof r.task === 'string' ? r.task : r.task.name)) throw Error('Historical task mapping mismatch');
  const owner = { package: 'com.taobao.taobao', userId: bundle.account.userId };
  const executionRunId = sourceRunId === 134 ? 133 : sourceRunId;
  const origin = unique(bundle.executions.filter((e: any) => e.runId === executionRunId));
  if (!same(origin.scope, expectedScope)) throw Error('Original execution scope mismatch');
  const dir = resolve(root, origin.evidenceDir);
  let summary: Awaited<ReturnType<typeof checked>> | undefined;
  if (sourceRunId !== 134) {
    summary = await load(resolve(root, origin.summaryFile));
    if (summary.value.target !== task.name || summary.value.actions.filter((a: any) => a.type === 'open').length !== 1) throw Error('Missing unique historical entry action');
    const open = summary.value.actions.find((a: any) => a.type === 'open');
    if (!origin.actions.some((a: any) => a.type === 'open' && same(a, open))) throw Error('Historical entry mapping mismatch');
  } else {
    const original = (await load(resolve(root, origin.resultFile))).value;
    const stages = (await load(resolve(dir, 'stages.json'))).value;
    if (!same(original, origin.result) || r.sourceRunId !== 133 || r.recoveredAfterError !== true
      || !r.taskAttemptId || original.taskAttemptId !== r.taskAttemptId || !same(original.receipt, r.receipt)
      || original.receipt.taskAttemptId !== r.taskAttemptId || original.balanceBefore !== r.balanceBefore
      || !same(original.task, r.task)) throw Error('Recovery is not linked to original attempt/receipt');
    const open = unique(stages.filter((s: any) => s.stageId === 'open_task' && s.status === 'completed'));
    if (open.actions.filter((a: any) => ['verified', 'observed'].includes(a.status) && a.proposal?.action?.type === 'tap').length !== 1
      || !open.events.some((e: any) => e.type === 'observed' && e.frame?.id === layout.before)
      || !stages.some((s: any) => s.stageId === 'task_receipt' && s.events.some((e: any) => e.type === 'observed' && e.frame?.id === r.receipt.frameId))) throw Error('Missing original action/receipt observation');
    await load(resolve(root, execution.evidenceDir, 'stages.json'));
  }
  const get = async (id: string): Promise<[Reference, DeviceFrame]> => {
    const fixture = unique(annotation.historicalFixtures.filter((f: any) => basename(f.png) === id + '.png'));
    const path = resolve(root, fixture.png), ocrPath = resolve(root, fixture.ocr);
    if (dirname(path) !== dir) throw Error('Receipt source directory mismatch');
    const pngSha = hash(await readFile(path));
    if (pngSha !== fixture.pngSha256) throw Error('Historical PNG hash mismatch');
    files.push({ path, sha256: pngSha });
    const ocr = await load(ocrPath, fixture.ocrSha256);
    if (!summary) {
      // Staged frames also preserve the engine's original pages OCR separately.
      const raw = await load(path.replace(/\.png$/, '.ocr.json'));
      const page = raw.value.pages?.length === 1 ? raw.value.pages[0] : null;
      if (!page || page.file !== path || page.width !== ocr.value.width || page.height !== ocr.value.height
        || !same(page.lines.map((l: any) => ({ text: l.text, bounds: l.bounds })), ocr.value.lines)) throw Error('Original OCR differs from staged frame');
    }
    const ref: Reference = { path, sha256: pngSha, ocrPath, ocrSha256: ocr.file.sha256, frameId: id,
      ...(summary ? { derivation: { summaryPath: summary.file.path, summarySha256: summary.file.sha256, owner } } : {}) };
    const frame = await readDwellReference(ref);
    if (frame.package !== owner.package || frame.userId !== owner.userId || frame.width !== 1080 || frame.height !== 2400 || frame.observationError) throw Error('Invalid historical frame owner');
    return [ref, frame];
  };
  const [browsingReference, browsing] = await get(layout.before), [receiptReference, receipt] = await get(layout.after);
  if (browsing.capturedAt >= receipt.capturedAt) throw Error('Historical capture order mismatch');
  let dwellMs = 1000;
  if (sourceRunId !== 134) {
    const requirements = browsing.lines.filter(l => /^浏览\d+秒$/.test(norm(l.text)) && l.bounds[0] >= layout.box[0] && l.bounds[1] >= layout.box[1] && l.bounds[3] <= layout.box[3]);
    if (requirements.length !== 1 || !browsing.lines.some(l => norm(l.text) === '得奖励' && l.bounds[0] >= layout.box[0] && l.bounds[1] >= layout.box[1] && l.bounds[3] <= layout.box[3])) throw Error('Missing independent historical dwell requirement');
    dwellMs = Number(norm(requirements[0].text).match(/\d+/)![0]) * 1000;
    if (r.observedRequirement !== norm(requirements[0].text) + '得奖励') throw Error('Historical requirement/result mismatch');
    const open = summary!.value.actions.find((a: any) => a.type === 'open');
    if (browsing.capturedAt <= Date.parse(open.at)) throw Error('Destination predates original entry');
  } else if (r.receipt.frameId !== receipt.id || r.receipt.path !== receipt.path) throw Error('Recovery receipt source mismatch');
  // Freeze only the mapping used above, after the original result/action/OCR chain has passed.
  const executions = origin === execution ? [execution] : [origin, execution];
  const snapshots = executions.map(e => unique(bundle.snapshots.filter((s: any) => s.id === e.taskSnapshotId)));
  const tasks = [...new Set(snapshots.map(s => unique(bundle.tasks.filter((t: any) => t.id === s.taskId))))];
  if (snapshots.some(s => !same(s.scope, expectedScope) || s.taskId !== task.id || s.instruction !== snapshot.instruction)
    || tasks.some(t => !same(t.scope, expectedScope) || t.id !== task.id)) throw Error('Historical original task mapping mismatch');
  const bytes = Buffer.from(JSON.stringify({ schemaVersion: 2, scope: bundle.scope, account: bundle.account,
    sourceOrigin, tasks, snapshots, executions }, null, 2) + '\n');
  const mappingSha256 = hash(bytes);
  const mappingPath = resolve(root, 'data/stage-records/evidence-sources', mappingSha256 + '.json');
  if (frozen) {
    if (frozen.path !== mappingPath || frozen.sha256 !== mappingSha256) throw Error('Historical snapshot mapping mismatch');
  } else {
    await mkdir(dirname(mappingPath), { recursive: true });
    try { await writeFile(mappingPath, bytes, { flag: 'wx' }); }
    catch (error: any) { if (error.code !== 'EEXIST') throw error; }
  }
  const mapping = await load(mappingPath, mappingSha256);
  return { owner, task: { name: task.name, instruction: snapshot.instruction }, dwellMs, receiptOnly: sourceRunId === 134,
    browsing, receipt, browsingReference, receiptReference, identityPatterns: layout.identity, componentBox: layout.box,
    provenance: { kind: 'historical-dwell-v1', sourceRunId, executionRunId, newSessionValidation: false, scopeSource: mappingPath,
      sourceOrigin, executionId: origin.id, ...(r.taskAttemptId ? { taskAttemptId: r.taskAttemptId } : {}), files,
      requirementSource: sourceRunId === 134 ? 'unknown; receipt only, 1000ms budget grants no waiting' : browsingReference.ocrPath },
    resultPath: result.file.path, resultSha256: result.file.sha256, mappingPath, mappingSha256: mapping.file.sha256 };
}

export async function buildHistoricalFlashReturnProposal(root: string) {
  const source = await loadHistoricalDwellEvidence(root, 131);
  const dir = dirname(source.resultPath), files = [...source.provenance.files];
  const proposal = JSON.parse(await readFile(resolve(root, 'docs/历史已学任务本地合同草案.json'), 'utf8'));
  const annotation = proposal.contracts.find((c: any) => c.sourceRunId === 131);
  for (const fixture of annotation.historicalFixtures.filter((f: any) => /exit-modal-current|frame-15/.test(f.png))) {
    if (hash(await readFile(resolve(root, fixture.png))) !== fixture.pngSha256) throw Error('Flash modal PNG hash mismatch');
    files.push({ path: resolve(root, fixture.png), sha256: fixture.pngSha256 });
    const ocr = await checked(resolve(root, fixture.ocr), fixture.ocrSha256); files.push(ocr.file);
    const lines = ocr.value.pages[0].lines;
    if (!lines.some((l: any) => norm(l.text) === '确定要离开吗?')) throw Error('Missing observed flash exit dialog');
  }
  const supplemental = await checked(resolve(dir, 'supplemental-actions.json')); files.push(supplemental.file);
  if (supplemental.value.length !== 1 || supplemental.value[0].type !== 'confirm_exit' || supplemental.value[0].label !== '离开会场去看看') throw Error('Missing historical supplemental action');
  return { sourceRunId: 131, executable: false, state: 'proposal_only', historicalExitTapEffective: false,
    proposedActions: ['back_once', 'observe_current_exit_dialog', 'back_once', 'owning_panel_stable_balance'],
    guard: 'fresh matching flash destination and original-attempt receipt; exact current modal; max two backs; no promotion clicks',
    blockedUntil: 'bounded return state machine integration and normal-entry validation', files };
}

export async function verifyHistoricalDwellProvenance(provenance: HistoricalDwellEvidence['provenance']) {
  try {
    if (provenance.kind !== 'historical-dwell-v1' || provenance.newSessionValidation !== false || !layouts[provenance.sourceRunId]
      || provenance.executionRunId !== (provenance.sourceRunId === 134 ? 133 : provenance.sourceRunId) || !provenance.files.length) return false;
    for (const f of provenance.files) if (!/^[a-f0-9]{64}$/.test(f.sha256) || hash(await readFile(f.path)) !== f.sha256) return false;
    const mapping = provenance.files.filter(f => f.path === provenance.scopeSource);
    if (mapping.length !== 1 || basename(mapping[0].path) !== mapping[0].sha256 + '.json') return false;
    const root = resolve(dirname(mapping[0].path), '../../..');
    const evidence = await loadDwellEvidence(root, provenance.sourceRunId, mapping[0]);
    const derived = evidence.provenance;
    return derived.sourceOrigin === provenance.sourceOrigin && derived.executionId === provenance.executionId
      && derived.taskAttemptId === provenance.taskAttemptId && derived.requirementSource === provenance.requirementSource
      && derived.files.every(required => provenance.files.some(f => f.path === required.path && f.sha256 === required.sha256));
  } catch { return false; }
}
