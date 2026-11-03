import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { loadAiPanel, type AiPanelEvidence } from './ai-panel-reader.ts';
import type { BalanceComponentResult } from './balance-component.ts';
import { BALANCE_COMPONENT_VERSION, LEGACY_BALANCE_COMPONENT_VERSION, validateBalanceTextFrame, validateBalanceCropOCR } from './balance-component.ts';
export type OcrLine={text:string;bounds:number[]};
export type OcrObservation={version:'ocr-text-v1';texts:string[];excludedLineIndexes:number[]};
/** Text is observation only. Invalid geometry never becomes a clickable line. */
export function splitOcrObservation(lines:any[],width:number,height:number){
 const valid:OcrLine[]=[],texts:string[]=[],excludedLineIndexes:number[]=[];
 for(const [index,line] of lines.entries()){
  if(typeof line?.text==='string')texts.push(line.text);
  const b=line?.bounds;
  if(typeof line?.text!=='string'||!Array.isArray(b)||b.length!==4||!b.every((v:any)=>typeof v==='number'&&Number.isFinite(v))
   ||b[0]<0||b[1]<0||b[2]>width||b[3]>height||b[0]>=b[2]||b[1]>=b[3]){excludedLineIndexes.push(index);continue;}
  valid.push({text:line.text,bounds:[...b]});
 }
 return {lines:valid,ocrObservation:{version:'ocr-text-v1' as const,texts,excludedLineIndexes}};
}
export function observationTexts(frame:{lines:OcrLine[];ocrObservation?:OcrObservation}){
 return frame.ocrObservation?.version==='ocr-text-v1'?frame.ocrObservation.texts:frame.lines.map(l=>l.text);
}
/** Explicit task receipts only; negated/instructional contexts remain model observations. */
export function currentCompletionQuote(texts:string[]):string|null{
 const compact=(s:string)=>s.normalize('NFKC').replace(/\s/g,'');
 const receipt=/^[，,、•·●!]*(?:任务已完成|任务完成|浏览完成|已完成浏览|已得(?:淘金币|金币|币)\d+|已得\d+(?:淘金币|金币)|已获得\d+金币)(?=$|[!！。,，:：、…])/;
 const context=/未完成|尚未|还未|没有完成|未能完成|未获得|未得|不是|并非|未显示|教程|示例|例如|如果|若.*完成|完成后|完成时/;
 const unfinishedContext=/^(?:(?:教程|示例|例如|如果|若|未显示|并非|不是)[:：]?|(?:如果|若).*(?:条件|则|那么|[:：]))$/;
 const partial=(s:string)=>s.length>0&&(['任务已完成','任务完成','浏览完成','已完成浏览'].some(word=>word.startsWith(s))||/^(?:已|已获|已获得|已得)\d*金?$/.test(s));
 const parts=texts.flatMap(s=>s.split(/\r?\n/));
 for(let i=0;i<parts.length;i++){
  let source=parts[i],end=i;
  // Join only a genuinely incomplete receipt, never arbitrary neighboring product prose.
  while(partial(compact(source))&&!receipt.test(compact(source))&&end+1<parts.length&&end-i<3)source+='\n'+parts[++end];
  const clauses=source.split(/(?<=[。！？!?；;])|[|｜]/).map(s=>s.trim()).filter(Boolean);
  for(let j=0;j<clauses.length;j++){
   const candidate=clauses[j],s=compact(candidate);
   const earnedWithPromotion=/^[，,、•·●!]*已得\d+[!！。]*$/.test(s)&&/下单再得/.test(compact(source));
   if((!receipt.test(s)&&!earnedWithPromotion)||context.test(s))continue;
   // A preceding standalone qualifier or following continuation belongs to this sentence.
   if(j===0&&i>0&&unfinishedContext.test(compact(parts[i-1])))continue;
   if(j===clauses.length-1&&end+1<parts.length&&!/[。！？!?；;]$/.test(s)&&/^(?:后|时|的话|才|仅为|只是示例|教程(?:示例)?[:：]?$|示例[:：]?$)/.test(compact(parts[end+1])))continue;
   return candidate;
  }
 }
 return null;
}
export function hasIdentityChallenge(texts:string[]){
 return texts.some(s=>/请完成验证|验证码登录|滑块验证|安全验证|身份验证|人脸验证|请先登录|请登录|登录后继续|授权登录|请授权|授权后继续/.test(s));
}
export type OcrFrame={id:string;width:number;height:number;lines:OcrLine[];ocrObservation?:OcrObservation;path?:string;package?:string;userId?:number;capturedAt?:number;observationError?:string;balanceEvidence?:BalanceComponentResult;aiPanelEvidence?:AiPanelEvidence|null};
/** Artifact integrity is checked on every consumption; audit independently replays the image gate. */
export function verifiedBalanceValue(frame: OcrFrame): number | null {
 try {
  const e=frame.balanceEvidence, o=e?.ocrEvidence;
  const hash=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
  const markers=frame.lines.filter(l=>norm(l.text)==='赚金币抵钱');
  if(!e||e.status!=='accepted'||e.frameId!==frame.id||!frame.path||frame.observationError
   ||frame.width!==1080||frame.height!==2400||frame.package!=='com.taobao.taobao'||frame.userId!==0
   ||markers.length!==1||!Array.isArray(markers[0].bounds)||markers[0].bounds.length!==4
   ||markers[0].bounds.some((v,i)=>!Number.isFinite(v)||Math.abs(v-[394,478,685,538][i])>8)
   ||![BALANCE_COMPONENT_VERSION,LEGACY_BALANCE_COMPONENT_VERSION].includes(e.version)
   ||e.version===LEGACY_BALANCE_COMPONENT_VERSION&&(e.glyphRecognition?.text!==o?.text
    ||!Array.isArray(e.glyphRecognition?.glyphs)||e.glyphRecognition.glyphs.map(g=>g.digit).join('')!==o?.text)
   ||!Number.isSafeInteger(e.value)||e.value!<=0||!o||!/^\d{4}$/.test(o.text)||Number(o.text)!==e.value
   ||e.roi?.left!==86||e.roi?.top!==238||e.roi?.width!==128||e.roi?.height!==70
   ||hash(readFileSync(frame.path))!==e.sourcePngSha256||hash(readFileSync(o.cropPath))!==e.cropHash)return null;
  const raw=readFileSync(o.path);if(hash(raw)!==o.sha256)return null;
  const pages=JSON.parse(raw.toString()).pages;
  if(!Array.isArray(pages)||pages.length!==1)return null;
  const p=pages[0],l=p?.lines?.[0],b=l?.bounds;
  if(p.file!==o.cropPath||p.width!==512||p.height!==280||!Array.isArray(p.lines)||p.lines.length!==1
   ||l.text!==o.text||!Array.isArray(b)||b.length!==4||!b.every(Number.isFinite)
   ||JSON.stringify(b)!==JSON.stringify(o.bounds)||b[0]<4||b[1]<4||b[2]>508||b[3]>276||b[0]>=b[2]||b[1]>=b[3])return null;
  if(e.version===BALANCE_COMPONENT_VERSION){
   const full=e.fullFrameOcrEvidence;
   if(!full||full.path!==frame.path.replace(/\.png$/,'.ocr.json'))return null;
   const fullRaw=readFileSync(full.path);if(hash(fullRaw)!==full.sha256)return null;
   validateBalanceCropOCR(JSON.parse(raw.toString()),o.cropPath);
   validateBalanceTextFrame({...frame,path:frame.path},JSON.parse(fullRaw.toString()),o.text);
  }
  return e.value;
 }catch{return null;}
}
export type CurrentTask={name:string;instruction:string;done:number;total:number;reward:number|null;rewardMin?:number|null;rewardMax?:number|null;rewardOffers?:{condition:string;reward:number|null;rewardMin:number|null;rewardMax:number|null}[];button:string;frameId?:string;bounds?:number[];point?:number[];taskDefinitionId?:string};
export function plannedTaskEligible(task:{name:string;instruction:string;done:number;total:number},decision:any,options:{mode?:string;completed?:string[];scriptValidation?:boolean}={}){
 const equal=(a:string,b:string)=>a.normalize('NFKC').trim()===b.normalize('NFKC').trim();
 if(!decision||decision.decision!=='do'||!equal(task.name,decision.name)||!equal(task.instruction,decision.instruction??'')||task.done>=task.total)return false;
 if(options.mode==='batch-attempts-v1'){
  const attempts=decision.attemptsThisBatch??0,limit=decision.initialExecutions??decision.times??1;
  return Number.isSafeInteger(attempts)&&attempts>=0&&Number.isSafeInteger(limit)&&limit>0&&attempts<limit;
 }
 return options.scriptValidation===true||!(options.completed??[]).includes(decision.name);
}
const norm=(s:string)=>s.normalize('NFKC').trim();
const mid=(b:number[])=>[(b[0]+b[2])/2,(b[1]+b[3])/2];
const buttons=new Set(['去完成','逛一逛','去逛逛','领取奖励']);
export function readPanel(frame:OcrFrame,marker='赚金币抵钱'){
 if('aiPanelEvidence' in frame){
  const p=loadAiPanel(frame);
  return p?{...p,top:p.top===true,bottom:p.bottom===true,source:'ai-panel-v1'}:{isPanel:false,balance:null,blocked:true,tasks:[] as CurrentTask[],top:false,bottom:false,source:'ai-panel-v1'};
 }
 const isPanel=frame.lines.some(l=>norm(l.text)===norm(marker));
 const titles=frame.lines.map(l=>({line:l,m:norm(l.text).match(/^(.*?)\((\d+)\/(\d+)\)$/)})).filter(x=>x.m&&x.line.bounds[1]>frame.height*.23&&x.line.bounds[3]<frame.height*.95).sort((a,b)=>a.line.bounds[1]-b.line.bounds[1]);
 const tasks:CurrentTask[]=[];
 for(let i=0;i<titles.length;i++){
  const {line,m}=titles[i];if(!m)continue;
  const cy=mid(line.bounds)[1];
  const bs=frame.lines.filter(l=>buttons.has(norm(l.text))&&l.bounds[0]>frame.width*.7&&Math.abs(mid(l.bounds)[1]-cy)<75);
  if(bs.length!==1)continue;
  const end=Math.min(titles[i+1]?.line.bounds[1]??frame.height*.95,line.bounds[3]+110);
  const body=frame.lines.filter(l=>l.bounds[1]>=line.bounds[3]-3&&l.bounds[1]<end&&l.bounds[0]>=line.bounds[0]-15&&l.bounds[0]<frame.width*.76).sort((a,b)=>a.bounds[0]-b.bounds[0]);
  const reward=body.map(l=>norm(l.text).match(/\+\s*(\d+)(?:\s*$|\D)/)?.[1]).filter(Boolean);
  // Remove only observed currency/reward fragments; do not infer procedure from title.
  const instruction=body.map(l=>norm(l.text).replace(/[币市③⑥]/g,'').replace(/[)（(]/g,'').replace(/\+\s*\d+(?:\s*[~～-]\s*\d+)?/g,'').trim()).filter(Boolean).join(' ').trim();
  const b=bs[0];tasks.push({name:m[1],done:Number(m[2]),total:Number(m[3]),instruction,reward:reward.length===1?Number(reward[0]):null,button:norm(b.text),frameId:frame.id,bounds:line.bounds,point:mid(b.bounds).map(Math.round)});
 }
 const balances=frame.lines.filter(l=>l.bounds[0]<frame.width*.27&&l.bounds[1]>frame.height*.08&&l.bounds[3]<frame.height*.14).map(l=>norm(l.text).match(/^([\d,]+)(?:\D|$)/)?.[1]).filter(Boolean);
 // TODO: retire legacy full-frame parsing only after optional component coverage is validated.
 const balance='balanceEvidence' in frame?(isPanel?verifiedBalanceValue(frame):null):isPanel&&balances.length===1?Number(balances[0]!.replaceAll(',','')):null;
 const blocked=frame.lines.some(l=>/请完成验证|验证码登录|滑块验证|安全验证/.test(l.text));
 return {isPanel,balance,blocked,tasks,top:frame.lines.some(l=>/完成进度\s*\d+\s*\/\s*\d+/.test(norm(l.text))),bottom:frame.lines.some(l=>l.text.includes('以上奖励均为最高奖励'))};
}
export function bindTask(frame:OcrFrame,expected:CurrentTask){
 if(expected.frameId&&expected.frameId!==frame.id)return null;
 const candidates=readPanel(frame).tasks.filter(t=>norm(t.name)===norm(expected.name)&&norm(t.instruction)===norm(expected.instruction)&&t.done===expected.done&&t.total===expected.total);
 return candidates.length===1?candidates[0]:null;
}
/** Rebind only the owning selected row from a new full OCR capture; no model or old geometry. */
export async function inspectCurrentSelectedTask(frame:any,owner:{package:string;userId:number},expected:CurrentTask){
 try{
  if('aiPanelEvidence' in frame||frame.observationError)return null;
  const panel=await (await import('./activity-navigation.ts')).inspectCurrentActivityNavigation(frame,owner);
  if(panel?.state!=='panel'||panel.frameId!==frame.id)return null;
  const raw=JSON.parse(readFileSync(frame.path.replace(/\.png$/,'.ocr.json'),'utf8')).pages[0];
  const key=(s:string)=>s.normalize('NFKC').replace(/\s/g,'');
  const requirement=(s:string)=>key(s).replace(/(?:最高)?\+\d+(?:[~～-]\d+)?/g,'').replace(/[币市③⑥，,、;；()]/g,'');
  const find=(lines:OcrLine[])=>{
   const titles=lines.filter(l=>/^.+\(\d+\/\d+\)$/.test(key(l.text))).sort((a,b)=>a.bounds[1]-b.bounds[1]);
   const matches=titles.filter(l=>key(l.text).replace(/\(\d+\/\d+\)$/,'')===key(expected.name));
   if(matches.length!==1)return null;
   const title=matches[0],q=key(title.text).match(/\((\d+)\/(\d+)\)$/)!;
   if(+q[1]!==expected.done||+q[2]!==expected.total||+q[1]>=+q[2])return null;
   const end=Math.min(titles[titles.indexOf(title)+1]?.bounds[1]??frame.height*.95,title.bounds[3]+130);
   const buttons=lines.filter(l=>l.bounds[0]>frame.width*.7&&l.bounds[1]>=title.bounds[1]&&l.bounds[3]<=end&&/^(去完成|去逛逛|逛一逛|领取奖励|已完成)$/.test(key(l.text)));
   if(buttons.length!==1||!['去完成','去逛逛','逛一逛'].includes(key(buttons[0].text)))return null;
   const button=buttons[0],body=lines.filter(l=>l!==title&&l.bounds[1]>=title.bounds[3]-3&&l.bounds[3]<=end&&l.bounds[0]>=title.bounds[0]-15&&l.bounds[2]<=button.bounds[0]).sort((a,b)=>a.bounds[0]-b.bounds[0]);
   if(!body.length||requirement(body.map(l=>l.text).join(''))!==requirement(expected.instruction))return null;
   if([title,button,...body].some(target=>lines.filter(l=>l.bounds[0]<target.bounds[2]&&l.bounds[2]>target.bounds[0]&&l.bounds[1]<target.bounds[3]&&l.bounds[3]>target.bounds[1]).length!==1))return null;
   return {title,button,body};
  };
  const current=find(frame.lines),original=find(splitOcrObservation(raw.lines,frame.width,frame.height).lines);
  if(!current||!original||JSON.stringify(current)!==JSON.stringify(original))return null;
  return {...expected,frameId:frame.id,bounds:current.title.bounds,button: norm(current.button.text),point:mid(current.button.bounds).map(Math.round)};
 }catch{return null;}
}
export function stableSettlement(p:{before:CurrentTask;balanceBefore:number;samples:{isPanel:boolean;balance:number|null;task?:CurrentTask}[];receipt:boolean}){
 const tail=p.samples.slice(-2);if(!p.receipt||tail.length!==2||!Number.isFinite(p.balanceBefore)||p.balanceBefore<=0)return {ok:false,reason:'Missing receipt or baseline'};
 if(tail.some(x=>!x.isPanel||x.balance===null||!Number.isFinite(x.balance)||x.balance<=0)||tail[0].balance!==tail[1].balance)return {ok:false,reason:'Owning-panel balance not stable'};
 for(const x of tail)if(x.task&&(x.task.total!==p.before.total||x.task.done<=p.before.done))return {ok:false,reason:'Current task counter contradicts completion'};
 const delta=tail[1].balance!-p.balanceBefore;if(delta<=0)return {ok:false,reason:'Owning balance did not increase'};
 return {ok:true,balance:tail[1].balance!,delta};
}
export function validateProposedAction(action:any,frame:OcrFrame,launchOwner?:{package:string;userId:number}){
 if(action?.type==='launch'&&launchOwner&&/^[a-zA-Z][\w]*(?:\.[a-zA-Z][\w]*)+$/.test(launchOwner.package)
  &&Number.isSafeInteger(launchOwner.userId)&&launchOwner.userId>=0&&action.package===launchOwner.package&&action.userId===launchOwner.userId)return action;
 if(!['tap','swipe','back','wait'].includes(action?.type))throw Error('Agent action unsupported');
 if(action.type==='tap'){
  if(!Number.isFinite(action.x)||!Number.isFinite(action.y)||action.x<0||action.y<0||action.x>=frame.width||action.y>=frame.height)throw Error('Invalid target coordinate');
  if('aiPanelEvidence' in frame){
   const p=loadAiPanel(frame);
   if(!p||p.blocked)throw Error('AI panel evidence invalid or blocked');
   if(p.isPanel){
    if(p.readPurpose&&p.readPurpose!=='selected-row')throw Error('Focused panel purpose does not authorize taps');
    const rows=p.tasks.filter(t=>t.point?.[0]===action.x&&t.point?.[1]===action.y&&t.done<t.total&&['去完成','逛一逛','去逛逛'].includes(t.button));
    if(rows.length!==1)throw Error('AI panel tap requires a unique current browse button');
    return action;
   }
  }
  const sensitive=frame.lines.filter(l=>/购买|加购|购物车|支付|充值|提现|兑换|开通|登录|授权|验证码|手机号|收货地址/.test(l.text));
  if(sensitive.some(l=>action.x>=l.bounds[0]-25&&action.x<=l.bounds[2]+25&&action.y>=l.bounds[1]-25&&action.y<=l.bounds[3]+25))throw Error('Tap intersects prohibited control');
 }
 return action;
}
export function recipeStep(recipe:any,frame:OcrFrame,index:number):any|null{
 if(recipe?.state!=='validated'||!Array.isArray(recipe.steps))return null;
 const step=recipe.steps[index];if(!step)return null;
 let action:any;
 if(step.kind==='back')action={type:'back'};
 else if(step.kind==='wait'&&step.ms>0&&step.ms<=5000)action={type:'wait',ms:step.ms};
 else if(step.kind==='tap_text'){
  let candidates=frame.lines.filter(l=>norm(l.text)===norm(step.text));
  if(step.nearTask){const tasks=readPanel(frame).tasks.filter(t=>norm(t.name)===norm(step.nearTask));if(tasks.length!==1)return null;const point=tasks[0].point!;candidates=candidates.filter(l=>Math.abs(mid(l.bounds)[1]-point[1])<60);}
  if(candidates.length!==1)return null;const [x,y]=mid(candidates[0].bounds).map(Math.round);action={type:'tap',x,y};
 }else return null;
 return {frameId:frame.id,action,reason:'Validated recipe step '+index,expected:step.expected??'Observe the expected next checkpoint'};
}
