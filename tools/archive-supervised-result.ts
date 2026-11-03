import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { validateSplitTaskRecords } from '../runner/task-records-v2.ts';
import {assertLegacyWriterAllowed} from '../runner/storage/structured.ts';
assertLegacyWriterAllowed();

const read = (f: string) => JSON.parse(fs.readFileSync(f, 'utf8'));
const ed = process.argv[2];
if (!ed || path.isAbsolute(ed) || ed.split('/').includes('..')) throw Error('Relative evidence directory required');
const r = read(ed + '/result.json'), learning = read(ed + '/learning.json'), summary = read(ed + '/summary.json');
const indexFile = 'data/task-records-v2/index.json', m = read(indexFile);
const k = read(m.knowledgeBundle), a = read(m.accountBundle), scope = a.scope, ks = k.scope;
const hash = (kind: string, ...parts: unknown[]) => kind + '_' + crypto.createHash('sha256').update(JSON.stringify(parts)).digest('hex');
const plan = a.plans.find((p: any) => p.decisions.some((d: any) => d.name === r.task));
if (!plan) throw Error('Missing preserved plan');
const decision = plan.decisions.find((d: any) => d.name === r.task);
const task = a.tasks.find((t: any) => t.id === decision.taskId);
if (!task || task.instruction !== learning.listInstruction || decision.decision !== 'do') throw Error('Task/plan mismatch');
const frame = `${ed}/frame-${learning.beforeFrame}`;
const lines = read(frame + '.json').pages[0].lines;
if (!lines.some((l: any) => l.text.normalize('NFKC') === (r.task + '(0/1)').normalize('NFKC'))) throw Error('Target not observed');
for (const text of learning.requiredListText) if (!lines.some((l: any) => l.text === text)) throw Error('Required list text missing: ' + text);
const iid = hash('inventory', scope, ed, 'target-before');
const snap = { id: hash('snapshot', scope, iid, task.id), scope, inventoryId: iid, taskId: task.id,
  done: 0, total: 1, instruction: learning.listInstruction, displayRewardCoins: learning.displayRewardCoins,
  button: learning.button, evidence: frame + '.png', ocrSource: frame + '.json', positionAuthority: false };
function upsert(rows: any[], row: any) {
  const old = rows.find((x: any) => x.id === row.id);
  if (old && JSON.stringify(old) !== JSON.stringify(row)) throw Error('Immutable record conflict: ' + row.id);
  if (!old) rows.push(row);
}
upsert(a.snapshots, snap);
upsert(a.inventories, { id: iid, scope, complete: false, source: snap.ocrSource, taskSnapshotIds: [snap.id], note: 'Only current target refreshed; remaining inventory requires refresh.' });
const eid = hash('execution', scope, r.runId), originalPath = learning.scriptPath;
const bytes = fs.readFileSync(originalPath), sh = crypto.createHash('sha256').update(bytes).digest('hex');
const sid = hash('scriptversion', ks, originalPath, sh);
const src = path.dirname(m.knowledgeBundle) + '/script-sources/' + sid + '.ts';
upsert(k.scriptVersions, { id: sid, scope: ks, path: src, originalPath, fileSha256: sh, mode: 'interactive_probe', crossAccountValidated: false });
const expid = hash('experienceversion', ks, task.taskDefinitionId, sid, learning.procedureVersion);
upsert(k.experienceVersions, { id: expid, scope: ks, taskDefinitionIds: [task.taskDefinitionId], scriptVersionId: sid,
  validation: 'supervised_only', crossAccountValidated: false, orderedSteps: learning.orderedSteps,
  completionQuotes: r.completionQuote, reusePreconditions: learning.reusePreconditions, knownLimits: learning.knownLimits,
  sources: [{ appId: ks.appId, activityId: ks.activityId, accountId: scope.accountId, executionId: eid, runId: r.runId, resultFile: ed + '/result.json' }] });
const extra = fs.existsSync(ed + '/supplemental-actions.json') ? read(ed + '/supplemental-actions.json') : [];
const actions = [...summary.actions, ...extra].sort((x: any, y: any) => x.at.localeCompare(y.at));
upsert(a.executions, { id: eid, scope, runId: r.runId, taskSnapshotId: snap.id, planId: plan.id,
  decisionTaskSnapshotId: decision.taskSnapshotId, status: r.status, evidenceDir: ed, resultFile: ed + '/result.json',
  summaryFile: ed + '/summary.json', assetId: a.activity.assetId, result: r, actions, automaticRunnerAcceptance: false,
  usedExperienceVersionId: null, derivedExperienceVersionIds: [expid],
  linkProvenance: 'supervised task; retrospective archival association to preserved plan decision' });
const progressId = hash('progress', scope, eid);
const existingProgress = a.progress.find((p: any) => p.id === progressId);
if (!existingProgress) a.progress.push({ id: progressId, scope, planId: plan.id,
  executionIds: a.executions.filter((e: any) => e.planId === plan.id).map((e: any) => e.id),
  requiresInventoryRefresh: true, status: 'paused_after_supervised_task', nextTask: learning.nextTask });
validateSplitTaskRecords({ schemaVersion: 2, knowledge: k, accountData: a });
const outputs = new Map<string, Buffer>();
const add = (f: string, value: any) => outputs.set(f, Buffer.from(JSON.stringify(value, null, 2) + '\n'));
add(m.knowledgeBundle, k); add(m.accountBundle, a); outputs.set(src, bytes);
for (const [part, key, base] of [[k, 'knowledgeRecords', path.dirname(m.knowledgeBundle)], [a, 'accountRecords', path.dirname(m.accountBundle)]] as any[]) {
  for (const kind of Object.keys(m[key])) m[key][kind] = part[kind].map((row: any) => { const f = `${base}/${kind}/${row.id}.json`; add(f, row); return f; });
}
add(indexFile, m);
// Preflight every target before any write; immutable per-record files may only match.
const mutable = new Set([indexFile, m.knowledgeBundle, m.accountBundle]);
for (const [f, value] of outputs) if (fs.existsSync(f) && !mutable.has(f) && !fs.readFileSync(f).equals(value)) throw Error('Stored immutable conflict: ' + f);
const backupDir = '.backups/supervised-archive-' + r.runId;
for (const [f, value] of outputs) {
  if (fs.existsSync(f)) {
    const old = fs.readFileSync(f); if (old.equals(value)) continue;
    const backup = path.join(backupDir, f); fs.mkdirSync(path.dirname(backup), { recursive: true });
    if (!fs.existsSync(backup)) fs.writeFileSync(backup, old, { flag: 'wx' });
  }
  fs.mkdirSync(path.dirname(f), { recursive: true });
  const tmp = f + '.tmp-' + process.pid; fs.writeFileSync(tmp, value, { flag: 'wx' }); fs.renameSync(tmp, f);
}
console.log(JSON.stringify({ runId: r.runId, execution: eid, experience: expid, script: sid, archived: true }, null, 2));
