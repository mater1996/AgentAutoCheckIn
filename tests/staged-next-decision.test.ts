// Offline only: original failed run238 PNG; all next-decision answers/geometry are SYNTHETIC fixtures.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import * as next from '../runner/staged/next-decision.ts';
const source = new URL('../evidence/staged-2026-11-02T15-39-45-720Z/c66e1949-186d-42a7-b6c0-d34fcafae128.png', import.meta.url);
const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const cfg = {package: 'com.taobao.taobao', learnedBrowse: {enabled: true, version: 'continuous-browse-candidate-v1', sourceRunId: 153}, aiTaskRecovery: true, aiPanelReader: true, scriptValidationMode: false};
const scope = {appId: 'tb', accountId: 'offline', activityId: 'coins', userId: 0};
const row = {name: '游戏频道独立浏览', instruction: '浏览5秒', done: 0, total: 2, category: 'ordinary-in-app', actionType: 'browse', routeSupported: true, button: '去完成', reward: 20};
const tap = {type: 'tap', x: 940, y: 1100, bounds: [880, 1060, 1020, 1140]};
function answer(extra: any = {}) {return {state: {isList: true, blocked: false, top: true, bottom: false, balance: 2525, viewportKey: 'row A'}, decision: 'select', task: row, plan: {steps: ['打开当前按钮', '观察实际要求后浏览'], stopConditions: ['输入未知', '登录或授权', '返回未验证']}, nextAction: tap, reason: '当前首个允许的独立浏览任务，已有路线', ...extra};}
function harness(t: any, answers: any[] = [answer()], extra: any = {}) {
 const dir = fs.realpathSync(fs.mkdtempSync(path.join(process.env.TMPDIR!, 'next-decision-')));
 const original = fs.readFileSync(source), originalHash = sha(original);
 t.after(() => {assert.equal(sha(fs.readFileSync(source)), originalHash); fs.rmSync(dir, {recursive: true, force: true});});
 const requests: any[] = [], inputs: any[] = []; let captures = 0;
 const options: any = {device: {capture: async () => {const id = 'capture-' + ++captures, file = path.join(dir, id + '.png'); fs.copyFileSync(source, file); return {id, path: file, package: cfg.package, userId: 0, width: original.readUInt32BE(16), height: original.readUInt32BE(20), capturedAt: Date.now(), lines: [{text: '12:34', bounds: [10, 0, 70, 40]}, {text: '当前任务（0/2）', bounds: [40, 700, 500, 760]}]};}, act: async (a: any, f: any) => inputs.push({a, f})}, model: {query: async (r: any) => {requests.push(r); assert.ok(fs.readdirSync(dir).some(f => f.endsWith('.request.json')), 'request persisted before model'); const a = answers.shift(); assert.ok(a, 'unexpected extra model query'); return {frameId: r.frame.id, ...structuredClone(a)};}}, cfg, scope, sessionId: 'session', taskAttemptId: 'attempt', evidenceDir: dir, attempts: [], priorPlans: [{path: 'prior.json', plan: {items: []}}], knowledge: {scripts: [{id: 'learned', code: 'await observe();'}]}, policy: {userSkips: []}, ...extra};
 return {dir, options, requests, inputs, get captures() {return captures;}, originalHash};
}
test('attempt summary preserves unsafe flags and excludes raw historical stages and frame logs',async t=>{
 const h=harness(t);const state=JSON.parse(fs.readFileSync(new URL('../data/evidence/round-integration-20261103/state.json',import.meta.url),'utf8'));h.options.attempts=structuredClone(state.attempts);
 const before=JSON.stringify(h.options.attempts);const sent=next.summarizeAttempts(h.options.attempts);assert.equal(sent.length,state.attempts.length);
 for(let i=0;i<sent.length;i++){
  const old=state.attempts[i],now=sent[i];for(const k of ['identity','name','instruction','reservationId','status','evidenceKey'])assert.deepEqual(now[k],old[k]);
  if(old.result){for(const k of ['status','runId','taskAttemptId','entryDispatched','inputUnknown','blocked','returned','persistenceVerified','gainCoins','balanceBefore','balanceAfter','error'])assert.deepEqual(now.result[k],old.result[k]);assert.equal(now.result.stages,undefined);assert.equal(now.result.reviews,undefined);assert.equal(now.result.task?.beforeFrame,undefined);}
 }
 assert.equal(JSON.stringify(h.options.attempts),before,'full source history unchanged');
 assert.ok(Buffer.byteLength(JSON.stringify(sent))<Buffer.byteLength(before)/10,'actual archive fixture materially reduced without dropping attempts');
});
const unresolvedAttempt=(a:any)=>a.status==='reserved'||a.result?.inputUnknown||a.result?.blocked||a.result&&(a.result.returned===false||a.result.persistenceVerified===false);
test('selection query includes eligible archive attempt summaries without raw historical stages',async t=>{
 const h=harness(t),state=JSON.parse(fs.readFileSync(new URL('../data/evidence/round-integration-20261103/state.json',import.meta.url),'utf8'));
 h.options.attempts=structuredClone(state.attempts.filter((a:any)=>!unresolvedAttempt(a)));assert.ok(h.options.attempts.length>0);
 const before=JSON.stringify(h.options.attempts),result=await next.findNextTask(h.options);
 assert.equal(result.decision,'task',result.error);assert.equal(h.requests.length,1);
 assert.deepEqual(h.requests[0].context.attempts,next.summarizeAttempts(h.options.attempts));
 assert.equal(h.requests[0].context.attempts.length,h.options.attempts.length);
 assert.equal(JSON.stringify(h.options.attempts),before);
 assert.ok(Buffer.byteLength(JSON.stringify(h.requests[0].context.attempts))<Buffer.byteLength(before)/10);
});
test('unsafe archive attempts stop the query before capture and retain their summary flags',async t=>{
 const state=JSON.parse(fs.readFileSync(new URL('../data/evidence/round-integration-20261103/state.json',import.meta.url),'utf8'));
 const unsafe=state.attempts.filter(unresolvedAttempt);assert.ok(unsafe.length>0);
 const h=harness(t,[answer()],{attempts:structuredClone(unsafe)}),result=await next.findNextTask(h.options);
 assert.equal(result.decision,'stop');assert.match(result.error!,/Prior attempt/);assert.equal(h.captures,0);assert.equal(h.requests.length,0);assert.equal(h.inputs.length,0);
 const sent=next.summarizeAttempts(unsafe);for(let i=0;i<unsafe.length;i++)for(const key of ['inputUnknown','blocked','returned','persistenceVerified'])assert.deepEqual(sent[i].result?.[key],unsafe[i].result?.[key]);
});
test('one query selects first visible candidate with plan/current button and original evidence, without tapping or full inventory', async t => {
 const h = harness(t), result = await next.findNextTask(h.options);
 assert.equal(result.decision, 'task', result.error ?? 'unexpected decision'); assert.equal(h.requests.length, 1); assert.equal(h.captures, 1); assert.equal(h.inputs.length, 0);
 assert.deepEqual(h.requests[0].context.knowledge, h.options.knowledge); assert.deepEqual(h.requests[0].context.priorPlans, h.options.priorPlans);
 assert.deepEqual(h.requests[0].context.cfg, cfg); assert.deepEqual(h.requests[0].context.policy, h.options.policy);
 assert.equal(result.item?.times, 2); assert.equal(result.item?.decision, 'do');
 assert.equal(result.selection?.task.beforeFrame.path, result.selection?.frame.path); assert.equal(result.selection?.balanceBefore, 2525);
 assert.equal(result.selection?.frame.id, 'capture-1'); assert.deepEqual(result.selection?.nextAction, tap); assert.deepEqual(result.selection?.plan.steps, answer().plan.steps);
 assert.equal(result.selection?.sourcePngSha256, h.originalHash); assert.equal(result.coverage.topVerified, true); assert.equal(result.coverage.complete, false);
 const evidence = JSON.parse(fs.readFileSync(result.selection!.evidence.path, 'utf8'));
 assert.equal(evidence.sourcePngSha256, h.originalHash); assert.equal(evidence.rawResponse.frameId, 'capture-1'); assert.deepEqual(evidence.nextAction, tap);
});
const swipe = (seekTop = false) => ({type: 'swipe', fromX: 400, fromY: seekTop ? 800 : 1800, toX: 400, toY: seekTop ? 1800 : 800, ms: 600});
const page = (key: string, extra: any = {}) => ({isList: true, blocked: false, top: false, bottom: false, balance: 2525, viewportKey: key, ...extra});
const scroll = (key: string, state: any = {}, seekTop = false) => answer({state: page(key, state), decision: 'scroll', task: null, plan: null, nextAction: swipe(seekTop)});
test('starts at bottom, seeks verified top before selecting and stops immediately at first eligible page', async t => {
 const h = harness(t, [answer({state: page('bottom', {bottom: true})}), scroll('top', {top: true}), answer({state: page('middle')} )]);
 const result = await next.findNextTask(h.options);
 assert.equal(result.decision, 'task', result.error ?? 'unexpected decision'); assert.equal(h.requests.length, 3); assert.equal(h.inputs.length, 2);
 assert.ok(h.inputs[0].a.fromY < h.inputs[0].a.toY, 'seek top'); assert.ok(h.inputs[1].a.fromY > h.inputs[1].a.toY, 'scan down');
 assert.equal(result.selection?.frame.id, 'capture-3'); assert.equal(result.coverage.topVerified, true); assert.equal(result.coverage.complete, false);
 assert.equal(h.requests[1].context.history[0].status, 'observed');
});
test('finish requests cannot end early and require current search top-to-bottom coverage', async t => {
 const finish = (key: string, state: any = {}) => answer({state: page(key, state), decision: 'finish', task: null, plan: null, nextAction: null});
 const h = harness(t, [finish('initial-bottom', {bottom: true}), finish('top', {top: true}), finish('middle'), finish('last', {bottom: true})]);
 const result = await next.findNextTask(h.options);
 assert.equal(result.decision, 'finish', result.error ?? 'unexpected decision'); assert.equal(h.inputs.length, 3); assert.equal(result.coverage.complete, true); assert.equal(result.coverage.bottomVerified, true);
 assert.equal(result.coverage.pages.length, 4);
});
test('scroll intent is durable before dispatch and unknown input forbids replay after reconstruction', async t => {
 const h = harness(t, [scroll('top', {top: true})]); let sent = 0;
 h.options.device.act = async () => {sent++; const file = fs.readdirSync(h.dir).find(f => f.endsWith('.inputs.json'))!; const ledger = JSON.parse(fs.readFileSync(path.join(h.dir, file), 'utf8')); assert.equal(ledger.actions.at(-1).status, 'pending'); throw Error('synthetic transport timeout');};
 const first = await next.findNextTask(h.options); assert.equal(first.decision, 'stop'); assert.match(first.error!, /unknown/i);
 const second = await next.findNextTask({...h.options}); assert.equal(second.decision, 'stop'); assert.match(second.error!, /unknown|unresolved/i); assert.equal(sent, 1); assert.equal(h.captures, 1); assert.equal(h.requests.length, 1);
});
test('unchanged viewport semantics stop per direction despite new capture IDs', async t => {
 const h = harness(t, [scroll('same', {top: true}), scroll('same', {top: true})]);
 const result = await next.findNextTask(h.options); assert.equal(result.decision, 'stop'); assert.match(result.error ?? 'unexpected decision', /progress/i); assert.equal(h.inputs.length, 1); assert.equal(h.requests.length, 2);
});

test('fresh searches after task return re-read current geometry and ignore bad unselected bbox', async t => {
 const h = harness(t, [answer({unselectedRows: [{bounds: [-100,0,-20,0]}]}), answer({nextAction: {...tap, y: 1400, bounds: [880,1360,1020,1440]}})]);
 const a = await next.findNextTask(h.options), b = await next.findNextTask({...h.options, taskAttemptId: 'after-return'});
 assert.equal(a.decision, 'task'); assert.equal(b.decision, 'task'); assert.equal(b.selection?.nextAction.y, 1400); assert.notEqual(a.selection?.frame.id, b.selection?.frame.id); assert.equal(a.selection?.evidenceKey, b.selection?.evidenceKey, 'fresh geometry/frame must not change pending evidence');
});

test('consumed/reserved identities and same-evidence pending selection cannot be reauthorized', async t => {
 for (const status of ['consumed','reserved','pending']) {
  const h = harness(t, [answer()]);
  const first = await next.findNextTask(h.options); assert.equal(first.decision, 'task');
  h.options.attempts = [{identity: JSON.stringify([row.name,row.instruction]), name: row.name, instruction: row.instruction, reservationId: 'prior', status, evidenceKey: first.selection!.evidenceKey}];
  h.options.model.query = async (r: any) => ({frameId: r.frame.id, ...answer()});
  const result = await next.findNextTask({...h.options, taskAttemptId: status});
  assert.equal(result.decision, 'stop', status); assert.match(result.error ?? 'unexpected decision', /already|reserved|pending|attempt/i); assert.equal(h.inputs.length, 0);
 }
});

test('legacy round pending semantic evidence remains binding and changed own quota supplies new evidence', async t => {
 const h = harness(t, [answer()]);
 h.options.attempts = [{identity: JSON.stringify([row.name,row.instruction]), name: row.name, instruction: row.instruction, reservationId: 'pending', status: 'pending', evidenceKey: JSON.stringify({revision:null,name:row.name,instruction:row.instruction,done:row.done,total:row.total,button:row.button,reward:row.reward})}];
 const same = await next.findNextTask(h.options); assert.equal(same.decision, 'stop'); assert.match(same.error!, /pending/i);
 h.options.model.query = async (r: any) => ({frameId:r.frame.id,...answer({task:{...row,done:1}})});
 const changed = await next.findNextTask({...h.options,taskAttemptId:'changed'}); assert.equal(changed.decision, 'task', changed.error ?? 'unexpected decision'); assert.equal(changed.item?.times, 1);
});

test('prior unknown input/block/reservation stops before capture and model', async t => {
 for (const attempts of [[{status:'reserved'}], [{status:'consumed',result:{inputUnknown:true}}], [{status:'consumed',result:{blocked:true}}]]) {
  const h = harness(t, [answer()], {attempts}); const result = await next.findNextTask(h.options);
  assert.equal(result.decision, 'stop'); assert.equal(h.captures, 0); assert.equal(h.requests.length, 0); assert.equal(h.inputs.length, 0);
 }
});
for (const [name, change] of Object.entries({
 'frame mismatch': {frameId:'other'}, 'unknown current input': {state:page('top',{top:true,inputUnknown:true})}, 'blocked login': {state:page('blocked',{top:true,blocked:true})}, 'foreign list': {state:page('other',{isList:false})},
 'complete quota': {task:{...row,done:2}}, 'invalid quota': {task:{...row,done:3}}, 'unsupported actual action': {task:{...row,actionType:'invented'}}, 'exact skip': {task:{...row,name:'玩消消乐领金币'}},
 'actual game': {task:{...row,category:'game'}}, 'invite': {task:{...row,category:'invite'}}, 'spending': {task:{...row,category:'spending'}},
 'unknown requirement': {task:{...row,category:'unknown'}}, 'missing button': {nextAction:null}, 'bad chosen bbox': {nextAction:{...tap,bounds:[-1,0,10,1]}},
 'unknown balance': {state:page('top',{top:true,balance:null})}, 'no stop conditions': {plan:{steps:['browse'],stopConditions:[]}},
 'unknown decision': {decision:'guess'}, 'model stop': {decision:'stop',task:null,plan:null,nextAction:null},
})) test(`rejects ${name} before any input`, async t => {
 const h = harness(t, [answer(change)]), r = await next.findNextTask(h.options); assert.equal(r.decision,'stop',name); assert.ok(r.error); assert.equal(h.inputs.length,0);
});

test('explicit skips and route ownership override model; excludes no tasks by title keywords', async t => {
 for (const extra of [{policy:{userSkips:[row.name]}}, {cfg:{...cfg,round:{exactSkips:[row.name]}}}, {priorPlans:[{path:'prior',plan:{items:[{...row,userSkip:true}]}}]}, {cfg:{...cfg,interactionRoutes:[{type:'quiz',task:row}]}}]) {
  const h = harness(t,[answer()],extra), r=await next.findNextTask(h.options); assert.equal(r.decision,'stop'); assert.equal(h.inputs.length,0);
 }
});

test('semantic OCR fallback ignores status clock and capture IDs when model key is absent', async t => {
 const a=scroll('same',{top:true}), b=scroll('same',{top:true}); delete a.state.viewportKey; delete b.state.viewportKey;
 const h=harness(t,[a,b]); const original=h.options.device.capture;
 h.options.device.capture=async()=>{const f=await original();f.lines[0].text=f.id==='capture-1'?'12:34':'12:35';return f;};
 const r=await next.findNextTask(h.options);assert.equal(r.decision,'stop');assert.match(r.error!,/progress/);assert.equal(h.inputs.length,1);
});

test('query/source errors persist evidence without dispatch', async t => {
 const h=harness(t); h.options.model.query=async()=>{throw Error('synthetic model unavailable');};
 const r=await next.findNextTask(h.options);assert.equal(r.decision,'stop');assert.equal(h.inputs.length,0);
 assert.ok(fs.readdirSync(h.dir).some(f=>f.endsWith('.error.json')));
});
test('unknown scroll is exposed separately from task attempts', async t => {
 const h=harness(t,[scroll('top',{top:true})]); h.options.device.act=async()=>{throw Error('timeout');};
 const r=await next.findNextTask(h.options);assert.equal(r.decision,'stop');assert.equal(r.inputUnknown,true);assert.equal(h.options.attempts.length,0);
});
test('top and bottom flags participate in progress even when task-row semantics repeat', async t => {
 const finish=answer({state:page('same',{bottom:true}),decision:'finish',task:null,plan:null,nextAction:null});
 const h=harness(t,[scroll('same',{},true),scroll('same',{top:true}),finish]);
 const r=await next.findNextTask(h.options);assert.equal(r.decision,'finish',r.error ?? 'unexpected decision');assert.equal(r.coverage.top,true);assert.equal(r.coverage.bottom,true);assert.equal(h.inputs.length,2);
});
test('unknown response action cannot be replaced by a scroll', async t => {
 const h=harness(t,[scroll('top',{top:true})]);const query=h.options.model.query;h.options.model.query=async(r:any)=>({...await query(r),nextAction:{type:'launch',package:'other'}});
 const r=await next.findNextTask(h.options);assert.equal(r.decision,'stop');assert.equal(h.inputs.length,0);
});
test('selection from original failed PNG is accepted by existing runtime adoption offline',async t=>{
 const {createStagedRuntime}=await import('../runner/staged/runtime.ts');
 const h=harness(t);const capture=h.options.device.capture;
 h.options.device.capture=async()=>{const f=await capture();fs.writeFileSync(f.path.replace(/\.png$/,'.json'),JSON.stringify(f));return f;};
 const r=await next.findNextTask(h.options);assert.equal(r.decision,'task');
 const rt=createStagedRuntime({...cfg,scope,limits:{stageMs:60000},executionPolicy:'development-unbounded-v1'},h.options.device,h.options.model,{sessionId:'session',evidenceDir:h.dir,plan:[]});
 const adopted=rt.adoptSelection(r.selection,{taskAttemptId:'attempt',sessionId:'session'});
 assert.equal(adopted.status,'completed',adopted.error ?? 'adoption failed');assert.equal(h.inputs.length,0);
});
test('learned script source is code-readable in the same query and no arbitrary page/model cap ends search',async t=>{
 const h=harness(t);const script=path.join(h.dir,'learned.ts');fs.writeFileSync(script,'export const step = () => "observe";');
 h.options.knowledge={scriptVersions:[{id:'saved-script',path:script,sha256:sha(fs.readFileSync(script))}]};
 const answers=[...Array.from({length:19},(_,i)=>scroll('page-'+i,{top:i===0})),answer({state:page('chosen')})];
 h.options.model.query=async(r:any)=>{h.requests.push(r);assert.equal(r.context.learnedScripts[0].code,fs.readFileSync(script,'utf8'));return {frameId:r.frame.id,...answers.shift()};};
 const r=await next.findNextTask(h.options);assert.equal(r.decision,'task',r.error??'failed');assert.equal(h.inputs.length,19);assert.equal(h.requests.length,20);
});
test('model cannot change original PNG bytes during a query',async t=>{
 const h=harness(t);h.options.model.query=async(r:any)=>{fs.appendFileSync(r.frame.path,'changed');return {frameId:r.frame.id,...answer()};};
 const r=await next.findNextTask(h.options);assert.equal(r.decision,'stop');assert.match(r.error!,/source/);assert.equal(h.inputs.length,0);
});
test('foreign capture owner is rejected before querying',async t=>{
 const h=harness(t);const capture=h.options.device.capture;h.options.device.capture=async()=>({...await capture(),userId:10});
 const r=await next.findNextTask(h.options);assert.equal(r.decision,'stop');assert.equal(h.requests.length,0);assert.equal(h.inputs.length,0);
});
test('same pending task cannot retry after unrelated model context or plan changes',async t=>{
 const h=harness(t,[answer()]);const a=await next.findNextTask(h.options);assert.equal(a.decision,'task');
 h.options.attempts=[{identity:JSON.stringify([row.name,row.instruction]),name:row.name,instruction:row.instruction,reservationId:'old',status:'pending',evidenceKey:JSON.stringify({revision:a.item!.evidenceKey,name:row.name,instruction:row.instruction,done:0,total:2,button:row.button,reward:20,context:{frameId:'old'}})}];
 h.options.model.query=async(r:any)=>({frameId:r.frame.id,...answer({task:{...row,context:{frameId:'random-new-id'}},plan:{steps:['different wording'],stopConditions:['stop']}})});
 const b=await next.findNextTask({...h.options,taskAttemptId:'new'});assert.equal(b.decision,'stop');assert.match(b.error!,/pending/);
});
