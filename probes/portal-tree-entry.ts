import fs from 'node:fs';import path from 'node:path';import {execFileSync} from 'node:child_process';
import {withLocalPortalSession} from '../runner/portal-client.ts';import {portalNodes,extractPortalRows,type PortalState} from '../runner/portal-observation.ts';
const round=Number(process.argv[2]);if(!Number.isInteger(round)||round<1||round>5)throw Error('round 1..5');
const root=path.resolve(process.argv[3]||'evidence/portal-tree-entry-2026-10-31');const dir=path.join(root,'round-'+round);fs.mkdirSync(dir,{recursive:true});
const adb=(...a:string[])=>execFileSync('adb',['-s','3d8a7934',...a],{encoding:'utf8',timeout:12000,maxBuffer:6*1024*1024});
const delay=(ms:number)=>new Promise(r=>setTimeout(r,ms));const reads:any[]=[];const actions:any[]=[];let started=Date.now(),outcome='failed',reason='',readIndex=0;let rows:any[]=[];
const rules={panelText:'赚金币抵钱',titlePattern:'^(.+)[(]([0-9]+)/([0-9]+)[)]$',buttonTexts:['领取奖励','去完成','去逛逛','逛一逛']};
try{await withLocalPortalSession(async c=>{
 const foreground=()=>{const ls=adb('shell','dumpsys','activity','activities').split('\n').filter(l=>l.includes('topResumedActivity'));if(ls.length!==1||!ls[0].includes('u0 com.taobao.taobao/'))throw Error('Foreground mismatch');};
 if(!/mWakefulness=Awake/.test(adb('shell','dumpsys','power')))throw Error('Screen asleep');
 const component=adb('shell','cmd','package','resolve-activity','--brief','--user','0','-a','android.intent.action.MAIN','-c','android.intent.category.LAUNCHER','com.taobao.taobao').split('\n').map(x=>x.trim()).find(x=>/^com\.taobao\.taobao\/[\w.$]+$/.test(x));if(!component)throw Error('Launcher missing');
 adb('shell','am','force-stop','--user','0','com.taobao.taobao');started=Date.now();adb('shell','am','start','--user','0','-n',component);await delay(6000);
 const shot=async(name:string)=>{try{const data=await c.screenshot();fs.writeFileSync(path.join(dir,name+'.png'),Buffer.from(data.split(',')[1],'base64'));}catch{}};
 try{
 for(const stage of ['home','coin','panel']){
  let accepted=false;
  for(let attempt=1;attempt<=6;attempt++){
   if(Date.now()-started>100000)throw Error('Round time budget');
   if(attempt>1)await delay(2000);foreground();const began=Date.now();const i=++readIndex;
   let state:PortalState;try{state=await c.readState() as unknown as PortalState;}catch(e){reads.push({i,stage,attempt,kind:'error',ms:Date.now()-began});continue;}
   fs.writeFileSync(path.join(dir,'read-'+i+'.json'),JSON.stringify({at:Date.now(),state},null,2));
   const ns=portalNodes(state.a11y_tree);const visible=ns.filter(x=>x.node.isVisibleToUser);const label=(n:any)=>(n.text||n.contentDescription||'').trim();
   const texts=visible.map(x=>label(x.node)).filter(Boolean);const kind=state.degraded||state.degradedReason?'degraded':'normal-shape';
   const record={i,stage,attempt,kind,ms:Date.now()-began,ageMs:state.snapshotAgeMs??null,accepted:false};reads.push(record);
   console.log(JSON.stringify({round,...record}));
   if(kind==='degraded'||state.phone_state?.packageName!=='com.taobao.taobao')continue;
   if(texts.some(t=>/验证码登录|滑块验证|请完成验证|账号登录/.test(t)))throw Error('Login or verification');
   if(stage==='panel'){
    if(!texts.includes('赚金币抵钱')||!texts.some(t=>/^完成进度\s*\d+\/\d+$/.test(t)))continue;
    try{rows=extractPortalRows(state,rules);}catch{continue;}if(rows.length<2)continue;
    record.accepted=true;accepted=true;break;
   }
   const allowed=stage==='home'?['领淘金币']:['去赚金币','赚更多金币'];
   if(stage==='coin'&&texts.includes('赚金币抵钱'))throw Error('Panel appeared before second dispatch; stop rather than repeat');
   const targets=visible.filter(x=>allowed.includes(label(x.node))&&x.node.isEnabled===true);
   if(targets.length!==1)continue;const t=targets[0];const b=t.node.boundsInScreen;const size=state.device_context?.screen_bounds;
   if(!b||!size||![b.left,b.top,b.right,b.bottom].every(Number.isFinite)||b.left<0||b.top<0||b.right<=b.left||b.bottom<=b.top||b.right>size.width||b.bottom>size.height)throw Error('Invalid bounds');
   foreground();const action={stage,label:label(t.node),path:t.path,bounds:b,status:'pending'};actions.push(action);fs.writeFileSync(path.join(dir,'actions.json'),JSON.stringify(actions,null,2));
   try{const receipt=await c.tap(Math.round((b.left+b.right)/2),Math.round((b.top+b.bottom)/2));action.status=receipt.portalStatus;fs.writeFileSync(path.join(dir,'actions.json'),JSON.stringify(actions,null,2));if(receipt.portalStatus!=='success')throw Error('Rejected');}catch{throw Error('Action failed or unknown; no repeat');}
   record.accepted=true;accepted=true;await delay(2500);break;
  }
  if(!accepted)throw Error('Read retry limit at '+stage);
 }
 outcome='tree-arrived';reason='Non-degraded task panel with progress and >=2 parsed rows';
 }finally{await shot('final');}
},{startServer:true,requestTimeoutMs:8000});}catch(e){reason=e instanceof Error?e.message:'Unknown failure';}
const result={round,outcome,reason,elapsedMs:Date.now()-started,modelCalls:0,midsceneUsed:false,reads,actions,rows,evidenceDir:dir};fs.writeFileSync(path.join(dir,'result.json'),JSON.stringify(result,null,2));console.log('RESULT',JSON.stringify({round,outcome,reason,elapsedMs:result.elapsedMs,reads:reads.length,degraded:reads.filter(x=>x.kind==='degraded').length,taps:actions.length}));
