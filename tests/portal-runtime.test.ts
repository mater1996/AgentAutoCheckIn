import test from 'node:test';
import assert from 'node:assert/strict';
import {PortalVision} from '../runner/portal-vision.ts';
import {createPortalHybrid,withPortalHybridSession} from '../runner/portal-runtime.ts';
import fs from 'node:fs';
import path from 'node:path';
import {acquireDeviceLock} from '../runner/device-lock.ts';

test('owned session holds device lock across observe and dispatch, then cleans up vision and forward',async()=>{
 const lockRoot=fs.mkdtempSync(path.join(process.env.TMPDIR!,'hybrid-runtime-'));
 const calls:string[][]=[];let destroyed=0;const urls:string[]=[];
 const serial='runtime-offline';
 try{
  const result=await withPortalHybridSession(async bridge=>{
   await assert.rejects(acquireDeviceLock({serial,lockRoot}),/locked/);
   const o=await bridge.observe();await bridge.back(o);return o.balance;
  },{expectedPackage:'test.app',panelText:'测试面板',rowRules:{panelText:'测试面板',titlePattern:'^(.+)[(]([0-9]+)/([0-9]+)[)]$',buttonTexts:['去完成']},maxAgeMs:5000,maxModelCalls:1,
   vision:new PortalVision(()=>({metrics:{totalPromptTokens:10,totalCompletionTokens:2,totalTokens:12,totalCachedInput:0,totalTimeCostMs:1,calls:1,byIntent:{},byModel:{}},aiQuery:async()=>({pageIdentity:'测试面板',blocked:false,balance:7,progress:'1/2',rows:[],scrollBounds:null}),destroy:async()=>{destroyed++;}})),
   session:{serial,lockRoot,exec:async(_f,args)=>{const a=args.slice(2);calls.push(a);
    if(a[0]==='forward')return {stdout:a[1]==='--remove'?'':'43210'};
    if(a.includes('dumpsys'))return {stdout:'topResumedActivity=ActivityRecord{x u0 test.app/.Main t1}'};
    return {stdout:'Row: 0 result='+JSON.stringify({status:'success',result:'offline-token'})};},
    fetchImpl:async(url,init)=>{const u=new URL(String(url));urls.push(u.pathname);
     if(u.pathname==='/ping')return new Response(JSON.stringify({status:'success',result:'pong'}));
     if(u.pathname==='/state_full')return new Response(JSON.stringify({status:'success',result:{a11y_tree:{},phone_state:{packageName:'test.app'}}}));
     if(u.pathname==='/screenshot')return new Response(JSON.stringify({status:'success',result:png}));
     assert.equal(u.pathname,'/global');assert.equal(init?.body,'action=1');return new Response(JSON.stringify({status:'success',result:'ok'}));}
   }});
  assert.equal(result.value,7);assert.equal(result.usage?.calls,1);assert.equal(destroyed,1);
  assert.deepEqual(calls.at(-1),['forward','--remove','tcp:43210']);assert.equal(urls.filter(x=>x==='/screenshot').length,1);
  const l=await acquireDeviceLock({serial,lockRoot});l.release();
 }finally{fs.rmSync(lockRoot,{recursive:true,force:true});}
});
const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
test('runtime wires the exact Portal screenshot to static Midscene and one Portal back, retaining usage',async()=>{
 let screenshots=0,queries=0,backs=0,destroyed=0;
 const vision=new PortalVision(device=>({metrics:{totalPromptTokens:10,totalCompletionTokens:2,totalTokens:12,totalCachedInput:0,totalTimeCostMs:1,calls:1,byIntent:{},byModel:{}},
  aiQuery:async()=>{queries++;assert.equal(await device.screenshotBase64(),'data:image/png;base64,'+png);assert.deepEqual(device.actionSpace(),[]);return {pageIdentity:'测试面板',blocked:false,balance:7,progress:'1/2',rows:[],scrollBounds:null};},
  destroy:async()=>{destroyed++;}}));
 const runtime=createPortalHybrid({portal:{readState:async()=>{throw Error('No tree');},screenshot:async()=>{screenshots++;return png;},back:async()=>{backs++;return {portalStatus:'success'};},tap:async()=>assert.fail(),swipe:async()=>assert.fail()},
 foreground:async()=>'test.app',vision,expectedPackage:'test.app',panelText:'测试面板',rowRules:{panelText:'测试面板',titlePattern:'^(.+)[(]([0-9]+)/([0-9]+)[)]$',buttonTexts:['去完成']},maxAgeMs:5000,maxModelCalls:1});
 const o=await runtime.observe();assert.equal(o.frame.width,1);assert.equal(o.balance,7);assert.equal(screenshots,1);assert.equal(queries,1);
 await runtime.back(o);assert.equal(backs,1);await vision.destroy();assert.equal(destroyed,1);assert.equal(vision.usage?.totalTokens,12);
});
