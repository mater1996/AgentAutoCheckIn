// Read-only offline audit of a retained, explicitly synthetic runtime trace.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {verifyAuditFocusedPanel,verifyAuditTaskComponent} from '../runner/staged/script-validation.ts';
const file=process.argv[2];
assert.ok(file&&path.isAbsolute(file),'Pass absolute synthetic manifest path');
const m=JSON.parse(fs.readFileSync(file,'utf8')),root=path.dirname(file);
assert.equal(m.synthetic,true);
assert.equal(m.config.taskObservationPolicy,'current-components-v1');
const cfg=m.config,task=m.timeline.find((x:any)=>x.stageId==='select_task').result.task;
const base={root,config:cfg,task};
const capture=(id:string)=>m.frames.find((f:any)=>f.id===id);
const opening=m.timeline.find((x:any)=>x.stageId==='open_task').result;
const receipt=m.timeline.find((x:any)=>x.stageId==='task_receipt').result;
const settlement=m.timeline.find((x:any)=>x.stageId==='settle').result;
assert.equal(settlement.status,'completed');
const entryFrame=capture(opening.actions.find((x:any)=>x.proposal.action.type==='tap').proposal.frameId);
assert.ok(verifyAuditFocusedPanel({...base,frame:entryFrame,stageId:'open_task'}));
const browsing=opening.events.filter((e:any)=>e.type==='observed').at(-1).frame;
assert.equal((await verifyAuditTaskComponent({...base,frame:browsing,stageId:'open_task'}))?.inspection.state,'browsing');
const done=capture(receipt.receipt.frameId);
const checked=await verifyAuditTaskComponent({...base,frame:done,stageId:'task_receipt'});
assert.equal(checked?.inspection.state,'completed');
assert.equal(checked?.inspection.quote,receipt.receipt.quote);
let focused=0;
const returned=m.timeline.find((x:any)=>x.stageId==='return_list').result;
for(const e of returned.events.filter((e:any)=>e.type==='observed')){
 const p=verifyAuditFocusedPanel({...base,frame:e.frame,stageId:'return_list'});
 if(p){assert.equal(p.readPurpose,'return-status');focused++;}
}
const samples=settlement.review.samples;
assert.equal(samples.length,2);assert.notEqual(samples[0].frameId,samples[1].frameId);
let previous=done.capturedAt;
for(const s of samples){const f=capture(s.frameId);assert.ok(f.capturedAt>previous);previous=f.capturedAt;
 const p=verifyAuditFocusedPanel({...base,frame:f,stageId:'settle'});assert.ok(p);assert.equal(p.balance,1730);assert.equal(p.readPurpose,'settlement');focused++;
 assert.equal(verifyAuditFocusedPanel({...base,frame:f,stageId:'open_task'}),null);
 assert.equal(verifyAuditFocusedPanel({...base,frame:f,stageId:'settle',task:{...task,total:task.total+1}}),null);
}
assert.equal(verifyAuditTaskComponent instanceof Function,true);
assert.equal(await verifyAuditTaskComponent({...base,frame:{...done,userId:999},stageId:'task_receipt'}),null);
console.log(JSON.stringify({synthetic:true,task:task.name,entryVerified:true,browsingVerified:true,receiptVerified:true,focusedVerified:focused,settlementDistinctAfterReceipt:true,wrongPurposeTaskOwnerRejected:true,ledgerWritten:false},null,2));
