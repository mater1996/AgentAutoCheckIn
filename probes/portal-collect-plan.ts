import '../runner/model.ts';
import fs from 'node:fs';
import path from 'node:path';
import {withPortalHybridSession} from '../runner/portal-runtime.ts';
import {PortalVision,type PortalVisionFrame} from '../runner/portal-vision.ts';
import {collectPortalInventory} from '../runner/portal-collection.ts';
import {assessAndPlanInventory} from '../runner/collect.ts';
import {startRun,finishRun} from '../runner/ledger.ts';
import {setRunContext,MODEL} from '../runner/model.ts';
import {saveInventory} from '../runner/inventory.ts';
import {sqlite} from '../db/client.ts';

const started=Date.now();
const dir=path.resolve('evidence/portal-auto-collection-'+new Date().toISOString().replace(/[:.]/g,'-'));
fs.mkdirSync(dir,{recursive:true});
class RecordingVision extends PortalVision{
 frame:PortalVisionFrame|null=null;count=0;
 override async query<T=unknown>(frame:PortalVisionFrame,prompt:string):Promise<T>{
  if(this.count>=18)throw Error('Total query budget exhausted');
  const n=++this.count;this.frame={...frame};
  fs.writeFileSync(path.join(dir,`frame-${n}.png`),Buffer.from(frame.dataUrl.split(',')[1],'base64'));
  fs.writeFileSync(path.join(dir,`query-${n}.json`),JSON.stringify({frame:{id:frame.id,width:frame.width,height:frame.height,capturedAt:frame.capturedAt},prompt},null,2));
  console.log('QUERY_START',n);
  const response=await super.query<T>(frame,prompt);
  fs.writeFileSync(path.join(dir,`response-${n}.json`),JSON.stringify(response,null,2));
  console.log('QUERY_END',n,'elapsedMs',Date.now()-started);return response;
 }
}
const vision=new RecordingVision();
const runId=startRun({accountId:'tb_main',activityId:'tb_coin'});setRunContext(runId);
let failure:string|null=null;let status='COLLECT_FAILED';
try{
 console.log('RUN',runId,'EVIDENCE',dir);
 const result=await withPortalHybridSession(async bridge=>{
  // Let the service-start heads-up expire before taking the first frame.
  await new Promise(resolve=>setTimeout(resolve,6000));
  const scan=await collectPortalInventory(bridge,{account:'tb_main',activity:'tb_coin',evidenceDir:path.join(dir,'pages'),maxPages:7,overBudget:()=>Date.now()-started>360000});
  fs.writeFileSync(path.join(dir,'scan.json'),JSON.stringify(scan,null,2));
  if(!scan.ok||!scan.inventory)throw Error(scan.detail??'Collection incomplete');
  saveInventory(scan.inventory);
  if(!vision.frame)throw Error('No planning frame');
  const plan=await assessAndPlanInventory({aiQuery:p=>vision.query(vision.frame!,p)},scan.inventory,{runId,supervisedLearning:true,maxTasks:1,cnyPerUnit:(sqlite.prepare('select cny_per_unit as rate from asset where id=?').get('taobao_coins') as {rate:number}|undefined)?.rate});
  const output={runId,mode:'portal-midscene-collection-plan',executionAllowed:false,inventory:scan.inventory,plan:plan.plan,evidencePlanFile:plan.evidencePlanFile,stopConditions:['one candidate attempt only after separate continuation','login/captcha/purchase/cross-app authorization stop','unknown action result stop','completion evidence and same-page balance required'],observedBalance:JSON.parse(fs.readFileSync(path.join(dir,'response-1.json'),'utf8')).balance};
  fs.writeFileSync(path.join(dir,'result.json'),JSON.stringify(output,null,2));
  status='PLANNED';return output;
 },{expectedPackage:'com.taobao.taobao',panelText:'赚金币抵钱',rowRules:{panelText:'赚金币抵钱',titlePattern:'^(.+)[(]([0-9]+)/([0-9]+)[)]$',buttonTexts:['领取奖励','去完成','去逛逛','逛一逛']},maxAgeMs:45000,maxModelCalls:17,vision,session:{startServer:true,requestTimeoutMs:8000}});
 console.log('RESULT',JSON.stringify(result.value));
}catch(e){failure=e instanceof Error?e.message:'Unknown collection error';console.log('STOP',failure);process.exitCode=1;}
finally{
 const usage=vision.usage;
 finishRun(runId,{status,error:failure,execMs:Date.now()-started,evidenceDir:dir,usage,modelName:MODEL.name});
 fs.writeFileSync(path.join(dir,'summary.json'),JSON.stringify({runId,status,failure,elapsedMs:Date.now()-started,queryCount:vision.count,usage,executionAllowed:false},null,2));
 setRunContext(null);await vision.destroy();console.log('FINISHED',runId,status);
}
