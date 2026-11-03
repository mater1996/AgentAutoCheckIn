import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {readAiPanel,loadAiPanel} from '../runner/staged/ai-panel-reader.ts';

const source=path.resolve('evidence/staged-2026-11-02T00-59-48-815Z');
const responseFile=path.join(source,'ai-panel-63bcf879-8c72-4b07-a2d0-85f42eea82a2.response.json');
const sidecar=JSON.parse(fs.readFileSync(path.join(source,'ai-panel-63bcf879-8c72-4b07-a2d0-85f42eea82a2.json'),'utf8'));
const owner={package:'com.taobao.taobao',userId:0};
function fixture(t:any){
 const dir=fs.mkdtempSync(path.join(process.env.TMPDIR??os.tmpdir(),'panel-extras-'));
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const png=path.join(dir,'frame.png');fs.copyFileSync(path.join(source,sidecar.frameId+'.png'),png);
 return {dir,frame:{id:sidecar.frameId,path:png,width:1080,height:2400,capturedAt:sidecar.capturedAt,...owner}};
}
const original=()=>JSON.parse(fs.readFileSync(responseFile,'utf8'));
async function consume(t:any,raw:any){
 const {dir,frame}=fixture(t);let calls=0;
 const model={query:async()=>{calls++;return raw;}}; // Saved real response replay, no provider request.
 const evidence=await readAiPanel({frame,owner,model,evidenceDir:dir,maxMs:1000});
 assert.equal(calls,1);
 assert.deepEqual(JSON.parse(fs.readFileSync(evidence.rawResponse!.path,'utf8')),raw);
 return {evidence,panel:loadAiPanel({...frame,aiPanelEvidence:evidence})};
}
test('run221 original response ignores surplus reward key without changing recognized values',async t=>{
 const raw=original(),{evidence,panel}=await consume(t,raw);
 assert.equal(evidence.status,'accepted');assert.equal(panel?.balance,2325);
 const actual=panel!.tasks.find(x=>x.name==='拍立淘逛感兴趣的宝贝')!;
 assert.equal(actual.reward,20);assert.equal(actual.rewardOffers[0].rewardMax,null);
 assert.equal(Object.hasOwn(actual.rewardOffers[0],'Max'),false);
});
test('surplus fields cannot substitute required reward values or make invalid data valid',async t=>{
 for(const mutate of [
  (p:any)=>{delete p.tasks[3].rewardOffers[0].rewardMax;},
  (p:any)=>{p.tasks[3].rewardOffers[0].reward=-1;},
  (p:any)=>{p.tasks[3].done=999;},
  (p:any)=>{p.tasks[3].point=[0,0];},
 ]){const raw=original();mutate(raw);const {evidence,panel}=await consume(t,raw);assert.equal(evidence.status,'rejected');assert.equal(panel,null);}
});
