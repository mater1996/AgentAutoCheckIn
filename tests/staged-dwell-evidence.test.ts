import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, mkdir, writeFile, rm, copyFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { createStagedRuntime } from '../runner/staged/runtime.ts';
test('historical 129 uses real checker and runtime for three bounded slices; 134 completes without waiting', async () => {
  const { loadHistoricalDwellEvidence } = await import('../runner/staged/dwell-evidence.ts');
  const { buildHistoricalDwellContract } = await import('../runner/staged/dwell-browse.ts');
  for (const run of [129,134]) {
    const source = await loadHistoricalDwellEvidence(root, run), contract = await buildHistoricalDwellContract(root, run);
    const dir = await mkdtemp('/Users/mater/.hermes/cache/scratch/dwell-historical-runtime-');
    let state = 'panel', serial = 0, elapsed = 0, queries = 0;
    const actions: any[] = [];
    const device = { capture: async () => state === 'panel' ? {
      id: 'panel-' + (++serial), path: 'offline-panel.png', width:1080,height:2400,capturedAt:Date.now(),...source.owner,
      lines:[{text:'赚金币抵钱',bounds:[390,470,680,530]},{text:'1440',bounds:[90,240,210,300]},
        {text:contract.task.name+'（0/1）',bounds:[230,900,750,950]},{text:contract.task.instruction,bounds:[230,970,600,1010]},{text:'去完成',bounds:[880,920,1000,960]}]
    } : { ...(elapsed >= contract.dwellMs ? source.receipt : source.browsing), id:'replay-'+(++serial), capturedAt:Date.now() },
      act:async(a:any)=>{actions.push(a);if(a.type==='tap')state='destination';if(a.type==='wait'&&a.ms>1000)elapsed+=a.ms;},
      scrollContinuously:async()=>{throw Error('Unexpected scroll');} };
    const cfg:any={package:source.owner.package,scope:{appId:'taobao',accountId:'tb_main',activityId:'tb_coin',userId:0},panelMarker:'赚金币抵钱',constraints:[],selectionAllowNew:false,
      learnedBrowse:{enabled:true,version:'continuous-browse-candidate-v1',sourceRunId:153},dwellBrowse:{version:'dwell-browse-candidate-v1',contracts:[contract]},scriptValidationMode:true,
      limits:{stageMs:90000,sessionMs:600000,agentCalls:20,stageActions:8,maxReturns:3},stages:Object.fromEntries(['open_task','task_receipt'].map(s=>[s,{goal:s,checkpoint:s+'_ok'}]))};
    try {
      const rt=createStagedRuntime(cfg,device,{query:async()=>{queries++;throw Error('Forbidden model call');}},{sessionId:'offline-history-'+run,evidenceDir:dir,plan:[{...contract.task,decision:'do',times:1}]});
      const selected=await rt.stage('select_task',{});assert.equal(selected.status,'completed');
      const ctx={task:selected.task,taskAttemptId:'offline-history-attempt-'+run};
      const opened=await rt.stage('open_task',ctx);assert.equal(opened.status,'completed',opened.error);
      const done=await rt.stage('task_receipt',ctx);assert.equal(done.status,'completed',done.error);
      assert.deepEqual(actions.filter(a=>a.type==='wait'&&a.ms>1000).map(a=>a.ms),run===129?[5000,5000,5000]:[]);
      assert.equal(done.receipt.taskAttemptId,ctx.taskAttemptId);assert.equal(queries,0);assert.equal(rt.calls,0);
    } finally { await rm(dir,{recursive:true,force:true}); }
  }
});

const root = new URL('../', import.meta.url).pathname;
const mappingRel = 'data/account-task-data/taobao/tb_main/tb_coin/bundle.json';

async function historicalFixture(run: number) {
  const directory = await mkdtemp('/Users/mater/.hermes/cache/scratch/dwell-history-mapping-');
  const { loadHistoricalDwellEvidence } = await import('../runner/staged/dwell-evidence.ts');
  const original = await loadHistoricalDwellEvidence(root, run);
  // Copy the real account graph and archived inputs; frame paths retain their original authority.
  const paths = new Set([join(root, mappingRel), ...original.provenance.files.map(f => f.path)]);
  for (const path of paths) {
    const target = join(directory, path.slice(root.length));
    await mkdir(dirname(target), { recursive: true });
    await copyFile(path, target);
  }
  const bundlePath = join(directory, mappingRel);
  const bundle = JSON.parse(await readFile(bundlePath, 'utf8'));
  for (const execution of bundle.executions) execution.evidenceDir = join(root, execution.evidenceDir);
  await writeFile(bundlePath, JSON.stringify(bundle));
  const proposalPath = join(directory, 'docs/历史已学任务本地合同草案.json');
  const proposal = JSON.parse(await readFile(proposalPath, 'utf8'));
  for (const contract of proposal.contracts) for (const fixture of contract.historicalFixtures) {
    fixture.png = join(root, fixture.png);
    fixture.ocr = join(root, fixture.ocr);
  }
  await writeFile(proposalPath, JSON.stringify(proposal));
  return directory;
}

test('built historical contracts survive unrelated execution appends to the real account bundle copy', async () => {
  const { loadHistoricalDwellEvidence, verifyHistoricalDwellProvenance } = await import('../runner/staged/dwell-evidence.ts');
  const { buildHistoricalDwellContract, inspectDwellBrowse } = await import('../runner/staged/dwell-browse.ts');
  for (const run of [129, 130, 131, 132, 134]) {
    const directory = await historicalFixture(run);
    try {
      const source = await loadHistoricalDwellEvidence(directory, run);
      const contract = await buildHistoricalDwellContract(directory, run);
      const before = await readFile(source.mappingPath);
      const livePath = join(directory, mappingRel);
      const bundle = JSON.parse(await readFile(livePath, 'utf8'));
      bundle.executions.push({ id: 'unrelated-new-execution', runId: 999999 });
      await writeFile(livePath, JSON.stringify(bundle));
      assert.equal(await verifyHistoricalDwellProvenance(contract.provenance!), true);
      assert.equal((await inspectDwellBrowse(source.receipt, source.owner, contract))?.state, 'completed');
      assert.deepEqual(await readFile(source.mappingPath), before);
      const rebuilt = await loadHistoricalDwellEvidence(directory, run);
      assert.equal(rebuilt.mappingPath, source.mappingPath);
      assert.equal(rebuilt.mappingSha256, source.mappingSha256);
      assert.equal(source.provenance.scopeSource, source.mappingPath);
      assert.equal(source.provenance.files.some(f => f.path === livePath), false);
      assert.match(source.mappingPath, /data\/stage-records\/evidence-sources\/[a-f0-9]{64}\.json$/);
      const snapshot = JSON.parse(before.toString());
      assert.deepEqual(snapshot.executions.map((e: any) => e.runId), run === 134 ? [133, 134] : [run]);
      assert.equal(snapshot.tasks.length, 1);
      assert.equal(snapshot.snapshots.length, run === 134 ? 2 : 1);
      assert.equal(source.provenance.sourceOrigin, livePath);
    } finally { await rm(directory, { recursive: true, force: true }); }
  }
});

test('historical provenance requires the snapshot and complete original result chain', async () => {
  const { loadHistoricalDwellEvidence, verifyHistoricalDwellProvenance } = await import('../runner/staged/dwell-evidence.ts');
  const directory = await historicalFixture(134);
  try {
    const source = await loadHistoricalDwellEvidence(directory, 134);
    const snapshot = JSON.parse(await readFile(source.mappingPath, 'utf8'));
    assert.deepEqual(snapshot.executions.map((e: any) => e.runId), [133, 134]);
    assert.equal(await verifyHistoricalDwellProvenance(source.provenance), true);
    for (const path of [source.mappingPath, source.resultPath, join(directory, snapshot.executions[0].resultFile)]) {
      assert.equal(await verifyHistoricalDwellProvenance({ ...source.provenance,
        files: source.provenance.files.filter(f => f.path !== path) }), false, path);
    }
    assert.equal(await verifyHistoricalDwellProvenance({ ...source.provenance, executionId: 'unlinked-execution' }), false);
    assert.equal(await verifyHistoricalDwellProvenance({ ...source.provenance, taskAttemptId: 'unlinked-attempt' }), false);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('recovery snapshot requires the original attempt task mapping before freezing', async () => {
  const { loadHistoricalDwellEvidence } = await import('../runner/staged/dwell-evidence.ts');
  const directory = await historicalFixture(134);
  try {
    const path = join(directory, mappingRel);
    const bundle = JSON.parse(await readFile(path, 'utf8'));
    const origin = bundle.executions.find((e: any) => e.runId === 133);
    const snapshot = bundle.snapshots.find((s: any) => s.id === origin.taskSnapshotId);
    snapshot.scope = { ...snapshot.scope, accountId: 'another-account' };
    await writeFile(path, JSON.stringify(bundle));
    await assert.rejects(loadHistoricalDwellEvidence(directory, 134), /task mapping mismatch/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('snapshot and original result tampering fail closed without repairing an existing snapshot', async () => {
  const { loadHistoricalDwellEvidence, verifyHistoricalDwellProvenance } = await import('../runner/staged/dwell-evidence.ts');
  const { buildHistoricalDwellContract, inspectDwellBrowse } = await import('../runner/staged/dwell-browse.ts');
  const directory = await historicalFixture(129);
  try {
    const source = await loadHistoricalDwellEvidence(directory, 129);
    const contract = await buildHistoricalDwellContract(directory, 129);
    for (const path of [source.mappingPath, source.resultPath]) {
      const original = await readFile(path);
      await writeFile(path, '{}');
      assert.equal(await verifyHistoricalDwellProvenance(source.provenance), false);
      assert.equal(await inspectDwellBrowse(source.receipt, source.owner, contract), null);
      await assert.rejects(loadHistoricalDwellEvidence(directory, 129), /source hash mismatch/);
      assert.equal(await readFile(path, 'utf8'), '{}');
      await writeFile(path, original);
    }
    assert.equal(await verifyHistoricalDwellProvenance(source.provenance), true);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('flash return proposal binds original modal and no-effect supplemental tap without enabling runtime actions', async () => {
  const mod = await import('../runner/staged/dwell-evidence.ts');
  assert.equal(typeof mod.buildHistoricalFlashReturnProposal, 'function');
  const p = await mod.buildHistoricalFlashReturnProposal(root);
  assert.equal(p.executable, false);
  assert.equal(p.sourceRunId, 131);
  assert.equal(p.historicalExitTapEffective, false);
  assert.deepEqual(p.proposedActions, ['back_once', 'observe_current_exit_dialog', 'back_once', 'owning_panel_stable_balance']);
  assert.ok(p.files.every((f: any) => /^[a-f0-9]{64}$/.test(f.sha256)));
});

test('historical mapping and original source bytes are required, recovery cannot become standalone execution', async () => {
  const { loadHistoricalDwellEvidence, verifyHistoricalDwellProvenance } = await import('../runner/staged/dwell-evidence.ts');
  const source = await loadHistoricalDwellEvidence(root, 134);
  assert.equal(await verifyHistoricalDwellProvenance(source.provenance), true);
  assert.equal(await verifyHistoricalDwellProvenance({ ...source.provenance, executionRunId: 134 }), false);
  const directory = await mkdtemp('/Users/mater/.hermes/cache/scratch/dwell-history-tamper-');
  try {
    const mappingRel = 'data/account-task-data/taobao/tb_main/tb_coin/bundle.json';
    const proposalRel = 'docs/历史已学任务本地合同草案.json';
    const mapping = JSON.parse(await readFile(join(root, mappingRel), 'utf8'));
    await mkdir(dirname(join(directory, mappingRel)), { recursive: true });
    await mkdir(dirname(join(directory, proposalRel)), { recursive: true });
    await copyFile(join(root, proposalRel), join(directory, proposalRel));
    for (const mutation of [
      { ...mapping, account: { ...mapping.account, userId: 10 } },
      { ...mapping, executions: [...mapping.executions, mapping.executions.find((e: any) => e.runId === 129)] },
    ]) {
      await writeFile(join(directory, mappingRel), JSON.stringify(mutation));
      await assert.rejects(loadHistoricalDwellEvidence(directory, 129), /scope|ambiguous/);
    }
    await writeFile(join(directory, mappingRel), JSON.stringify(mapping));
    const execution = mapping.executions.find((e: any) => e.runId === 129);
    await mkdir(dirname(join(directory, execution.resultFile)), { recursive: true });
    await writeFile(join(directory, execution.resultFile), JSON.stringify({ ...execution.result, gainCoins: 999 }));
    await assert.rejects(loadHistoricalDwellEvidence(directory, 129), /source hash mismatch/);
    const f = source.provenance.files[0];
    const changed = join(directory, 'source.json');
    await writeFile(changed, '{}');
    assert.equal(await verifyHistoricalDwellProvenance({ ...source.provenance, files: [{ ...f, path: changed }] }), false);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('historical adapter derives old pages in memory with original hashes, time and v2 scope', async () => {
  const mod = await import('../runner/staged/dwell-evidence.ts');
  assert.equal(typeof mod.loadHistoricalDwellEvidence, 'function');
  const source = await mod.loadHistoricalDwellEvidence(root, 129);
  assert.equal(source.browsing.id, 'frame-4');
  assert.equal(source.browsing.capturedAt, Date.parse('2026-11-01T00:08:45.677Z'));
  assert.deepEqual(source.owner, { package: 'com.taobao.taobao', userId: 0 });
  assert.equal(source.dwellMs, 15000);
  assert.equal(source.provenance.executionRunId, 129);
  assert.equal(source.provenance.newSessionValidation, false);
  const original = JSON.parse(await readFile(source.browsingReference.ocrPath, 'utf8'));
  assert.ok(original.pages);
  assert.equal(original.id, undefined);
  assert.match(source.browsingReference.ocrSha256, /^[a-f0-9]{64}$/);
});
