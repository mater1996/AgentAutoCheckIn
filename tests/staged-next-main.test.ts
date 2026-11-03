// Offline adapter seam: device/model/store are injected, no live systems.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';
import {createRoundAdapters} from '../runner/staged/round-main.ts';
test('normal next mode hands AI selection to executor without collect_list or select_task scanning',async t=>{
 const dir=fs.mkdtempSync(path.join(process.env.TMPDIR!,'next-main-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const order:string[]=[];let adopted=0;
 const task={name:'A',instruction:'浏览',done:0,total:1},selection={task,balanceBefore:100,frame:{id:'original'}};
 const a=createRoundAdapters({nextDecision:true,nextFinder:async()=>({decision:'task',item:{...task,decision:'do',times:1},selection,coverage:{top:true,bottom:false}}),cfg:{scope:{userId:0}},round:{id:'r',evidenceDir:dir},device:{prepare:async()=>{},cleanup:async()=>{}},model:{usage:[]},knowledge:{},scriptFiles:[],saveTask:async()=>({runId:1,v2Archived:true,partial:false,gainCoins:10}),runtimeFactory:()=>({adoptSelection:()=>{adopted++;return {status:'completed',task,balanceBefore:100}},stage:async(id:string)=>{order.push(id);return {status:'completed',...(id==='settle'?{balanceAfter:110}:{})}}})});
 const n=await a.next!({attempts:[]});assert.equal(n.decision,'task');await a.execute(n.item,{});assert.equal(adopted,1);assert.equal(order.includes('collect_list'),false);assert.equal(order.includes('select_task'),false);assert.equal(order.includes('open_task'),true);
});
