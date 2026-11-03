// Offline replay: historical pixels/OCR/answers; synthetic clock/transitions, no device/model/ledger I/O.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createStagedRuntime} from '../runner/staged/runtime.ts';
import {AdbOcrDevice} from '../runner/staged/device.ts';
import {verifyAuditFocusedPanel} from '../runner/staged/script-validation.ts';
const history=new URL('../evidence/staged-2026-11-02T07-59-24-733Z/',import.meta.url);
const ids=['b0a8cdb2-4ed1-46b7-a9c7-1b9664315265','df9b929d-c8cf-4a48-a416-c866fdbcdf1d','a8899f1d-5000-476b-be38-007fd5fd2bee'];
const hash=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
function harness(t:any,options:any={}){
 const dir=fs.realpathSync(fs.mkdtempSync(path.join(process.env.TMPDIR!,'inventory-freshness-')));
 const pinned=Object.fromEntries(fs.readdirSync(history).filter(n=>fs.statSync(new URL(n,history)).isFile()).map(n=>[n,hash(fs.readFileSync(new URL(n,history)))]));
 t.after(()=>{for(const [n,sha] of Object.entries(pinned))assert.equal(hash(fs.readFileSync(new URL(n,history))),sha,'historical bytes unchanged: '+n);fs.rmSync(dir,{recursive:true,force:true});});
 const realNow=Date.now;let clock=realNow();Date.now=()=>clock;t.after(()=>{Date.now=realNow;});
 const source=ids.map(id=>{
  const frame=JSON.parse(fs.readFileSync(new URL(id+'.json',history),'utf8'));
  const raw=JSON.parse(fs.readFileSync(new URL(id+'.ocr.json',history),'utf8'));
  const evidence=frame.aiPanelEvidence;
  const answer=JSON.parse(fs.readFileSync(new URL(path.basename(evidence.rawResponse.path),history),'utf8'));
  return {png:fs.readFileSync(new URL(id+'.png',history)),frame,raw,answer};
 });
 let page=options.startPage??0,captures=0,queries=0,actionForeground=false;
 const sent:any[]=[],requests:any[]=[];
 const device=new AdbOcrDevice({serial:'OFFLINE-NO-DEVICE',evidenceDir:dir,frameMaxAgeMs:15000,allowVisualFallback:true,now:()=>clock,exec:async(file,args)=>{
  if(file==='adb'){
   if(args.includes('dumpsys')){
    if(actionForeground){clock+=options.dispatchDelay??0;actionForeground=false;}
    const foreign=options.bad==='foreign'&&captures===2;
    return {stdout:`topResumedActivity=ActivityRecord{x u0 ${foreign?'foreign.app':'com.taobao.taobao'}/.Activity t1}`};
   }
   if(args.includes('screencap')){captures++;return {stdout:source[page].png};}
   if(args.includes('input')){sent.push([...args]);page=Math.min(page+1,2);return {stdout:''};}
   throw Error('Unexpected offline adb operation');
  }
  assert.ok(path.resolve(args[0]).startsWith(dir+path.sep),'OCR output must be scratch-owned');
  const full=args.length===2&&!args[1].includes('.title-');
  if(full){
   let raw=structuredClone(source[page].raw);raw.pages[0].file=args[1];
   if(captures===2){
    if(options.bad==='overlay')raw.pages[0].lines.push({text:'温馨提示',bounds:[300,900,800,1000]});
    if(options.bad==='unknown')raw.pages[0].lines=raw.pages[0].lines.slice(0,2);
    if(options.bad==='continuity')raw.pages[0].lines=raw.pages[0].lines.map((l:any)=>({...l,text:l.text.replace(/（\d+\/\d+）/,'（0/99）')}));
    if(options.bad==='error')throw Error('synthetic OCR failure');
    if(options.bad==='expired')clock+=15001;
   }
   fs.writeFileSync(args[0],JSON.stringify(raw));
  }else fs.writeFileSync(args[0],JSON.stringify({pages:args.slice(1).map(file=>({file,width:1,height:1,lines:[]}))}));
  return {stdout:''};
 }});
 const boundary={capture:async()=>{const f=await device.capture();if(options.bad==='duplicate'&&captures===2)return {...f,id:requests[0].frame.id};return f;},act:async(a:any,f:any)=>{actionForeground=true;return device.act(a,f);}};
 const cfg={package:'com.taobao.taobao',scope:{userId:0},panelMarker:'赚金币抵钱',aiPanelReader:true,panelReadPolicy:'focused-v1',taskObservationPolicy:'current-components-v1',localActivityNavigation:true,navigationPolicy:'current-text-v1',selectionAllowNew:options.selectionAllowNew,taskCompletionPolicy:options.keywordPolicy?'current-keywords-v1':undefined,limits:{agentCalls:10,stageMs:90000,sessionMs:300000,inventoryPages:3}};
 const rt=createStagedRuntime(cfg,boundary,{query:async(r:any)=>{
  requests.push(r);queries++;options.onQuery?.(queries,dir);clock+=(options.delays??[15443])[queries-1]??0;
  if(options.failQuery===queries)throw Error('synthetic model failure');
  return structuredClone(source[page].answer);
 }},{sessionId:'offline-inventory',evidenceDir:dir,plan:[]});
 const now=()=>clock;
 return {dir,rt,sent,requests,now,advance(ms:number){clock+=ms;},inventory:()=>JSON.parse(fs.readFileSync(path.join(dir,'inventory.json'),'utf8')),get captures(){return captures;}};
}
test('slow final inventory page is saved with original capture/read times and no action authority',async t=>{
 const h=harness(t,{delays:[0,0,15443]});const result=await h.rt.stage('collect_list',{});
 assert.equal(result.status,'completed',result.error);const saved=h.inventory();
 assert.equal(saved.complete,true);assert.equal(saved.partial,false);assert.equal(saved.pages.length,3);
 const last=saved.pages.at(-1);assert.equal(last.readCompletedAt-last.capturedAt,15443);assert.equal(last.dataUsable,true);assert.equal(last.actionUsable,false);
 assert.equal(last.frameId,h.requests.at(-1).frame.id);assert.equal(last.capturedAt,h.requests.at(-1).frame.capturedAt);
 assert.equal(last.aiPanelEvidence.rawResponse.sha256,hash(fs.readFileSync(last.aiPanelEvidence.rawResponse.path)));
 assert.equal(h.sent.length,2);
});
test('slow middle page scrolls only on a locally verified fresh frame, without another AI read',async t=>{
 const h=harness(t,{delays:[15443,15443,15443]});const result=await h.rt.stage('collect_list',{});
 assert.equal(result.status,'completed',result.error);assert.equal(h.requests.length,3);assert.equal(h.captures,5);assert.equal(h.sent.length,2);
 const events=fs.readFileSync(path.join(h.dir,'runtime.jsonl'),'utf8').trim().split('\n').map(l=>JSON.parse(l));
 const verified=events.filter(e=>e.kind==='inventory_scroll_revalidated');assert.equal(verified.length,2);
 for(const e of verified){assert.equal(e.authority,'inventory-scroll-only');assert.equal(e.inventoryComplete,false);assert.notEqual(e.sourceFrameId,e.frame.id);assert.equal(e.proposal.frameId,e.frame.id);assert.equal(e.frame.aiPanelEvidence,undefined);assert.equal(e.proposal.action.fromX,Math.round(e.frame.width*.38));assert.equal(e.status,'dispatched');assert.ok(e.continuity.matchedRows>=2);}
 assert.ok(h.inventory().pages.every((p:any)=>!verified.some(e=>e.frame.id===p.frameId)),'action check is not an inventory read');
 const config={package:'com.taobao.taobao',scope:{userId:0},aiPanelReader:true,panelReadPolicy:'focused-v1'};
 for(const e of verified)assert.equal(verifyAuditFocusedPanel({root:h.dir,frame:e.frame,config,stageId:'collect_list',task:null}),null,'local scroll frame must never pass the full panel audit');
 for(const r of h.requests){const saved=JSON.parse(fs.readFileSync(r.frame.path.replace(/\.png$/,'.json'),'utf8'));assert.ok(verifyAuditFocusedPanel({root:h.dir,frame:saved,config,stageId:'collect_list',task:null}),'full reader page retains independent audit acceptance');}
});
for(const bad of ['overlay','unknown','foreign','error','expired','duplicate','continuity'])test(`bad fresh ${bad} frame stops without a gesture and retains the partial inventory`,async t=>{
 const h=harness(t,{bad});const result=await h.rt.stage('collect_list',{});
 assert.equal(result.status,'stopped');assert.equal(h.sent.length,0);assert.equal(h.requests.length,1);assert.equal(h.captures,2);
 const saved=h.inventory();assert.equal(saved.partial,true);assert.equal(saved.complete,false);assert.equal(saved.pages.length,1);assert.ok(saved.reason);assert.equal(saved.pages[0].dataUsable,true);
});
test('model failure after one page preserves prior pages and rejected source evidence',async t=>{
 let durable=false;const h=harness(t,{delays:[0,0],failQuery:2,onQuery:(n:number,dir:string)=>{if(n===2){const saved=JSON.parse(fs.readFileSync(path.join(dir,'inventory.json'),'utf8'));durable=saved.pages.length===1&&saved.partial;}}});
 const result=await h.rt.stage('collect_list',{});assert.equal(result.status,'stopped');assert.equal(durable,true);
 const saved=h.inventory();assert.equal(saved.complete,false);assert.equal(saved.partial,true);assert.equal(saved.pages[0].dataUsable,true);assert.equal(saved.pages[1].dataUsable,false);assert.equal(saved.pages[1].aiPanelEvidence.status,'rejected');assert.equal(h.sent.length,1);
});
test('keyword policy scroll accepts changing task counters without requiring old row text continuity',async t=>{
 const h=harness(t,{bad:'continuity',keywordPolicy:true,delays:[0,0,0]});
 const result=await h.rt.stage('collect_list',{});
 assert.equal(result.status,'completed',result.error);assert.equal(h.sent.length,2);
});

test('15 second action limit is rechecked after asynchronous foreground work by the real device',async t=>{
 const h=harness(t,{delays:[15443],dispatchDelay:15001});const result=await h.rt.stage('collect_list',{});
 assert.equal(result.status,'stopped');assert.match(result.error,/expired before action/);assert.equal(h.sent.length,0);assert.equal(h.inventory().partial,true);
});
test('keyword policy selection accepts slow observation data without renewing action coordinates',async t=>{
 const h=harness(t,{keywordPolicy:true});
 const result=await h.rt.stage('select_task',{});
 assert.notEqual(result.error,'AI panel source frame expired');
 assert.ok(h.sent.length>0,'bounded selection can scroll using fresh panel observation');
});

test('complete inventory with no planned candidate ends selection without another observation or swipe',async t=>{
 const h=harness(t,{keywordPolicy:true,selectionAllowNew:false,delays:[0,0,0]});
 const collected=await h.rt.stage('collect_list',{});assert.equal(collected.status,'completed',collected.error);
 const captures=h.captures,sent=h.sent.length,queries=h.requests.length;
 const selected=await h.rt.stage('select_task',{});
 assert.equal(selected.status,'stopped');assert.equal(selected.error,'No eligible planned task in complete current inventory');
 assert.equal(h.captures,captures);assert.equal(h.sent.length,sent);assert.equal(h.requests.length,queries);
});

test('slow selection still rejects expired evidence instead of inheriting the collection exception',async t=>{
 const h=harness(t);await assert.rejects(()=>h.rt.stage('select_task',{}),/expired/);assert.equal(h.sent.length,0);
});
