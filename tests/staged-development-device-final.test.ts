import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {AdbOcrDevice} from '../runner/staged/device.ts';
const policy='development-unbounded-v1' as const;
const owner={package:'com.taobao.taobao',userId:0};
const source=JSON.parse(await fs.readFile(new URL('../evidence/staged-2026-11-01T10-00-35-084Z/0c71b6ad-2a02-4586-89d0-f7e5c153dfc0.json',import.meta.url),'utf8'));
const png=await fs.readFile(source.path);
async function setup(t:any,options:any={}){
 const dir=await fs.mkdtemp(path.join(process.env.TMPDIR!,'development-device-final-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 let clock=1000,reads=0,swipes=0,ocr=0;const timeouts:number[]=[];
 const device=new AdbOcrDevice({serial:'OFFLINE',evidenceDir:dir,executionPolicy:options.strict?undefined:policy,now:()=>clock,monotonic:()=>clock,exec:async(file,args,limits)=>{
  if(limits) {assert.ok(Number.isFinite(limits.timeoutMs)&&limits.timeoutMs>0);timeouts.push(limits.timeoutMs);}
  if(file==='adb'){
   if(args.includes('resolve-activity'))return {stdout:'com.taobao.taobao/.Main'};
   if(args.includes('start'))return {stdout:'Starting'};
   if(args.includes('activities')){reads++;clock+=options.foregroundMs??0;return {stdout:reads<=(options.missingReads??0)?'mFocusedApp=null':`topResumedActivity=ActivityRecord{x u0 ${options.foreign?'other.app':owner.package}/.Main}`};}
   if(args.includes('screencap'))return {stdout:png};
   if(args.includes('swipe')){swipes++;clock+=args.at(-1)==='900'?900:0;if(options.unknown)throw Error('unknown dispatch');return {stdout:''};}
   throw Error('Unexpected offline command '+args.join(' '));
  }
  ocr++;
  if(args.length===2&&args[1].endsWith('.png')&&!args[1].includes('.title-')){
   await fs.writeFile(args[0],JSON.stringify({pages:[{file:args[1],width:1080,height:2400,lines:options.title?source.lines:[]}]}));clock+=options.ocrMs??0;
  }else{
   const sharp=(await import('sharp')).default;
   const pages=await Promise.all(args.slice(1).map(async file=>{const index=Number(file.match(/title-(\d+)/)![1]),b=source.lines[index].bounds,m=await sharp(file).metadata();return {file,width:m.width,height:m.height,lines:[{text:source.lines[index].text,bounds:b.map((n:number,i:number)=>(n-(i%2?Math.floor(b[1]-20):Math.floor(b[0]-20)))*3)}]};}));
   await fs.writeFile(args[0],JSON.stringify({pages}));clock+=6000;
  }
  return {stdout:''};
 }});
 return {device,dir,timeouts,setClock:(n:number)=>{clock=n;},get reads(){return reads},get swipes(){return swipes},get ocr(){return ocr}};
}
test('development launch accepts slow valid owner after more than one missing-marker reread',async t=>{
 const h=await setup(t,{missingReads:3,foregroundMs:2000});await h.device.act({type:'launch',...owner});h.setClock(10000);
 const f=await h.device.capture();assert.equal(f.package,owner.package);assert.equal(h.reads,5);
 const file=(await fs.readdir(h.dir)).find(x=>x.startsWith('launch-transition-'))!;const report=JSON.parse(await fs.readFile(path.join(h.dir,file),'utf8'));
 assert.equal(report.status,'foreground_confirmed');assert.equal(report.budgetMs,null);assert.equal(report.deadline,null);assert.equal(report.maxRereads,null);assert.equal(report.waits.length,3);
});
test('development optional title OCR accepts original pixels after full and local OCR exceed frame age',async t=>{
 const h=await setup(t,{title:true,ocrMs:6000});const f=await h.device.capture();assert.equal(f.capturedAt,1000);assert.equal(h.ocr,2);assert.equal(f.titleRefinement?.status,'complete');assert.ok(f.titleRefinement?.crops.some(c=>c.accepted));
});
test('development continuous scroll executes finite requested gestures despite slow owner checks',async t=>{
 const h=await setup(t,{foregroundMs:4000});const f=await h.device.capture();await h.device.scrollContinuously({type:'swipe',fromX:540,fromY:1900,toX:540,toY:800,ms:900},f,{maxSwipes:23,maxMs:1000});
 assert.equal(h.swipes,23);const report=JSON.parse(await fs.readFile(path.join(h.dir,'continuous-scroll.json'),'utf8'));assert.equal(report.completionInferred,false);assert.equal(report.nominalGestureMs,20700);
});
test('development continuous scroll stops unknown input without retry and retains foreign-owner rejection',async t=>{
 const h=await setup(t,{unknown:true});const f=await h.device.capture();await assert.rejects(h.device.scrollContinuously({type:'swipe',fromX:540,fromY:1900,toX:540,toY:800,ms:900},f,{maxSwipes:2,maxMs:2000}),/unknown dispatch/);assert.equal(h.swipes,1);
 await assert.rejects(h.device.scrollContinuously({type:'swipe',fromX:540,fromY:1900,toX:540,toY:800,ms:900},f,{maxSwipes:2,maxMs:2000}),/Frame/);assert.equal(h.swipes,1);
 const foreign=await setup(t,{foreign:true});await foreign.device.act({type:'launch',...owner});await assert.rejects(foreign.device.capture(),/identity changed/);
});
