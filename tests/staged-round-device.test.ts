// Synthetic Android command fixtures only. No live adb, network, model or DB.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {AdbOcrDevice} from '../runner/staged/device.ts';
const owner={package:'test.app',userId:10};
function harness(t:any,options:any={}){
 const dir=fs.mkdtempSync(path.join(process.env.TMPDIR!,'round-device-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const calls:string[][]=[];
 const device=new AdbOcrDevice({serial:'OFFLINE',evidenceDir:dir,exec:async(file,args)=>{
  assert.equal(file,'adb');assert.deepEqual(args.slice(0,2),['-s','OFFLINE']);calls.push(args);
  if(args.includes('resolve-activity'))return {stdout:options.resolve??'priority=0\ncustom.desktop/.Home\n'};
  if(args.includes('KEYCODE_HOME')){if(options.dispatchError)throw Error('Synthetic unknown dispatch');await options.dispatch?.();return {stdout:options.dispatchOutput??''};}
  if(args.includes('activities'))return {stdout:options.foreground??'topResumedActivity=ActivityRecord{x u10 custom.desktop/.Home t1}\n mResumedActivity: ActivityRecord{old u10 test.app/.Main t2}'};
  throw Error('Unexpected offline command '+args.join(' '));
 }});return {device,calls,dir};
}
test('returnHome dispatches one HOME and confirms exact resolved launcher component and user',async t=>{
 const h=harness(t);const result=await (h.device as any).returnHome(owner);
 assert.equal(result.confirmed,true);assert.equal(result.home.component,'custom.desktop/.Home');assert.equal(result.foreground.package,'custom.desktop');assert.equal(result.foreground.userId,10);
 assert.equal(h.calls.filter(c=>c.includes('KEYCODE_HOME')).length,1);assert.ok(h.calls.at(-1)?.includes('activities'));
 assert.ok(h.calls[0].includes('android.intent.category.HOME'));assert.ok(h.calls[0].includes('10'));
 assert.equal(JSON.parse(fs.readFileSync(path.join(h.dir,'return-home.json'),'utf8')).confirmed,true);
});
for(const foreground of [
 'topResumedActivity=ActivityRecord{x u10 test.app/.Main t1}',
 'topResumedActivity=ActivityRecord{x u10 unrelated.app/.Main t1}',
 'topResumedActivity=ActivityRecord{x u0 custom.desktop/.Home t1}',
 'topResumedActivity=ActivityRecord{x u10 custom.desktop/.Settings t1}',
 'topResumedActivity=null\n mResumedActivity: ActivityRecord{x u10 custom.desktop/.Home t1}',
 'mResumedActivity: ActivityRecord{x u10 custom.desktop/.Home t1}\n mResumedActivity: ActivityRecord{y u0 test.app/.Main t2}',
])test(`returnHome rejects unconfirmed actual desktop: ${foreground.split('\n')[0]}`,async t=>{
 const h=harness(t,{foreground});const result=await h.device.returnHome(owner);assert.equal(result.confirmed,false);assert.ok(result.error);assert.equal(h.calls.filter(c=>c.includes('KEYCODE_HOME')).length,1);
});
for(const marker of ['mResumedActivity:','Resumed:'])test(`returnHome accepts explicit ${marker} with canonical component`,async t=>{
 const h=harness(t,{foreground:`${marker} ActivityRecord{x u10 custom.desktop/custom.desktop.Home t1}`});assert.equal((await h.device.returnHome(owner)).confirmed,true);
});
test('returnHome resolves current foreground user when owner omitted',async t=>{
 const h=harness(t);assert.equal((await h.device.returnHome()).confirmed,true);assert.ok(h.calls[0].includes('activities'));assert.ok(h.calls[1].includes('10'));
});
for(const resolve of ['No activity found','custom.desktop/.Home\nother.desktop/.Home','custom.desktop/'])test(`returnHome refuses unresolved HOME before input: ${resolve}`,async t=>{
 const h=harness(t,{resolve});const result=await h.device.returnHome(owner);assert.equal(result.confirmed,false);assert.equal(result.dispatchStatus,'not-sent');assert.equal(h.calls.filter(c=>c.includes('KEYCODE_HOME')).length,0);
});
test('returnHome never replays unknown dispatch, including a new device instance',async t=>{
 const h=harness(t,{dispatchError:true});const first=await h.device.returnHome(owner);assert.equal(first.confirmed,false);assert.equal(first.dispatchStatus,'unknown');
 assert.equal((await h.device.returnHome(owner)).dispatchStatus,'unknown');
 const reconstructed=new AdbOcrDevice({serial:'OFFLINE',evidenceDir:h.dir,exec:async()=>{throw Error('Replayed unknown dispatch');}});
 assert.match((await reconstructed.returnHome(owner)).error??'',/never replay/);assert.equal(h.calls.filter(c=>c.includes('KEYCODE_HOME')).length,1);
});
test('returnHome holds exclusive device ownership through readback',async t=>{
 let release!:()=>void;let started!:()=>void;const entered=new Promise<void>(r=>{started=r;});const h=harness(t,{dispatch:async()=>{started();await new Promise<void>(r=>{release=r;});}});
 const first=h.device.returnHome(owner);await entered;await assert.rejects(h.device.returnHome(owner),/Device busy/);release();assert.equal((await first).confirmed,true);
});
