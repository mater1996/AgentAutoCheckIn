import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import path from 'node:path';
import {createRoundAdapters} from '../runner/staged/round-main.ts';

test('a failed return keeps its original runtime for navigation recovery without another entry',async t=>{
 const root=fs.mkdtempSync(path.join(process.env.TMPDIR!,'plugin-return-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 let entries=0,returns=0,archives=0;
 const adapters=createRoundAdapters({cfg:{scope:{userId:0},package:'app'},round:{id:'round',evidenceDir:root},device:{},model:{usage:[]},knowledge:{},scriptFiles:[],skipReview:true,
 saveTask:async()=>{archives++;return {runId:1,v2Archived:true,partial:false,gainCoins:0}},
 runtimeFactory:(_c:any,_d:any,_m:any,o:any)=>({stage:async(id:string)=>{
 if(id==='collect_list')fs.writeFileSync(path.join(o.evidenceDir,'inventory.json'),JSON.stringify({complete:true,pages:[{tasks:[]}]}));
 if(id==='select_task')return {status:'completed',task:{name:'A',instruction:'browse',done:0,total:1},balanceBefore:10};
 if(id==='open_task')entries++;
 if(id==='task_receipt')return {status:'stopped',error:'receipt unknown'};
 if(id==='return_list')return {status:++returns===1?'stopped':'completed',error:returns===1?'ordinary navigation error':undefined};
 return {status:'completed'};
 }})});
 await adapters.collect({});const result=await adapters.execute({name:'A',instruction:'browse'},{});
 assert.equal(result.returned,false);assert.equal(result.persistenceVerified,true);
 const recovery=await adapters.recover();assert.equal(recovery.status,'completed');assert.equal(entries,1);assert.equal(archives,1);
 const final=JSON.parse(fs.readFileSync(path.join(root,'tasks',result.taskAttemptId,'final.json'),'utf8'));
 assert.equal(final.returned,true);assert.equal(final.status,'stopped');assert.equal(final.gainCoins,0);assert.equal(final.recovery.status,'completed');
});
