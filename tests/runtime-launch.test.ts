import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createStagedRuntime} from '../runner/staged/runtime.ts';
import {AdbOcrDevice,type DeviceExec} from '../runner/staged/device.ts';
import {validateProposedAction} from '../runner/staged/observations.ts';
const root=new URL('../evidence/staged-2026-11-01T12-25-37-230Z/',import.meta.url);
const desktop=JSON.parse(fs.readFileSync(new URL('e41e9715-aefc-4e7a-aa34-93c9ada82b02.json',root),'utf8'));
const png=fs.readFileSync(new URL('e41e9715-aefc-4e7a-aa34-93c9ada82b02.png',root));
const targetRoot=new URL('../evidence/staged-2026-11-01T06-31-13-908Z/',import.meta.url);
const target=JSON.parse(fs.readFileSync(new URL('d65dc20f-fa2d-44eb-9280-09f46eda12e0.json',targetRoot),'utf8'));
const targetPNG=fs.readFileSync(new URL('d65dc20f-fa2d-44eb-9280-09f46eda12e0.png',targetRoot));
function harness(options:any={}){
 const dir=fs.mkdtempSync(path.join(process.env.TMPDIR!,'runtime-launch-')),commands:string[][]=[];let started=false,queries=0;
 const cfg:any={localLaunch:true,scriptValidationMode:true,package:'com.taobao.taobao',scope:{appId:'a',accountId:'b',activityId:'c',userId:0},constraints:[],limits:{stageMs:3000,stageActions:3,agentCalls:3},stages:{open_app:{goal:'Open',checkpoint:'app'},open_list:{goal:'List',checkpoint:'list'}},...options.cfg};
 const exec:DeviceExec=async(file,args)=>{
  if(file==='adb'){
   commands.push(args);const command=args.slice(2).join(' ');
   if(command==='shell dumpsys activity activities')return {stdout:`topResumedActivity=ActivityRecord{x u0 ${options.already||started&&!options.noEffect?cfg.package:desktop.package}/.Main}`};
   if(command==='exec-out screencap -p')return {stdout:options.already||started&&!options.noEffect?targetPNG:png};
   if(command.includes('resolve-activity'))return {stdout:cfg.package+'/.Main'};
   if(command.includes('am start')){started=true;if(options.fail)throw Error('dispatch unknown');return {stdout:'Starting: Intent'};}
   throw Error('Unexpected adb '+command);
  }
  const frame=options.already||started&&!options.noEffect?target:desktop;
  fs.writeFileSync(args[0],JSON.stringify({pages:[{file:args[1],width:frame.width,height:frame.height,lines:frame.lines}]}));return {stdout:''};
 };
 const device=new AdbOcrDevice({serial:'offline-replay',evidenceDir:dir,exec});
 const rt=createStagedRuntime(cfg,device,{query:async()=>{queries++;throw Error('Model forbidden');}},{sessionId:'s',evidenceDir:dir,plan:[],...options.opts});
 return {rt,commands,get queries(){return queries;},close:()=>fs.rmSync(dir,{recursive:true,force:true})};
}
test('target already foreground performs zero launches and zero model queries',async()=>{
 const h=harness({already:true});try{assert.equal((await h.rt.stage('open_app',{})).status,'completed');assert.equal(h.commands.some(a=>a.includes('resolve-activity')||a.includes('start')),false);assert.equal(h.queries,0);}finally{h.close();}
});
for(const option of ['noEffect','fail'])test(option+' never completes or replays launch across stage reentry',async()=>{
 const h=harness({[option]:true});try{for(let i=0;i<2;i++)assert.notEqual((await h.rt.stage('open_app',{})).status,'completed');assert.equal(h.commands.filter(a=>a.includes('start')).length,1);assert.equal(h.queries,0);}finally{h.close();}
});
test('strict mode without explicit localLaunch never resolves or starts',async()=>{
 const h=harness({cfg:{localLaunch:false}});try{assert.notEqual((await h.rt.stage('open_app',{})).status,'completed');assert.equal(h.commands.some(a=>a.includes('resolve-activity')||a.includes('start')),false);assert.equal(h.queries,0);}finally{h.close();}
});
test('local launch review records the actual local script version',async()=>{
 const h=harness();try{const r=await h.rt.stage('open_app',{});assert.equal(r.review.candidateConfig.version,'local-open-app-v1');}finally{h.close();}
});
test('launch requires explicit exact owner in action validation',()=>{
 const owner={package:'com.taobao.taobao',userId:0},action={type:'launch',...owner};
 assert.throws(()=>validateProposedAction(action,desktop));
 assert.equal(validateProposedAction(action,desktop,owner),action);
 for(const bad of [{...action,package:'com.wrong.app'},{...action,userId:999},{type:'launch',package:owner.package}])assert.throws(()=>validateProposedAction(bad,desktop,owner));
});
test('runtime rejects forged launch dispatch and other stages retain launch rejection',async()=>{
 const h=harness({opts:{runStage:async(input:any,deps:any)=>{
  const frame=await deps.observe();
  if(input.stageId==='open_app'){
   const p=await deps.scriptStep({frame});
   for(const action of [{...p.action},{...p.action,package:'com.wrong.app'},{...p.action,userId:999}])await assert.rejects(()=>deps.dispatch(action,frame));
  }else{assert.equal(input.constraints.allowedActions.includes('launch'),false);await assert.rejects(()=>deps.dispatch({type:'launch',package:'com.taobao.taobao',userId:0},frame));}
  return {status:'stopped'};
 }}});try{await h.rt.stage('open_app',{});await h.rt.stage('open_list',{});assert.equal(h.commands.some(a=>a.includes('start')),false);}finally{h.close();}
});
test('strict local open_app resolves and launches once through real engine and device, then verifies fresh target',async()=>{
 const h=harness();try{const r=await h.rt.stage('open_app',{});assert.equal(r.status,'completed',JSON.stringify(r));assert.equal(r.actions.length,1);assert.equal(r.actions[0].source,'script');assert.equal(r.actions[0].status,'verified');assert.equal(r.usedScriptVersion,'local-open-app-v1');assert.equal(h.commands.filter(a=>a.includes('resolve-activity')).length,1);assert.equal(h.commands.filter(a=>a.includes('start')).length,1);assert.equal(h.queries,0);}finally{h.close();}
});
