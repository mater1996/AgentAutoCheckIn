// Offline normal-factory integration: synthetic stage results; no external I/O.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createRoundAdapters} from '../runner/staged/round-main.ts';
test('normal round factory keeps one runtime from complete collection through settlement and archive',async t=>{
 const root=fs.mkdtempSync(path.join(process.env.TMPDIR!,'round-factory-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 let creates=0;const order:string[]=[];const runtimePlans:any[]=[];
 const adapters=createRoundAdapters({cfg:{scope:{userId:0},package:'app'},round:{id:'round',evidenceDir:root},device:{prepare:async()=>{},cleanup:async()=>({errors:[]}),returnHome:async()=>({confirmed:true})},model:{usage:[]},knowledge:{experienceVersions:[]},scriptFiles:[],saveTask:async(v:any)=>{assert.equal(v.stages.filter((s:any)=>s.stageId==='collect_list').length,1);return {runId:12,v2Archived:true,partial:false,gainCoins:10};},runtimeFactory:(_c:any,_d:any,_m:any,o:any)=>{creates++;runtimePlans.push(o.plan);return {stage:async(id:string,c:any)=>{order.push(id);if(id==='collect_list')fs.writeFileSync(path.join(o.evidenceDir,'inventory.json'),JSON.stringify({complete:true,pages:[{tasks:[{name:'A',instruction:'浏览',done:0,total:1}]}]}));return {status:'completed',...(id==='select_task'?{task:{name:'A',instruction:'浏览',done:0,total:1},balanceBefore:10}:{}),...(id==='task_receipt'?{receipt:{quote:'完成',taskAttemptId:c.taskAttemptId}}:{}),...(id==='settle'?{balanceAfter:20}:{})};}};}});
 await adapters.prepare();const inv=await adapters.collect({attempts:[]});assert.equal(inv.complete,true);
 const result=await adapters.execute({name:'A',instruction:'浏览',decision:'do',times:1},{attempts:[]});
 assert.equal(creates,1);assert.equal(result.gainCoins,10);assert.equal(result.returned,true);assert.equal(result.persistenceVerified,true);assert.equal(runtimePlans[0][0].name,'A');
 assert.deepEqual(order,['open_app','enter_activity','open_list','collect_list','select_task','open_task','task_receipt','return_list','settle','review_task']);
});

test('second task recollects from returned list without relaunch or sleep between tasks',async t=>{
 const root=fs.mkdtempSync(path.join(process.env.TMPDIR!,'round-two-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const order:string[]=[];let number=0,cleanups=0;
 const adapters=createRoundAdapters({cfg:{scope:{userId:0},package:'app'},round:{id:'round',evidenceDir:root},device:{prepare:async()=>{},cleanup:async()=>{cleanups++;return {errors:[]}},returnHome:async()=>({confirmed:true})},model:{usage:[]},knowledge:{},scriptFiles:[],saveTask:async()=>({runId:++number,v2Archived:true,partial:false,gainCoins:10}),runtimeFactory:(_c:any,_d:any,_m:any,o:any)=>({stage:async(id:string,c:any)=>{
  order.push(id);if(id==='collect_list')fs.writeFileSync(path.join(o.evidenceDir,'inventory.json'),JSON.stringify({complete:true,pages:[{tasks:[]}]}));
  return {status:'completed',...(id==='select_task'?{task:{...o.plan[0],done:0,total:1},balanceBefore:10}:{}),...(id==='settle'?{balanceAfter:20}:{})};
 }})});
 await adapters.collect({});await adapters.execute({name:'A',instruction:'浏览'},{});await adapters.collect({});await adapters.execute({name:'B',instruction:'浏览'},{});
 assert.equal(order.filter(s=>s==='open_app').length,1);assert.equal(order.filter(s=>s==='collect_list').length,2);assert.equal(order.filter(s=>s==='return_list').length,2);assert.equal(cleanups,0);
});
