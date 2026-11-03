// Real stationary old/fresh pair with a 64px list shift; synthetic runtime/device transitions.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createStagedRuntime} from '../runner/staged/runtime.ts';
const history=path.resolve('evidence/staged-2026-11-02T09-07-41-575Z');
const ids=['a9f133d3-d75a-4837-8419-a7689a9e7f57','5760fecb-9fdb-46bb-b042-0a3de635d72f'];
for(const changed of [false,true])test('real shifted list '+(changed?'rejects changed quotas':'relocates multiple matching row components'),async t=>{
 const dir=fs.mkdtempSync('/Users/mater/.hermes/cache/scratch/shifted-inventory-');t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));let serial=0,calls=0;const sent:any[]=[];
 const original=JSON.parse(fs.readFileSync(path.join(history,ids[0]+'.json'),'utf8'));
 const answer=JSON.parse(fs.readFileSync(original.aiPanelEvidence.rawResponse.path,'utf8'));
 const cfg=JSON.parse(fs.readFileSync('data/evidence/plans/stable-scripts-20261101/ai-flow-optimized-config.json','utf8'));
 const rt=createStagedRuntime(cfg,{capture:async()=>{
  const id=ids[serial===0?0:1],f=JSON.parse(fs.readFileSync(path.join(history,id+'.json'),'utf8')),png=fs.readFileSync(f.path),raw=JSON.parse(fs.readFileSync(f.path.replace(/\.png$/,'.ocr.json'),'utf8'));delete f.aiPanelEvidence;
  f.id='synthetic-'+(++serial);f.path=path.join(dir,f.id+'.png');f.capturedAt=Date.now();raw.pages[0].file=f.path;
  if(changed&&serial===2){const change=(ls:any[])=>ls.map(l=>({...l,text:l.text.replace(/（\d+\/\d+）/g,'（0/99）')}));f.lines=change(f.lines);raw.pages[0].lines=change(raw.pages[0].lines);}
  fs.writeFileSync(f.path,png);fs.writeFileSync(f.path.replace(/\.png$/,'.ocr.json'),JSON.stringify(raw));fs.writeFileSync(f.path.replace(/\.png$/,'.json'),JSON.stringify(f));return f;
 },act:async(a:any,f:any)=>sent.push({a,frameId:f.id})},{query:async()=>{if(++calls>1)throw Error('synthetic stop after gesture');return answer;}},{sessionId:'shifted-offline',evidenceDir:dir,plan:[]});
 const r=await rt.stage('collect_list',{});assert.equal(r.status,'stopped');assert.equal(sent.length,changed?0:1,r.error);
 const es=fs.readFileSync(path.join(dir,'runtime.jsonl'),'utf8').trim().split('\n').map(l=>JSON.parse(l));
 if(!changed){const e=es.find(e=>e.kind==='inventory_scroll_revalidated');assert.ok(e.continuity.matchedRows>=2);assert.ok(e.continuity.offsetY>60&&e.continuity.offsetY<68);assert.notEqual(e.sourceFrameId,e.frame.id);}
});
