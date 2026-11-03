import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {z} from 'zod';
import {explicitlySkipped, supportsRoute} from './round-planner.ts';
import {taskIdentity, type RoundAttempt, type RoundPlanItem} from './round.ts';
import {writeRoundState} from './round-state.ts';
import {readStateFile,stateFileExists,writeStateFile} from '../storage/structured.ts';

export type NextDecisionOptions = {
 device: {capture(): Promise<any>; act(action: any, frame?: any): Promise<unknown>};
 model: {query(request: any): Promise<unknown>}; cfg: any;
 scope: {appId: string; accountId: string; activityId: string; userId: number};
 sessionId: string; taskAttemptId: string; evidenceDir: string;
 attempts?: RoundAttempt[]; priorPlans?: unknown; knowledge?: unknown; policy?: any;
 event?: (kind: string, data: any) => unknown | Promise<unknown>;
};
export type NextCoverage = {top: boolean; bottom: boolean; topVerified: boolean; bottomVerified: boolean; complete: boolean; pages: any[]};
export type NextTaskSelection = {task: any; balanceBefore: number; frame: any; plan: any; nextAction: any;
 sessionId: string; taskAttemptId: string; scope: NextDecisionOptions['scope']; owner: {package: string; userId: number};
 sourcePngSha256: string; evidenceKey: string; evidence: {path: string; sha256: string}};
export type NextDecisionResult = {decision: 'task' | 'finish' | 'stop'; item?: RoundPlanItem; selection?: NextTaskSelection; coverage: NextCoverage; error?: string; inputUnknown?: boolean; blocked?: boolean};
const text = z.string().min(1).refine(v => !!v.trim());
const integer = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const selectedTask = z.object({name: text, instruction: text, done: integer, total: integer.positive(), category: z.enum(['ordinary-in-app','invite','spending','game','cross-app','auth','install','phone','camera','unknown']), actionType: text, routeSupported: z.boolean().optional(), button: text}).passthrough();
const response = z.object({frameId: text, state: z.object({isList: z.boolean(), blocked: z.boolean(), top: z.boolean().nullable(), bottom: z.boolean().nullable(), balance: integer.nullable(), viewportKey: text.optional(), visibleTaskIds: z.array(text).optional()}).passthrough(), decision: z.enum(['select','scroll','finish','stop']), task: z.unknown(), plan: z.unknown(), nextAction: z.unknown(), reason: text}).passthrough();
const planSchema = z.object({steps: z.array(text).nonempty(), stopConditions: z.array(text).nonempty()}).passthrough();
const hash = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');

export const NEXT_DECISION_PROMPT = `Read the supplied ORIGINAL full PNG and context once. Decide the NEXT action with selected task, conditional plan and current button in this SAME query; never require full-list inventory. Return JSON:
{"frameId":"supplied exact frame id","state":{"isList":boolean,"blocked":boolean,"top":boolean|null,"bottom":boolean|null,"balance":integer|null,"viewportKey":"stable visible task-row semantic content, no clock/frame IDs/timestamps/coordinates","visibleTaskIds":["optional exact visible task identity strings in screen order; no geometry required"]},"decision":"select|scroll|finish|stop","task":null|{"name":"exact title without quota","instruction":"exact complete actual action requirement without reward amounts; preserve durations","done":integer,"total":positive integer,"category":"ordinary-in-app|invite|spending|game|cross-app|auth|install|phone|camera|unknown","actionType":"actual supported route type","routeSupported":boolean,"button":"current visible label","reward":integer|null},"plan":null|{"steps":["conditional execution using learned scripts or runtime AI as needed"],"stopConditions":["unknown input, login/auth, out-of-scope requirements, unverified return, persistence failure"]},"nextAction":null|{"type":"tap","x":number,"y":number,"bounds":[left,top,right,bottom]}|{"type":"swipe","fromX":number,"fromY":number,"toX":number,"toY":number,"ms":positive integer},"reason":"evidence based reason"}.
Use full context cfg including code-readable learned scripts, constraints, knowledge, prior plans, attempts and current search history. No title keyword heuristics: a game-titled independent browse can be allowed. Exact skips 玩消消乐领金币 and 养小羊免费赚话费 are mandatory. Also honor cfg.round.exactSkips, priorPlans {path,plan} userSkip:true and policy.userSkips. Actual invitation/spending/gameplay/cross-app/install/camera/auth/phone unsupported. Classify complete actual requirements, not names. Unknown/ambiguous input or login/security/auth barriers => stop. Do not replay uncertain input. Reserved/consumed identities never retry despite quota/frame changes; pending same task semantic evidence never retries. Previous ordinary skip/do=0 does not exclude a new identity.
Search starts by seeking a VERIFIED list top. The fixed header/balance is not evidence of top: top=true only if actual list-start reward/progress card is visible above first task. While context.coverage.topVerified=false and state.top!=true, return scroll with downward finger movement to seek top, even if a candidate is visible. After verified top, read rows from top downward, skip tried/user-skipped/complete/excluded/unsupported rows; select the FIRST eligible fully visible row immediately, without later pages. Only its current button bounds/point required; do not enumerate other row geometry. Route support must match exact cfg interactionRoutes.type/controllerCandidates.family/dwellBrowse.contracts/immersiveBrowse task; exact owner cannot be overridden by generic browse. Generic browse/ordinary-browse/dwell-browse/continuous-browse only if learnedBrowse continuous-browse-candidate-v1 sourceRunId 153 enabled with aiTaskRecovery, aiPanelReader true and scriptValidationMode false. No invented action type. Preserve current exact identity and quota. Tap is a proposal for the existing executor; search only dispatches scroll. No candidate on current page => scroll down with upward finger movement, retaining overlapping rows. bottom=true only on actual end disclaimer beneath final task. Finish ONLY after verified top-to-current-bottom coverage and no eligible candidate. Never stop search early for missing candidate, arbitrary time/action/model caps or prior full-inventory prerequisites. Unknown balance is null. Select requires known owning header balance, no reward/progress amount substituted.`;

function learnedScripts(knowledge: any): any[] {
 return (Array.isArray(knowledge?.scriptVersions) ? knowledge.scriptVersions : []).map((script: any) => {
  if (typeof script?.code === 'string') return script;
  if (typeof script?.path !== 'string' || !script.path.trim()) return script;
  const bytes = fs.readFileSync(path.resolve(script.path)), sourceSha256 = hash(bytes);
  if (script.sha256 && script.sha256 !== sourceSha256) throw Error('Learned script source hash mismatch');
  return {...script, code: bytes.toString('utf8'), sourceSha256};
 });
}
/** Decision context is an explicit projection; the source archive remains untouched. */
export function summarizeAttempts(attempts: RoundAttempt[] = []): any[] {
 const pick=(source:any,keys:string[])=>Object.fromEntries(keys.filter(k=>Object.hasOwn(source,k)).map(k=>[k,structuredClone(source[k])]));
 return attempts.map(a=>{
  const summary=pick(a,['identity','name','instruction','reservationId','status','evidenceKey']);
  const r=a.result;
  if(r){
   summary.result=pick(r,['status','runId','taskAttemptId','roundId','sourceRunId','entryDispatched','inputUnknown','blocked','returned','persistenceVerified','gainCoins','balanceBefore','balanceAfter','error','unexplainedDelta','attributionStatus']);
   const before=(r.task as any)?.beforeFrame?.path;
   if(typeof before==='string')summary.result.evidence={directory:path.dirname(before),resultFile:path.join(path.dirname(before),'final.json')};
  }
  return summary;
 });
}
function samePendingEvidence(previous: string, current: string): boolean {
 if (previous === current) return true;
 try {
  // Historical full-inventory keys may carry a random revision/context. Neither renews this task's evidence.
  const a = JSON.parse(previous), b = JSON.parse(current);
  return ['name','instruction','done','total','button','reward'].every(k => JSON.stringify(a[k] ?? null) === JSON.stringify(b[k] ?? null));
 } catch {return true;} // Unreadable historical evidence cannot grant retry authority.
}
function persist(file: string, value: unknown) {writeRoundState(file, value);}
function sourceHash(frame: any, o: NextDecisionOptions): string {
 if (!frame || !frame.id?.trim() || !path.isAbsolute(frame.path ?? '') || !Number.isSafeInteger(frame.width) || !Number.isSafeInteger(frame.height) || frame.width <= 0 || frame.height <= 0 || !Number.isFinite(frame.capturedAt) || frame.capturedAt <= 0 || frame.package !== o.cfg.package || frame.userId !== o.scope.userId) throw Error('Invalid next-decision frame/owner');
 const dir = fs.realpathSync(o.evidenceDir), file = fs.realpathSync(frame.path);
 if (path.dirname(file) !== dir) throw Error('Next-decision frame outside evidence directory');
 const b = fs.readFileSync(file);
 if (b.length < 33 || !b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) || b.readUInt32BE(8) !== 13 || b.toString('ascii',12,16) !== 'IHDR' || b.readUInt32BE(16) !== frame.width || b.readUInt32BE(20) !== frame.height) throw Error('Invalid next-decision original PNG');
 return hash(b);
}
function semanticKey(state: any, frame: any): string {
 // Never use capture identity, geometry or status-bar time as progress evidence.
 if (state.viewportKey?.trim()) return state.viewportKey.normalize('NFKC').replace(/\s+/g, ' ').trim();
 if (state.visibleTaskIds?.length) return JSON.stringify(state.visibleTaskIds);
 const lines = (frame.lines ?? []).filter((l: any) => typeof l?.text === 'string' && Array.isArray(l.bounds) && l.bounds[1] >= frame.height * .08).map((l: any) => l.text.normalize('NFKC').replace(/\s+/g, ' ').trim()).filter(Boolean);
 if (!lines.length) throw Error('No semantic viewport progress evidence');
 return JSON.stringify(lines);
}
function scrollAction(value: any, frame: any, seeking: boolean) {
 const fallback = {type: 'swipe', fromX: Math.round(frame.width * .38), fromY: Math.round(frame.height * (seeking ? .36 : .84)), toX: Math.round(frame.width * .38), toY: Math.round(frame.height * (seeking ? .84 : .36)), ms: 600};
 const a = value?.type === 'swipe' ? value : fallback;
 if (![a.fromX,a.fromY,a.toX,a.toY,a.ms].every(Number.isFinite) || !Number.isSafeInteger(a.ms) || a.ms < 1 || a.fromX < 0 || a.toX < 0 || a.fromX >= frame.width || a.toX >= frame.width || a.fromY < 0 || a.toY < 0 || a.fromY >= frame.height || a.toY >= frame.height || (seeking ? a.fromY >= a.toY : a.fromY <= a.toY)) throw Error('Invalid search scroll direction/geometry');
 return {type: 'swipe', fromX: a.fromX, fromY: a.fromY, toX: a.toX, toY: a.toY, ms: a.ms};
}
/** Fresh search per call. Only scroll is dispatched here; returned tap belongs to the task executor. */
export async function findNextTask(o: NextDecisionOptions): Promise<NextDecisionResult> {
 const coverage: NextCoverage = {top: false, bottom: false, topVerified: false, bottomVerified: false, complete: false, pages: []};
 let currentStem: string | undefined, inputUnknown = false, blocked = false;
 try {
  if (!o?.sessionId?.trim() || !o.taskAttemptId?.trim() || !o.cfg?.package?.trim() || !o.scope || !['appId','accountId','activityId'].every(k => typeof (o.scope as any)[k] === 'string' && !!(o.scope as any)[k].trim()) || !Number.isSafeInteger(o.scope.userId) || o.scope.userId < 0 || !o.evidenceDir) throw Error('Invalid next-decision options');
  fs.mkdirSync(o.evidenceDir, {recursive: true});
  inputUnknown = (o.attempts ?? []).some(a => a.status === 'reserved' || a.result?.inputUnknown === true);
  blocked = (o.attempts ?? []).some(a => a.result?.blocked === true);
  if ((o.attempts ?? []).some(a => a.status === 'reserved' || a.result?.inputUnknown || a.result?.blocked || a.result && (a.result.returned === false || a.result.persistenceVerified === false))) throw Error('Prior attempt reserved, unknown input, blocked, or return/persistence unresolved');
  const ledgerPath = path.join(o.evidenceDir, 'next-decision-' + hash(o.sessionId + ':' + o.taskAttemptId) + '.inputs.json');
  const ledger = stateFileExists(ledgerPath) ? readStateFile(ledgerPath) : {sessionId: o.sessionId, taskAttemptId: o.taskAttemptId, scope: o.scope, actions: []};
  if (ledger.sessionId !== o.sessionId || ledger.taskAttemptId !== o.taskAttemptId || JSON.stringify(ledger.scope) !== JSON.stringify(o.scope) || !Array.isArray(ledger.actions)) throw Error('Search history binding mismatch');
  if (ledger.actions.some((a: any) => a.status !== 'observed')) {inputUnknown = true; throw Error('Unknown or unresolved prior search input; no replay');}
  const scripts = learnedScripts(o.knowledge);
  const seen = {top: new Set<string>(), down: new Set<string>()}, captureIds = new Set<string>();
  while (true) {
  const frame = await o.device.capture(), sourcePngSha256 = sourceHash(frame, o);
  if (captureIds.has(frame.id)) throw Error('Fresh search capture identity required');
  captureIds.add(frame.id);
  const request = {prompt: NEXT_DECISION_PROMPT, frame, context: {cfg: o.cfg, scope: o.scope, sessionId: o.sessionId, taskAttemptId: o.taskAttemptId, attempts: summarizeAttempts(o.attempts), priorPlans: o.priorPlans ?? [], knowledge: o.knowledge ?? [], learnedScripts: scripts, constraints: {executionPolicy: o.cfg.executionPolicy, taskPolicy: o.cfg.taskPolicy, navigationOnly: true, taskTapExecutorOwned: true}, policy: o.policy ?? {}, coverage: structuredClone(coverage), history: structuredClone(ledger.actions)}};
  const stem = currentStem = path.join(o.evidenceDir, 'next-decision-' + hash(o.sessionId + ':' + o.taskAttemptId + ':' + frame.id));
  persist(stem + '.request.json', request);
  const raw = await o.model.query(request); persist(stem + '.response.json', raw);
  const p = response.parse(raw);
  if (p.frameId !== frame.id || sourceHash(frame, o) !== sourcePngSha256) throw Error('Next-decision frame/source mismatch');
  blocked = p.state.blocked;
  if (p.state.inputUnknown === true || p.inputUnknown === true) {inputUnknown = true; throw Error('Current input unknown; no further input');}
  if (p.nextAction !== null && !['tap','swipe'].includes((p.nextAction as any)?.type)) throw Error('Unknown next-decision input type');
  if (!p.state.isList || blocked) throw Error('Next-decision owning list missing or blocked');
  if (p.decision === 'stop') throw Error('Model stopped next-decision search: ' + p.reason);
  if (p.state.top === true) coverage.top = coverage.topVerified = true;
  const key = JSON.stringify({content: semanticKey(p.state, frame), top: p.state.top, bottom: p.state.bottom}), direction = coverage.topVerified ? 'down' : 'top';
  coverage.pages.push({frameId: frame.id, top: p.state.top, bottom: p.state.bottom, viewportKey: key, direction});
  if (!coverage.topVerified || p.decision !== 'select') {
   if (p.task !== null && p.decision !== 'select' || p.decision !== 'select' && p.plan !== null) throw Error('Nonselection cannot carry task/plan');
   if (coverage.topVerified && p.state.bottom === true) {
    coverage.bottom = coverage.bottomVerified = true; coverage.complete = true;
    persist(stem + '.finish.json', {coverage, rawResponse: raw, sourcePngSha256, sessionId: o.sessionId, taskAttemptId: o.taskAttemptId, scope: o.scope});
    await o.event?.('next_decision_finish', {coverage});
    return {decision: 'finish', coverage};
   }
   if (seen[direction].has(key)) throw Error('Search made no viewport progress in ' + direction + ' direction');
   seen[direction].add(key);
   const action = scrollAction(p.nextAction, frame, !coverage.topVerified);
   const record = {frameId: frame.id, sourcePngSha256, action, direction, viewportKey: key, status: 'pending'};
   ledger.actions.push(record); writeStateFile(ledgerPath, ledger);
   await o.event?.('next_decision_scroll_reserved', record);
   if (sourceHash(frame, o) !== sourcePngSha256) throw Error('Search source changed before scroll');
   try {await o.device.act(action, frame); record.status = 'observed'; writeStateFile(ledgerPath, ledger);}
   catch (error) {inputUnknown = true; record.status = 'unknown'; writeStateFile(ledgerPath, ledger); throw Error('Search scroll input unknown: ' + String(error));}
   await o.event?.('next_decision_scroll_observed', record);
   continue;
  }
  const t = selectedTask.parse(p.task), plan = planSchema.parse(p.plan);
  if (t.done >= t.total || p.state.balance === null) throw Error('Selected task quota/balance unavailable');
  if (t.category !== 'ordinary-in-app' || ['玩消消乐领金币','养小羊免费赚话费'].includes(t.name) || explicitlySkipped(o, t) || !supportsRoute(o.cfg, t, t.actionType) || t.routeSupported === false) throw Error('Selected task excluded or route unsupported');
  const a: any = p.nextAction;
  if (!a || a.type !== 'tap' || !Array.isArray(a.bounds) || a.bounds.length !== 4 || ![...a.bounds,a.x,a.y].every(Number.isFinite) || a.bounds[0] < 0 || a.bounds[1] < 0 || a.bounds[2] > frame.width || a.bounds[3] > frame.height || a.bounds[0] >= a.bounds[2] || a.bounds[1] >= a.bounds[3] || a.x < a.bounds[0] || a.x > a.bounds[2] || a.y < a.bounds[1] || a.y > a.bounds[3]) throw Error('Selected current button geometry invalid');
  // Same format as round.ts with revision:null: no frame IDs, plan wording or geometry.
  const evidenceKey = JSON.stringify({revision: null, name: t.name, instruction: t.instruction, done: t.done, total: t.total, button: t.button, reward: t.reward, context: t.context});
  const prior = (o.attempts ?? []).find(a => (a.identity ?? taskIdentity(a)) === taskIdentity(t) && (a.status !== 'pending' || samePendingEvidence(a.evidenceKey, evidenceKey)));
  if (prior) throw Error(prior.status === 'pending' ? 'Selected identity pending with same semantic task evidence' : 'Selected identity already attempted or reserved');
  const task = {...t, quota: `${t.done}/${t.total}`, frameId: frame.id, buttonBounds: a.bounds, point: [a.x,a.y], evidenceKey, beforeFrame: {path: frame.path, ocrPath: frame.path.replace(/\.png$/, '.json')}};
  const item: RoundPlanItem = {...task, decision: 'do', times: t.total - t.done, reason: p.reason, actionType: t.actionType, stopConditions: plan.stopConditions, routeSupported: true};
  const record = {version: 'next-decision-v1', sessionId: o.sessionId, taskAttemptId: o.taskAttemptId, scope: o.scope, owner: {package: frame.package, userId: frame.userId}, frameId: frame.id, frame, sourcePngSha256, evidenceKey, task, balanceBefore: p.state.balance, plan, nextAction: a, rawResponse: raw, coverage};
  const evidencePath = stem + '.selection.json'; persist(evidencePath, record);
  const selection: NextTaskSelection = {...record, evidence: {path: evidencePath, sha256: hash(fs.readFileSync(evidencePath))}};
  await o.event?.('next_decision_selected', {item, selection, coverage});
  return {decision: 'task', item, selection, coverage};
  }
 } catch (error) {
  let message = error instanceof Error ? error.message : String(error);
  if (currentStem) {try {persist(currentStem + '.error.json', {error: message, coverage, sessionId: o.sessionId, taskAttemptId: o.taskAttemptId});} catch (failure) {message += '; evidence persistence failed: ' + String(failure);}}
  return {decision: 'stop', coverage, error: message, inputUnknown, blocked};
 }
}
