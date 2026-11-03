// Historical pixels/raw OCR; synthetic paths, times, device and model. No live I/O.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createStagedRuntime} from '../runner/staged/runtime.ts';
const source=path.resolve('evidence/staged-2026-11-02T08-59-00-500Z/6c130776-7ec5-4525-ba65-193f524d3cc4.json');
test('already visible real panel hands navigation to collection without a full model read',async t=>{
 const dir=fs.mkdtempSync('/Users/mater/.hermes/cache/scratch/navigation-panel-handoff-');t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const original=JSON.parse(fs.readFileSync(source,'utf8')),png=fs.readFileSync(original.path),ocr=fs.readFileSync(original.path.replace(/\.png$/,'.ocr.json'));
 const pinned=createHash('sha256').update(fs.readFileSync(source)).digest('hex');
 const cfg=JSON.parse(fs.readFileSync('data/evidence/plans/stable-scripts-20261101/ai-flow-optimized-config.json','utf8'));
 let serial=0,calls=0;const actions:any[]=[];
 const rt=createStagedRuntime(cfg,{capture:async()=>{
  const f={...original,id:'synthetic-'+(++serial),path:path.join(dir,serial+'.png'),capturedAt:Date.now()};delete f.aiPanelEvidence;delete f.navigationEvidence;
  const raw=JSON.parse(ocr.toString());raw.pages[0].file=f.path;fs.writeFileSync(f.path,png);fs.writeFileSync(f.path.replace(/\.png$/,'.ocr.json'),JSON.stringify(raw));fs.writeFileSync(f.path.replace(/\.png$/,'.json'),JSON.stringify(f));return f;
 },act:async(a:any)=>{actions.push(a);}},{usage:[],query:async()=>{calls++;throw Error('full panel model must wait for collection');}},{sessionId:'synthetic-handoff',evidenceDir:dir,plan:[]});
 for(const id of ['open_app','enter_activity','open_list']){const r=await rt.stage(id,{});assert.equal(r.status,'completed',id+': '+r.error);}
 assert.equal(calls,0);assert.equal(actions.length,0);
 assert.ok(rt.frames.every((f:any)=>!f.aiPanelEvidence),'navigation frames cannot act as complete inventories');
 assert.equal(createHash('sha256').update(fs.readFileSync(source)).digest('hex'),pinned);
});
