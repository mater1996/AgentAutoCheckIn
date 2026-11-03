// Synthetic offline pages; the real runtime and AdbOcrDevice use injected exec only.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {AdbOcrDevice} from '../runner/staged/device.ts';
import {createStagedRuntime} from '../runner/staged/runtime.ts';
const owner={package:'test.app',userId:0};
const row=(name:string,instruction='Browse 5 seconds')=>({name,instruction});
function harness(t:any,pages:any[],options:any={}){
 const dir=fs.mkdtempSync(path.join(process.env.TMPDIR!,'round-selection-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 let index=options.start??0;const actions:any[]=[];
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64');png.writeUInt32BE(1080,16);png.writeUInt32BE(2400,20);
 const device=new AdbOcrDevice({serial:'OFFLINE',evidenceDir:dir,exec:async(file,args)=>{
  if(file==='adb'){
   assert.deepEqual(args.slice(0,2),['-s','OFFLINE']);
   if(args.includes('activities'))return {stdout:`topResumedActivity=ActivityRecord{x u0 ${owner.package}/.Main}`};
   if(args.includes('screencap'))return {stdout:png};
   if(args.includes('swipe')){if(actions.length>10)throw Error('Offline runaway sentinel');const a=args.slice(args.indexOf('swipe')+1);const down=Number(a[3])<Number(a[1]);actions.push({down,index});index=options.stuck?index:Math.max(0,Math.min(pages.length-1,index+(down?1:-1)));return {stdout:''};}
   throw Error('Unexpected offline adb command '+args.join(' '));
  }
  const p=pages[index],line=(text:string,bounds:number[])=>({text,bounds});
  const lines=[line('Tasks',[200,400,600,450]),line('100',[10,210,120,260]),...(p.top?[line('完成进度 0/9',[200,500,600,550])]:[]),...(p.bottom?[line('以上奖励均为最高奖励',[200,2200,900,2250])]:[])];
  for(const [i,r] of p.rows.entries()){const y=700+i*250;lines.push(line(`${r.name}(0/1)`,[230,y,650,y+50]),line(r.instruction,[230,y+55,700,y+90]),line('去完成',[850,y,1000,y+50]));}
  fs.writeFileSync(args[0],JSON.stringify({pages:[{file:args[1],width:1080,height:2400,lines}]}));return {stdout:''};
 }});
 const cfg={package:owner.package,scope:{userId:0},panelMarker:'Tasks',selectionAllowNew:false,executionPolicy:options.unbounded?'development-unbounded-v1':undefined,limits:{stageMs:10000,sessionMs:60000,inventoryPages:options.inventoryPages??10,agentCalls:0}};
 if(options.omitInventoryPages)delete (cfg.limits as any).inventoryPages;
 const rt=createStagedRuntime(cfg,device,{query:async()=>{throw Error('Model forbidden in offline selection');}},{evidenceDir:dir,plan:options.plan??pages.flatMap(p=>p.rows.map((r:any)=>({...r,decision:'do'})))});
 return {rt,actions,dir,get index(){return index}};
}
test('selection returns from collected bottom to verified top before selecting first planned row',async t=>{
 const h=harness(t,[{top:true,rows:[row('First')]},{rows:[row('Middle')]},{bottom:true,rows:[row('Last')]}]);
 assert.equal((await h.rt.stage('collect_list',{})).status,'completed');assert.equal(h.index,2);
 const selected=await h.rt.stage('select_task',{});assert.equal(selected.status,'completed',selected.error);assert.equal(selected.task.name,'First');
 assert.deepEqual(h.actions.map(a=>a.down),[true,true,false,false]);
});
for(const stage of ['collect_list','select_task'])for(const phase of ['top-search','scan'])test(`${stage} stops unbounded ${phase} on unchanged viewport with partial inventory`,async t=>{
 const h=harness(t,[{top:phase==='scan',rows:[row('Unplanned')]}],{stuck:true,unbounded:true,plan:[]});
 const result=await h.rt.stage(stage,{});assert.equal(result.status,'stopped');assert.match(result.error,/no.*progress/i);assert.equal(h.actions.length,1);
 if(stage==='collect_list'){const saved=JSON.parse(fs.readFileSync(path.join(h.dir,'inventory.json'),'utf8'));assert.equal(saved.complete,false);assert.equal(saved.partial,true);assert.equal(saved.bottom,false);assert.ok(saved.topSearchPages.length>0);}
});
test('selection scans down from top past same-name wrong-instruction rows',async t=>{
 const wanted=row('Target','Exact instruction'),h=harness(t,[{top:true,rows:[row('Target','Wrong instruction')]},{rows:[wanted]},{bottom:true,rows:[row('Other')]}],{start:2,plan:[{...wanted,decision:'do'}]});
 const result=await h.rt.stage('select_task',{});assert.equal(result.status,'completed',result.error);assert.equal(result.task.instruction,wanted.instruction);assert.deepEqual(h.actions.map(a=>a.down),[false,false,true]);
});
test('partial inventory does not trigger complete-inventory no-candidate shortcut',async t=>{
 const wanted=row('Later'),h=harness(t,[{top:true,rows:[row('Unplanned')]},{bottom:true,rows:[wanted]}],{inventoryPages:1,plan:[{...wanted,decision:'do'}]});
 assert.equal((await h.rt.stage('collect_list',{})).status,'stopped');const result=await h.rt.stage('select_task',{});assert.equal(result.status,'stopped');assert.doesNotMatch(result.error,/complete current inventory/);
});
test('selection retains four-page default when inventoryPages is absent',async t=>{
 const h=harness(t,[{top:true,bottom:true,rows:[row('First')]}],{omitInventoryPages:true});assert.equal((await h.rt.stage('select_task',{})).task.name,'First');
});
for(const stage of ['collect_list','select_task'])test(`${stage} unbounded top search reaches a verified top beyond three gestures`,async t=>{
 const h=harness(t,Array.from({length:6},(_,i)=>({top:i===0,bottom:i===5,rows:[row('Page '+i)]})),{start:5,unbounded:true});assert.equal((await h.rt.stage(stage,{})).status,'completed');assert.ok(h.actions.length>=5);
});
test('complete inventory with no candidate stops semantically without more scrolling',async t=>{
 const h=harness(t,[{top:true,rows:[row('First')]},{bottom:true,rows:[row('Last')]}],{plan:[]});assert.equal((await h.rt.stage('collect_list',{})).status,'completed');const before=h.actions.length;
 const result=await h.rt.stage('select_task',{});assert.equal(result.error,'No eligible planned task in complete current inventory');assert.equal(h.actions.length,before);
});
