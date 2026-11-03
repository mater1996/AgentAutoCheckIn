// Replays immutable failed PNG/response; no phone or model requests.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createHash} from 'node:crypto';
import {readNavigation,loadNavigation} from '../runner/staged/navigation-reader.ts';
import {verifyAuditActivityNavigation} from '../runner/staged/script-validation.ts';
const root=path.resolve('evidence/staged-2026-11-02T09-58-07-655Z');
const source=path.join(root,'180ba0fe-ebaa-4d70-8a64-854e3e67ad32.json');
const response=JSON.parse(fs.readFileSync(path.join(root,'navigation-reader-add0fe56-e6ae-4b5b-8bf7-412952a1a243.response.json'),'utf8'));
async function replay(t:any,bounds:number[],duplicate=false){
 const dir=fs.mkdtempSync('/Users/mater/.hermes/cache/scratch/navigation-edge-');t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const original=fs.readFileSync(source),hash=createHash('sha256').update(original).digest('hex');t.after(()=>assert.equal(createHash('sha256').update(fs.readFileSync(source)).digest('hex'),hash));
 const f=JSON.parse(original.toString()),png=fs.readFileSync(f.path),raw=JSON.parse(fs.readFileSync(f.path.replace(/\.png$/,'.ocr.json'),'utf8'));delete f.navigationEvidence;f.path=path.join(dir,'frame.png');f.id='synthetic-edge';f.capturedAt=Date.now();raw.pages[0].file=f.path;
 fs.writeFileSync(f.path,png);fs.writeFileSync(f.path.replace(/\.png$/,'.ocr.json'),JSON.stringify(raw));fs.writeFileSync(f.path.replace(/\.png$/,'.json'),JSON.stringify(f));
 const answer=structuredClone(response);answer.targets[0].bounds=bounds;if(duplicate)answer.targets.push(structuredClone(answer.targets[0]));
 f.navigationEvidence=await readNavigation({frame:f,owner:{package:f.package,userId:f.userId},evidenceDir:dir,maxMs:1000,stageId:'open_list',expectedCheckpoint:'list_visible',model:{query:async()=>answer}});
 fs.writeFileSync(f.path.replace(/\.png$/,'.json'),JSON.stringify(f));return {f,dir};
}
test('actual left-edge landing target is accepted without changing coordinates and independently replayed',async t=>{
 const {f,dir}=await replay(t,response.targets[0].bounds);assert.equal(f.navigationEvidence.status,'accepted');
 const binding={stageId:'open_list',expectedCheckpoint:'list_visible'},owner={package:f.package,userId:f.userId};const proof=loadNavigation(f,owner,binding);assert.equal(proof.state,'landing');assert.deepEqual(proof.action,{type:'tap',x:117,y:958});
 assert.equal((await verifyAuditActivityNavigation({root:dir,frame:f,owner,policy:'current-text-v1',...binding}))?.state,'landing');
});
for(const bounds of [[-1,885,234,1030],[0,885,1081,1030],[0,-1,234,1030],[0,885,234,2401],[234,885,0,1030],[0,885,0,1030]])test('invalid bounds remain rejected '+bounds,async t=>assert.equal((await replay(t,bounds)).f.navigationEvidence.status,'rejected'));
test('duplicate visible targets remain rejected',async t=>assert.equal((await replay(t,[0,885,234,1030],true)).f.navigationEvidence.status,'rejected'));
