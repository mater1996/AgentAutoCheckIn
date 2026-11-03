import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {AdbOcrDevice} from '../runner/staged/device.ts';
test('device unsent proof is exact-act bound, single use and rejects forged error fields',async t=>{
 const dir=fs.mkdtempSync('/Users/mater/.hermes/cache/scratch/unsent-proof-');t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const source='evidence/staged-2026-11-02T01-25-13-762Z/8481bb37-6035-4ee2-87bb-f41b989c4a78';let reads=0,inputs=0;
 const device=new AdbOcrDevice({serial:'OFFLINE',evidenceDir:dir,exec:async(file,args)=>{
  if(file==='adb'){
   if(args.includes('dumpsys'))return {stdout:++reads===3?'missing':'topResumedActivity=ActivityRecord{x u0 com.taobao.taobao/.Main}'};
   if(args.includes('screencap'))return {stdout:fs.readFileSync(source+'.png')};inputs++;throw Error('Input forbidden');
  }
  const raw=JSON.parse(fs.readFileSync(source+'.ocr.json','utf8'));raw.pages[0].file=args[1];fs.writeFileSync(args[0],JSON.stringify(raw));return {stdout:''};
 }});
 const frame=await device.capture(),action={type:'tap' as const,x:860,y:480};let failure:unknown;
 try{await device.act(action,frame);}catch(e){failure=e;}
 assert.equal(inputs,0);assert.ok(failure);
 assert.equal(device.consumeUnsentTap(Object.assign(Error('Foreground missing or ambiguous'),{recorded:true,inputSent:false}),action,frame),null);
 assert.equal(device.consumeUnsentTap(failure,{...action},frame),null);assert.equal(device.consumeUnsentTap(failure,action,{...frame}),null);
 const proof=device.consumeUnsentTap(failure,action,frame);assert.ok(proof);assert.equal(device.consumeUnsentTap(failure,action,frame),null);
 const saved=JSON.parse(fs.readFileSync(proof.path,'utf8'));assert.equal(saved.inputSent,false);assert.equal(saved.consumedFrameId,frame.id);
 await assert.rejects(()=>device.act(action,frame),/consumed/);
});
