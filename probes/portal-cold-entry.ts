import '../runner/model.ts';
import fs from 'node:fs';import path from 'node:path';import {execFile} from 'node:child_process';import {promisify} from 'node:util';
import {withLocalPortalSession} from '../runner/portal-client.ts';import {PortalVision} from '../runner/portal-vision.ts';import {portalNodes} from '../runner/portal-observation.ts';
const exec=promisify(execFile),serial='3d8a7934',pkg='com.taobao.taobao';
const round=Number(process.argv[2]);if(!Number.isInteger(round)||round<1||round>5)throw Error('Round must be 1..5');
const dir=path.resolve('evidence/portal-cold-entry-2026-10-31',`round-${round}`);fs.mkdirSync(dir,{recursive:true});
const adb=async(...args:string[])=>(await exec('adb',['-s',serial,...args],{timeout:15000,maxBuffer:8*1024*1024})).stdout;
const vision=new PortalVision();let started=Date.now(),taps=0;const steps:any[]=[];let outcome='failed',reason='Step limit';
try{await withLocalPortalSession(async c=>{
 if(!/mWakefulness=Awake/.test(await adb('shell','dumpsys','power')))throw Error('Screen not awake');
 const resolved=await adb('shell','cmd','package','resolve-activity','--brief','--user','0','-a','android.intent.action.MAIN','-c','android.intent.category.LAUNCHER',pkg);
 const component=resolved.split('\n').map(x=>x.trim()).find(x=>/^com\.taobao\.taobao\/[\w.$]+$/.test(x));if(!component)throw Error('Launcher unresolved');
 await adb('shell','am','force-stop','--user','0',pkg);started=Date.now();
 await adb('shell','am','start','--user','0','-n',component);await new Promise(r=>setTimeout(r,6000));
 for(let n=1;n<=6;n++){
  if(Date.now()-started>120000){reason='Time budget';break;}
  const foreground=(await adb('shell','dumpsys','activity','activities')).split('\n').filter(l=>l.includes('topResumedActivity'));
  if(!foreground.some(l=>l.includes('u0 '+pkg+'/'))){reason='Target user0 app not foreground';break;}
  let state:any=null;try{state=await c.readState();}catch{}
  const dataUrl=await c.screenshot();const {imageInfoOfBase64}=await import('@midscene/shared/img');const size=await imageInfoOfBase64(dataUrl);const capturedAt=Date.now();
  const frame={id:`round-${round}-step-${n}`,dataUrl,width:size.width,height:size.height,capturedAt};
  fs.writeFileSync(path.join(dir,`step-${n}.png`),Buffer.from(dataUrl.split(',')[1],'base64'));
  const texts=state?portalNodes(state.a11y_tree).filter(x=>x.node.isVisibleToUser).map(x=>x.node.text||x.node.contentDescription).filter(Boolean):[];
  const decision:any=await vision.query(frame,`仅看当前截图，协助导航到当前淘宝账号的淘金币“赚金币抵钱”任务列表。返回JSON {status:"arrived"|"navigate"|"wait"|"blocked"|"unavailable",page:"当前页说明",evidence:["原文"],progress:"a/b或空串",taskRows:["仅验证用的可见任务名称含配额，最多3条"],target:null或{label:"实际入口原文",purpose:"open_coin_activity"|"open_task_panel",x:原图中心x,y:原图中心y},reason:"依据"}。arrived必须看到展开的赚金币任务面板、完成进度及至少两条带配额和按钮的任务行。只允许点击淘宝首页的领淘金币入口，或淘金币活动页的去赚金币/赚更多金币/做任务等面板入口。绝不点任务行、签到、领取奖励/立即领取、商品、搜索、广告、购物车、购买、支付、登录、授权、切账号。登录验证码/人机验证或弹窗无法安全处理则blocked；加载中wait。找不到允许的入口则unavailable。不猜旧坐标；原图${size.width}x${size.height}。`);
  const record={n,elapsedMs:Date.now()-started,state,visibleTexts:texts,decision};steps.push(record);fs.writeFileSync(path.join(dir,`step-${n}.json`),JSON.stringify(record,null,2));console.log(JSON.stringify({round,n,...decision,treeDegraded:state?.degraded,treeTextCount:texts.length}));
  if(decision.status==='arrived'){
   if(!/^\d+\/\d+$/.test(decision.progress)||!Array.isArray(decision.taskRows)||decision.taskRows.length<2)throw Error('Arrival evidence incomplete');
   outcome='success';reason='Task panel visible with progress and multiple quota rows';break;
  }
  if(decision.status==='wait'){await new Promise(r=>setTimeout(r,2000));continue;}
  if(decision.status!=='navigate'){reason=String(decision.reason||decision.status);break;}
  const t=decision.target;if(!t||!['open_coin_activity','open_task_panel'].includes(t.purpose)||typeof t.label!=='string'||!t.label.trim()||![t.x,t.y].every(Number.isFinite)||t.x<0||t.y<0||t.x>=size.width||t.y>=size.height||Date.now()-capturedAt>45000||taps>=4)throw Error('Navigation target invalid');
  if((await adb('shell','dumpsys','activity','activities')).split('\n').filter(l=>l.includes('topResumedActivity')).some(l=>!l.includes('u0 '+pkg+'/')))throw Error('Foreground changed');
  const receipt=await c.tap(Math.round(t.x),Math.round(t.y));taps++;if(receipt.portalStatus!=='success')throw Error('Navigation rejected');await new Promise(r=>setTimeout(r,2500));
 }
},{startServer:true,requestTimeoutMs:8000});}catch(e){reason=e instanceof Error?e.message:'Unknown error';}
finally{const result={round,outcome,reason,elapsedMs:Date.now()-started,taps,usage:vision.usage,stepCount:steps.length,evidenceDir:dir};await vision.destroy();fs.writeFileSync(path.join(dir,'result.json'),JSON.stringify(result,null,2));console.log('ROUND_RESULT',JSON.stringify(result));}
