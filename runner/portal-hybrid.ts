import {randomUUID} from 'node:crypto';
import {extractPortalRows,type PortalBounds,type PortalRowRules,type PortalState} from './portal-observation.ts';
export type HybridFrame={id:string;dataUrl:string;width:number;height:number;capturedAt:number};
export type HybridRow={name:string;instruction:string;quota:string;reward:number|null;button:{text:string;bounds:PortalBounds}};
export type HybridPage={pageIdentity:string;blocked:boolean;balance:number|null;progress:string|null;rows:HybridRow[];scrollBounds:PortalBounds|null;
 atTop?:boolean;atBottom?:boolean;boundaryEvidence?:{top:string;bottom:string};tiers?:{coin:number;need:string;button:string}[]};
export type HybridObservation=HybridPage & {id:string;frame:HybridFrame;rowSource:'portal'|'vision';portalState:PortalState|null};
type Receipt={portalStatus:string};
export type HybridOptions={
 portal:{readState():Promise<unknown>;tap(x:number,y:number):Promise<Receipt>;swipe(p:{startX:number;startY:number;endX:number;endY:number;duration:number}):Promise<Receipt>;back():Promise<Receipt>};
 capture():Promise<HybridFrame>;foreground():Promise<string>;
 vision:{query(frame:HybridFrame,prompt:string):Promise<unknown>};now?:()=>number;
 expectedPackage:string;panelText:string;rowRules:PortalRowRules;maxModelCalls:number;maxAgeMs:number;
};
const validFraction=(s:unknown)=>{if(typeof s!=='string'||!/^\d+\/\d+$/.test(s))return false;const [a,b]=s.split('/').map(Number);return Number.isSafeInteger(a)&&Number.isSafeInteger(b)&&b>0&&a<=b;};
const validBounds=(b:PortalBounds,f:HybridFrame)=>!!b&&[b.left,b.top,b.right,b.bottom].every(Number.isFinite)&&b.left>=0&&b.top>=0&&b.right>b.left&&b.bottom>b.top&&b.right<=f.width&&b.bottom<=f.height;
function validatePage(p:HybridPage,f:HybridFrame){
 if(!p||typeof p.pageIdentity!=='string'||!p.pageIdentity.trim()||p.blocked!==false
  ||(p.balance!==null&&(!Number.isFinite(p.balance)||p.balance<0))
  ||(p.progress!==null&&!validFraction(p.progress))||!Array.isArray(p.rows)
  ||(p.scrollBounds!==null&&!validBounds(p.scrollBounds,f)))throw Error('Invalid or blocked visual observation');
 for(const r of p.rows)if(!r||typeof r.name!=='string'||!r.name.trim()||typeof r.instruction!=='string'
  ||!validFraction(r.quota)||(r.reward!==null&&(!Number.isFinite(r.reward)||r.reward<0))
  ||!r.button||typeof r.button.text!=='string'||!r.button.text.trim()||!validBounds(r.button.bounds,f))throw Error('Invalid visual task row');
}
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
const identity=(r:HybridRow)=>JSON.stringify([r.name,r.instruction,r.quota,r.reward]);
/** Shared observation + one Portal dispatcher. No planning, accounting or autonomous model actions. */
export class PortalHybrid{
 private calls=0;private current:HybridObservation|null=null;private unresolved=false;private busy=false;
 private now:()=>number;
 constructor(private opts:HybridOptions){
  this.now=opts.now??Date.now;
  if(!Number.isSafeInteger(opts.maxModelCalls)||opts.maxModelCalls<0||!Number.isFinite(opts.maxAgeMs)||opts.maxAgeMs<=0)throw Error('Invalid observation budget');
 }
 async observe():Promise<HybridObservation>{
  if(this.busy)throw Error('Observation or dispatch busy');this.busy=true;
  try{return await this.observeOnce();}finally{this.busy=false;}
 }
 private async observeOnce():Promise<HybridObservation>{
  this.current=null;
  if(await this.opts.foreground()!==this.opts.expectedPackage)throw Error('Wrong foreground');
  let state:PortalState|null=null;
  try{state=await this.opts.portal.readState() as PortalState;}catch{/* independent screenshot can fill a failed tree */}
  const frame=await this.opts.capture();
  if(this.calls>=this.opts.maxModelCalls)throw Error('Visual call budget exhausted');
  this.calls++;
  const page=await this.opts.vision.query(frame,`只读取所附当前截图，不执行动作。完整返回JSON {pageIdentity:实际页面标题,blocked:是否有登录验证或遮挡,balance:当前页面余额或null,progress:完整分数或null,rows:[{name:完整任务名,instruction:实际说明,quota:完整次数如0/1,reward:单个明确奖励数字或null,button:{text:按钮文字,bounds:{left,top,right,bottom}}}],scrollBounds:任务列表可手势滚动的内容区域bounds，已经到顶部/底部也必须给出该区域，不因无法继续向同一方向滑而null,atTop:仅当明确看见列表开头奖励档位区和完成进度时为true，固定标题或首个当前可见任务绝不是列表顶部依据,atBottom:是否明确看到最后任务后底部说明,boundaryEvidence:{top:顶部依据原文或空串,bottom:底部说明原文或空串},tiers:[{coin:档位奖励数字,need:原文条件字符串，无条件用空串，禁止null,button:原文按钮字符串，无按钮用空串，禁止null}]}。只收集名称/完整说明/配额/按钮均可读且完整在屏内的行，保留原文，不把奖励图标文字混入说明。顶部/底部没有依据返回false，滚动没变化不证明到底；面板本身不是遮挡。坐标必须是原图${frame.width}x${frame.height}像素，不用树猜位置；只允许balance/progress/reward/scrollBounds在不可读时为null，其他缺失文字空串、集合空数组、边界false。` ) as HybridPage;
  validatePage(page,frame);
  if(!Number.isFinite(frame.capturedAt)||frame.capturedAt>this.now()||this.now()-frame.capturedAt>this.opts.maxAgeMs)throw Error('Visual frame expired');
  if(await this.opts.foreground()!==this.opts.expectedPackage)throw Error('Foreground changed');
  let rows:HybridRow[]=[];
  try{if(state&&!state.degraded&&!state.degradedReason&&state.phone_state.packageName===this.opts.expectedPackage)rows=extractPortalRows(state,this.opts.rowRules);}catch{/* use independently read visual facts */}
  const comparable=(r:HybridRow)=>({name:r.name,instruction:r.instruction,quota:r.quota,reward:r.reward,button:r.button});
  const matched=same(rows.map(comparable),page.rows.map(comparable));
  const out={...page,rows:matched?rows:page.rows,id:randomUUID(),frame,rowSource:matched?'portal' as const:'vision' as const,portalState:state};
  this.current=structuredClone(out);return structuredClone(out);
 }
 private claim(o:HybridObservation){
  if(!this.current||!same(o,this.current))throw Error('Observation consumed or invalid');
  if(this.now()<o.frame.capturedAt||this.now()-o.frame.capturedAt>this.opts.maxAgeMs)throw Error('Observation expired');
 }
 private async dispatch(o:HybridObservation,fn:()=>Promise<Receipt>){
  if(this.busy)throw Error('Observation consumed or dispatcher busy');this.busy=true;
  try{return await this.dispatchOnce(o,fn);}finally{this.busy=false;}
 }
 private async dispatchOnce(o:HybridObservation,fn:()=>Promise<Receipt>){
  if(this.unresolved)throw Error('Previous action unresolved; read-only inspection required');
  this.claim(o);if(await this.opts.foreground()!==this.opts.expectedPackage)throw Error('Wrong foreground');
  this.claim(o); // Foreground lookup can take time; recheck expiry before consuming.
  this.current=null;
  try{const r=await fn();return {status:r.portalStatus==='success'?'dispatched':'rejected',businessComplete:false};}
  catch{this.unresolved=true;return {status:'unknown',businessComplete:false};}
 }
 async back(o:HybridObservation){return this.dispatch(o,()=>this.opts.portal.back());}
 async swipe(o:HybridObservation,p:{startX:number;startY:number;endX:number;endY:number;duration:number}){
  this.claim(o);const b=o.scrollBounds;
  if(!b||![p.startX,p.startY,p.endX,p.endY,p.duration].every(Number.isFinite)
   ||p.duration<=0||p.duration>2000
   ||[p.startX,p.endX].some(x=>x<=b.left||x>=b.right)
   ||[p.startY,p.endY].some(y=>y<=b.top||y>=b.bottom))throw Error('Invalid scroll region');
  return this.dispatch(o,()=>this.opts.portal.swipe(p));
 }
 async tapTask(o:HybridObservation,target:HybridRow){
  this.claim(o);
  if(o.pageIdentity!==this.opts.panelText)throw Error('Expected task panel');
  const [done,total]=target.quota.split('/').map(Number);if(done>=total)throw Error('Task quota exhausted');
  const matches=o.rows.filter(r=>identity(r)===identity(target));
  if(matches.length!==1||!same(matches[0],target))throw Error('Task missing or ambiguous');
  const b=matches[0].button.bounds;
  return this.dispatch(o,()=>this.opts.portal.tap(Math.round((b.left+b.right)/2),Math.round((b.top+b.bottom)/2)));
 }
}
