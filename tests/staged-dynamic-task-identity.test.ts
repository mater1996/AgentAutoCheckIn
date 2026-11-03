import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {readPanel,bindTask} from '../runner/staged/observations.ts';
const root=path.resolve(import.meta.dirname,'..');
const dir=path.join(root,'evidence/staged-2026-11-01T08-26-22-002Z');
const frame=(id:string)=>JSON.parse(fs.readFileSync(path.join(dir,id+'.json'),'utf8'));
test('run170 original frames preserve changed task labels rather than aliasing the returned row',()=>{
 const before=frame('a09f922c-9109-41a6-9bfc-a1d878689f13'),returned=frame('109ab2f8-3583-40c0-93dd-b165d3acdde1');
 for(const f of [before,returned]){
  const raw=JSON.parse(fs.readFileSync(f.path.replace('.png','.ocr.json'),'utf8'));
  assert.equal(raw.pages[0].file,f.path);
  assert.deepEqual(raw.pages[0].lines.map(({text,bounds}:any)=>({text,bounds})),f.lines);
 }
 const selected=readPanel(before).tasks[0],after=readPanel(returned).tasks[0];
 assert.deepEqual([selected.name,selected.done,selected.total,selected.reward,selected.point],['发现精选好物',1,3,20,[942,644]]);
 assert.deepEqual([after.name,after.done,after.total,after.reward,after.point],['看看#精致面霜',2,3,50,[942,644]]);
 assert.equal(bindTask(before,selected)?.name,selected.name);
 assert.equal(bindTask(returned,{...selected,frameId:undefined}),null,'same position and incrementing quota must not create task equivalence');
 const stages=JSON.parse(fs.readFileSync(path.join(dir,'stages.json'),'utf8'));
 const taps=stages.find((s:any)=>s.stageId==='open_task').actions.filter((a:any)=>a.proposal.action.type==='tap');
 assert.equal(taps.length,1);assert.equal(taps[0].proposal.frameId,before.id);
 assert.deepEqual(taps[0].proposal.action,{type:'tap',x:942,y:644});
 const result=JSON.parse(fs.readFileSync(path.join(dir,'result.json'),'utf8'));
 assert.equal(result.status,'unknown');assert.equal(result.receipt,null);assert.equal(result.gainCoins,null);
});
