import {readFile,mkdtemp,writeFile} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {tmpdir,homedir} from 'node:os';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import sharp from 'sharp';
import type {DeviceAction,DeviceFrame} from './device.ts';
import {componentMatches} from './panel-claim.ts';
import {splitOcrObservation,hasIdentityChallenge} from './observations.ts';
const history='evidence/staged-2026-11-01T12-38-29-524Z/';
const readOnlyHistory='evidence/entry-readonly-2026-11-01T18-19-01-962Z/';
export const activityNavigationSource={status:'candidate',version:'activity-navigation-198-home-components-v3',sourceRunId:198,
 readOnlyObservationSources:[{evidenceDir:readOnlyHistory,description:'Three read-only home observations after run212; not frames from run212, independent replay or live acceptance.',frameIds:['43b48497-68e2-4925-9d75-adca1a877c4d','f73180ca-3b8d-43d2-9098-06473cc7a1a5','3a0a1ac9-05ed-4c67-a014-52127a4d6ee7']}],files:[
 {path:history+'beac16b7-c76b-412f-8197-df8defaac7b6.png',sha256:'8cbd56fe4cf08c0ed18da96ee9e7005b0ec131db2136d86f0eb209a1894838d3'},
 {path:history+'beac16b7-c76b-412f-8197-df8defaac7b6.json',sha256:'fded6ec22e5870b6f47c9b75463a8647dab69fe70e6b6fc7f4d6654604256de7'},
 {path:history+'7af61f07-22ea-4a16-bfb8-e720119cd22e.png',sha256:'0fd528f37216996fc8b966a08fac239f4e9c63317b1a2c3759259ab73e90bc93'},
 {path:history+'7af61f07-22ea-4a16-bfb8-e720119cd22e.json',sha256:'32f17bba07a8f664fe4e4633a8fed116da903c57b067dbf24a06a0bc2711551a'},
 {path:readOnlyHistory+'43b48497-68e2-4925-9d75-adca1a877c4d.png',sha256:'3349e84f7eea46d8c9202445adf0012267160dbc4a0cfee23514d844ccb46f24'},
 {path:readOnlyHistory+'43b48497-68e2-4925-9d75-adca1a877c4d.json',sha256:'4c4b404f3e746228d6cf5941a377c9306ea18aeb96e655b4a4b3b69f147d5226'},
 {path:readOnlyHistory+'f73180ca-3b8d-43d2-9098-06473cc7a1a5.png',sha256:'31b0f3fcf1b992efc06b38ff7aff808ae025e469b38f6d72b56f2147035707c5'},
 {path:readOnlyHistory+'f73180ca-3b8d-43d2-9098-06473cc7a1a5.json',sha256:'c187988e0b045cb50199e2d1437b80fb6248a5f45968cd4eecd2687666fa1df2'},
 {path:readOnlyHistory+'3a0a1ac9-05ed-4c67-a014-52127a4d6ee7.png',sha256:'2d720a24b6ce19fad227c0fcc80955b465563e148e48b87d4a2f26a98ce74c7f'},
 {path:readOnlyHistory+'3a0a1ac9-05ed-4c67-a014-52127a4d6ee7.json',sha256:'9d5e4150f46201dfca16fec3ad68fd896fd2dab8cf34ae7bb58c711303340c20'},
]} as const;
export const activityPanelSource={status:'candidate',sourceRunId:195,sourceRunIds:[195,203,209],version:'panel-text-v4',
 policy:'Current-frame text and layout; historical files are documentation only, never pixel authorization.',files:[
 {path:'evidence/staged-2026-11-01T11-56-23-111Z/55b28a1a-f5f7-4939-9724-c478d02bf8ca.png',sha256:'2463e5d7b76ba37a100845f54ae2076f53a7da8bb44bb1df9ac4ae206e18183d'},
 {path:'evidence/staged-2026-11-01T11-56-23-111Z/55b28a1a-f5f7-4939-9724-c478d02bf8ca.json',sha256:'b85b81bda5da1905d5944555a29a9a04a7b3d68e85a03874ecde7138914b3e3e'},
 {path:'evidence/staged-2026-11-01T14-46-46-914Z/b1e5d975-9728-48db-adf6-4f777155f149.png',sha256:'1251924521582feb0588e9a2be641a2af7917db73f2f61cb38435befb7245242'},
 {path:'evidence/staged-2026-11-01T14-46-46-914Z/b1e5d975-9728-48db-adf6-4f777155f149.json',sha256:'7f9b1dc15aad7c805bd285142d1e81acf2e6ad8f16f202ccb21bfd6fae0c3868'},
 {path:'evidence/staged-2026-11-01T16-45-09-994Z/e80b88ec-0c1f-44c1-809d-907cc20963c4.png',sha256:'165014027a87aed51b59309d35cb6427214957a6f515cd589327958465c57ae0'},
 {path:'evidence/staged-2026-11-01T16-45-09-994Z/e80b88ec-0c1f-44c1-809d-907cc20963c4.json',sha256:'568678fe877538fdaa93a7c367cb2d92a311c3d37eff9c0e7bd4c727e9b70618'},
]} as const;
const landingHistory='evidence/staged-2026-11-01T13-18-06-815Z/';
export const activityLandingSource={status:'candidate',sourceRunId:200,version:'activity-navigation-200-landing-menu-v2',files:[
 {path:landingHistory+'ecf85474-b64c-4ad4-ac55-b38df98ef5f4.png',sha256:'a332124a1e9cc95173da062335301ae276c1c0316a934020fdbe2194e9a86fcc'},
 {path:landingHistory+'ecf85474-b64c-4ad4-ac55-b38df98ef5f4.json',sha256:'082ae2058e3d6fc061f58b9fc4116c226f890b052dc66d25cd04ab75e496afb0'},
]} as const;
export const activityRenderedLandingSource={status:'candidate',sourceRunId:201,sourceRunIds:[201,214],version:'activity-navigation-201-rendered-landing-menu-v3',files:[
 {path:'evidence/staged-2026-11-01T14-18-29-240Z/2ef5882b-2795-4d31-8d52-2fb3bf75c1f1.png',sha256:'c7a7db84aa6ed371d79a066a96dd4bd2567b272b15a10cc225b1e37e1357796c'},
 {path:'evidence/staged-2026-11-01T14-18-29-240Z/2ef5882b-2795-4d31-8d52-2fb3bf75c1f1.json',sha256:'2c4a514b337354daee7968e0cc0eda9790e7ba27940be966366f0e5262b27788'},
 {path:'evidence/staged-2026-11-01T14-18-29-240Z/a8841dac-538f-46f0-a381-5a1d143d01c5.png',sha256:'e313830c3e7ee6cd2e6599fd12445d2674486c5f46711b6e36b1d6b066be414e'},
 {path:'evidence/staged-2026-11-01T14-18-29-240Z/a8841dac-538f-46f0-a381-5a1d143d01c5.json',sha256:'24d8de807cec5ef47a22375e90a8a08ecc68bfa621f59df8053cbe5e41246442'},
 {path:'evidence/staged-2026-11-01T19-06-12-676Z/de799f1e-3112-400e-853d-9a5c6b72e4f9.png',sha256:'296f0512d2118daeaf82b3688ead6d26395b75e6cf81e4eb155b6910321fb115'},
 {path:'evidence/staged-2026-11-01T19-06-12-676Z/de799f1e-3112-400e-853d-9a5c6b72e4f9.json',sha256:'4199dff97227445af634e5d545d9d96d21a988e348000ae88fabb3baa46b8005'},
]} as const;
export const activityCurrentPanelSource={...activityPanelSource,version:'panel-visible-rows-v1',policy:'Current header-relative visible rows; incomplete edge rows carry no authority.'} as const;
type Owner={package:string;userId:number};
export type ChromeRefinement={frameId:string;sourceSha:string;roi:number[];scale:number;cropSha:string;path:string;rawPath:string;ocrSha:string;ocrPath:string;bounds:number[];elapsedMs:number;engine:string};
export type ActivityNavigationDependencies={exec?:(file:string,args:string[],options:{timeout:number;maxBuffer:number})=>Promise<unknown>};
export type MatchedHomeComponents={version:string;frameId:string;pngSha256:string;groups:{name:'chrome'|'coin-entry'|'bottom-navigation';rois:number[][];source:{png:{path:string;sha256:string};json:{path:string;sha256:string}}}[]};
export type ActivityNavigationInspection={state:'home'|'panel'|'landing';action?:DeviceAction;frameId:string;pngSha256:string;version:string;provenance:typeof activityNavigationSource|typeof activityPanelSource|typeof activityLandingSource|typeof activityRenderedLandingSource|typeof activityHomeTextSource|typeof activityLandingTextSource|typeof activityCurrentPanelSource|typeof activityCurrentHomeTextSource|typeof activityCurrentLandingTextSource|typeof activityCurrentPanelTextSource;chromeRefinement?:ChromeRefinement;matchedComponents?:MatchedHomeComponents};
const defaultExec=promisify(execFile);
const hash=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
async function pixels(bytes:Buffer){
 const image=sharp(bytes,{failOn:'warning',limitInputPixels:1080*2400});const m=await image.metadata();
 if(m.format!=='png'||m.width!==1080||m.height!==2400||(m.pages??1)!==1)throw Error('Invalid frame PNG');
 return image.flatten({background:'#fff'}).removeAlpha().toColourspace('srgb').raw().toBuffer();
}
const panelText=(text:string)=>text.normalize('NFKC').replace(/\s/g,'');
const validPanelLines=(value:unknown):value is DeviceFrame['lines']=>Array.isArray(value)&&value.length>0&&value.every(l=>typeof l?.text==='string'&&Array.isArray(l.bounds)&&l.bounds.length===4&&l.bounds.every(Number.isFinite)&&l.bounds[0]>=0&&l.bounds[1]>=0&&l.bounds[2]<=1080&&l.bounds[3]<=2400&&l.bounds[0]<l.bounds[2]&&l.bounds[1]<l.bounds[3]);
const panelRisk=(lines:DeviceFrame['lines'])=>lines.some(l=>/^(广告|关闭)$/.test(panelText(l.text)))||/登录|登陆|验证|授权|允许|温馨提示|确认|确定|取消|同意|我知道了|稍后再说|暂不/.test(panelText(lines.map(l=>l.text).join('')));
const inBox=(line:DeviceFrame['lines'][number],box:number[])=>line.bounds.every((n,k)=>k<2?n>=box[k]:n<=box[k]);
/** Text-only panel identity, derived from actual top and scrolled lists, not task names.
 * This does not detect icon occlusion or unchanged/stale OCR over changed pixels. */
function readablePanelLayout(lines:DeviceFrame['lines'],visibleRows=false):boolean{
 const titles=lines.filter(l=>panelText(l.text).includes('赚金币抵钱'));
 if(titles.length!==1||panelText(titles[0].text)!=='赚金币抵钱'
  ||!inBox(titles[0],[380,465,705,550])||titles[0].bounds[2]-titles[0].bounds[0]<260
  ||lines.some(l=>panelText(l.text)==='领淘金币'))return false;
 const rewards=lines.filter(l=>panelText(l.text)==='今日累计奖励');
 const progress=lines.filter(l=>panelText(l.text).startsWith('完成进度'));
 if(rewards.length||progress.length){
  if(rewards.length!==1||progress.length!==1||!inBox(rewards[0],[35,600,330,680])||!inBox(progress[0],[35,680,330,750]))return false;
  const quota=panelText(progress[0].text).match(/^完成进度(\d+)\/(\d+)$/);
  if(!quota||!Number.isSafeInteger(Number(quota[1]))||!Number.isSafeInteger(Number(quota[2]))||Number(quota[2])<=0||Number(quota[1])>Number(quota[2]))return false;
 }
 const allRows=lines.filter(l=>/^.+\(\d+\/\d+\)$/.test(panelText(l.text))).sort((a,b)=>a.bounds[1]-b.bounds[1]);
 const rowTop=visibleRows?(rewards.length?Math.max(titles[0].bounds[3],progress[0].bounds[3]):titles[0].bounds[3]):(rewards.length?770:575);
 const rowBottom=2285;
 const rows=visibleRows?allRows.filter(l=>l.bounds[1]>=rowTop&&l.bounds[3]<=rowBottom):allRows;
 if(rows.length<2||!rewards.length&&rows[0].bounds[1]>(visibleRows?rowTop+240:760))return false;
 let complete=0;
 for(let i=0;i<rows.length;i++){
  const row=rows[i],q=panelText(row.text).match(/\((\d+)\/(\d+)\)$/)!;
  if(!inBox(row,[210,rowTop,820,rowBottom])||row.bounds[3]-row.bounds[1]<25
   ||!Number.isSafeInteger(Number(q[1]))||!Number.isSafeInteger(Number(q[2]))||Number(q[2])<=0||Number(q[1])>Number(q[2])
   ||i>0&&(row.bounds[1]-rows[i-1].bounds[1]<150||row.bounds[1]-rows[i-1].bounds[1]>240))return false;
  const descriptions=lines.filter(l=>l!==row&&inBox(l,[210,row.bounds[3]+5,820,Math.min(2285,row.bounds[1]+125)])&&panelText(l.text).length>0);
  const buttons=lines.filter(l=>inBox(l,[850,row.bounds[1]+10,1040,Math.min(2285,row.bounds[1]+90)])&&/^(去完成|去逛逛|逛一逛|已完成|领取奖励)$/.test(panelText(l.text)));
  const readable=buttons.length===1&&descriptions.length>0;
  if(!readable&&row.bounds[1]<2160)return false;
  if(readable)complete++;
 }
 return complete>=2;
}
/** Offline observation-only candidate. Owner is a gate, never page identity.
 * Runtime retains freshness/consumption authority. Unknown activity/overlay returns null.
 * Only stable chrome and full entry icon/title components are learned; merchandise,
 * search query and the non-overlapping bottom coupon promotion are not identity.
 */
export async function inspectLearnedActivityNavigation(frame:DeviceFrame,owner:Owner,sourceRoot=new URL('../../',import.meta.url).pathname,deps:ActivityNavigationDependencies={},visibleRows=false):Promise<ActivityNavigationInspection|null>{
 const started=performance.now();
 try{
  if(owner?.package!=='com.taobao.taobao'||!Number.isSafeInteger(owner.userId)||owner.userId<0||frame?.package!==owner.package||frame.userId!==owner.userId
   ||frame.width!==1080||frame.height!==2400||!frame.id?.trim()||!frame.path||frame.observationError||!Number.isSafeInteger(frame.capturedAt)||!Array.isArray(frame.lines)||!frame.lines.length)return null;
  if(!frame.lines.every(l=>typeof l.text==='string'&&Array.isArray(l.bounds)&&l.bounds.length===4&&l.bounds.every(Number.isFinite)&&l.bounds[0]>=0&&l.bounds[1]>=0&&l.bounds[2]<=1080&&l.bounds[3]<=2400&&l.bounds[0]<l.bounds[2]&&l.bounds[1]<l.bounds[3]))return null;
  if(frame.lines.some(l=>/登录|登陆|验证|授权|允许|温馨提示|确认|取消|同意/.test(l.text)))return null;
  const marker=frame.lines.filter(l=>l.text==='赚金币抵钱');
  if(marker.length){
   if(!frame.path.endsWith('.png')||!readablePanelLayout(frame.lines,visibleRows)||panelRisk(frame.lines))return null;
   const [bytes,rawBytes]=await Promise.all([readFile(frame.path),readFile(frame.path.replace(/\.png$/,'.ocr.json'))]);
   const raw=JSON.parse(rawBytes.toString()),page=raw.pages?.[0];
   if(raw.engine!=='Apple Vision VNRecognizeTextRequest'||!Array.isArray(raw.pages)||raw.pages.length!==1
    ||page.file!==frame.path||page.width!==1080||page.height!==2400||!validPanelLines(page.lines)
    ||panelRisk(page.lines)||!readablePanelLayout(page.lines,visibleRows))return null;
   // Both raw and refined text must independently identify a readable list.
   // A refinement may correct a task name, never its quota or row position.
   if(frame.lines.length!==page.lines.length||frame.lines.some((l,i)=>{
    const original=page.lines[i];
    if(l.text===original.text)return l.bounds.some((n,k)=>Math.abs(n-original.bounds[k])>15);
    const quota=panelText(l.text).match(/\((\d+\/\d+)\)$/),rawQuota=panelText(original.text).match(/\((\d+\/\d+)\)$/);
    return !quota||!rawQuota||quota[1]!==rawQuota[1]||[0,1,3].some(k=>Math.abs(l.bounds[k]-original.bounds[k])>15);
   }))return null;
   await pixels(bytes); // Validate this PNG's format/dimensions; no reference pixels.
   const source=visibleRows?activityCurrentPanelSource:activityPanelSource;
   return {state:'panel',frameId:frame.id,pngSha256:hash(bytes),version:source.version,provenance:source};
  }
  const coinEntry=frame.lines.filter(l=>l.text==='去赚金币');
  if(coinEntry.length&&!frame.lines.some(l=>l.text==='领淘金币')){
   const normalized=(text:string)=>text.normalize('NFKC').replace(/\s/g,'');
   if(frame.lines.some(l=>/登录|登陆|验证|授权|允许|温馨提示|确认|确定|取消|同意|关闭|我知道了|稍后再说|暂不|^广告$/.test(normalized(l.text)))
    ||frame.lines.filter(l=>normalized(l.text)==='去赚金币').length!==1)return null;
   for(const source of [activityLandingSource,activityRenderedLandingSource]){
   const refs=await Promise.all(source.files.map(async f=>{const b=await readFile(join(sourceRoot,f.path));if(hash(b)!==f.sha256)throw Error('Landing source changed');return b;}));
   for(let index=0;index<refs.length;index+=2){
   const ref=JSON.parse(refs[index+1].toString()) as DeviceFrame;
   const identity=ref.lines.filter(l=>l.bounds[0]>=20&&l.bounds[2]<=195&&l.bounds[1]>=225&&l.bounds[3]<=285);
   if(identity.length!==1)continue;
   // The complete menu icon remains guarded by its original pixel ROI. OCR is
   // required to be exact and unique if present; missing icon text grants no tap.
   const required=[identity[0].text,...(frame.lines.some(l=>l.text==='•••')?['•••']:[]),'去赚金币'];
   if(required.some(t=>frame.lines.filter(l=>l.text===t).length!==1)||frame.lines.some(l=>l.text==='领淘金币'||l.text==='赚金币抵钱'))continue;
   if(!required.every(t=>{const a=frame.lines.find(l=>l.text===t)!,b=ref.lines.find(l=>l.text===t)!;return a.bounds.every((n,k)=>Math.abs(n-b.bounds[k])<=5);}))continue;
   const bytes=await readFile(frame.path),actual=await pixels(bytes),reference=await pixels(refs[index]);
   // Back/cart/audio/menu chrome, coin identity label, full coin icon/button and
   // Android navigation. Campaign title, counters, car/game art and merchandise
   // are deliberately outside identity; none authorizes a game or energy tap.
   const rois=[[15,115,110,205],[775,115,875,205],[880,115,975,205],[980,115,1065,205],[20,225,195,282],[0,885,235,1035],[0,2280,1080,2400]];
   // Icons are guarded by all seven pixel ROIs; OCR owns only text-bearing regions.
   const textRois=[[980,115,1065,205],[20,225,195,282],[0,885,235,1035]];
   if(frame.lines.some(l=>textRois.some(box=>l.bounds[0]<box[2]&&l.bounds[2]>box[0]&&l.bounds[1]<box[3]&&l.bounds[3]>box[1])
    &&!ref.lines.some(r=>r.text===l.text&&l.bounds.every((n,k)=>Math.abs(n-r.bounds[k])<=5))))continue;
   if(!rois.every(box=>componentMatches(reference,actual,box))||performance.now()-started>=2500)continue;
   const b=coinEntry[0].bounds;
   return {state:'landing',action:{type:'tap',x:Math.round((b[0]+b[2])/2),y:Math.round((b[1]+b[3])/2)},frameId:frame.id,pngSha256:hash(bytes),version:source.version,provenance:source};
   }
   }
   return null;
  }
  const required=['领淘金币','推荐','搜索','淘','消息','购物车','我的淘宝'];
  const missingTao=frame.lines.every(l=>l.text!=='淘');
  if(required.some(t=>frame.lines.filter(l=>l.text===t).length!==(t==='淘'&&missingTao?0:1)))return null;
  const sources=await Promise.all(activityNavigationSource.files.map(async f=>{const b=await readFile(join(sourceRoot,f.path));if(hash(b)!==f.sha256)throw Error('Source changed');return b;}));
  const bytes=await readFile(frame.path),actual=await pixels(bytes);
  let lines=frame.lines,chromeRefinement:ChromeRefinement|undefined;
  if(missingTao){
   // One fixed same-frame component and scale; never repair the raw OCR lines.
   const roi=[40,2160,165,2275],scale=2;
   const crop=await sharp(bytes).extract({left:40,top:2160,width:125,height:115}).resize(250,230).png().toBuffer();
   const dir=await mkdtemp(join(tmpdir(),'activity-chrome-')),path=join(dir,'tao.png'),rawPath=join(dir,'frame.png'),ocrPath=join(dir,'ocr.json');
   await Promise.all([writeFile(path,crop),writeFile(rawPath,bytes)]);
   const timeout=Math.min(1500,Math.floor(2500-(performance.now()-started)));if(timeout<=0)return null;
   const ocrStarted=performance.now();
   await (deps.exec??defaultExec)(join(homedir(),'.hermes/cache/scratch/checkin-apple-ocr'),[ocrPath,path],{timeout,maxBuffer:65536});
   if(performance.now()-ocrStarted>timeout||performance.now()-started>=2500)return null;
   if(hash(await readFile(path))!==hash(crop)||hash(await readFile(rawPath))!==hash(bytes)||hash(await readFile(frame.path))!==hash(bytes))return null;
   const raw=await readFile(ocrPath);if(raw.length>65536)return null;
   const ocr=JSON.parse(raw.toString()),page=ocr.pages?.[0];
   if(ocr.engine!=='Apple Vision VNRecognizeTextRequest'||ocr.pages.length!==1||page.file!==path||page.width!==250||page.height!==230||!Array.isArray(page.lines)||page.lines.length!==1)return null;
   const line=page.lines[0];
   if(line.text!=='淘'||!Array.isArray(line.bounds)||line.bounds.length!==4||!line.bounds.every(Number.isFinite)||line.bounds[0]<0||line.bounds[1]<0||line.bounds[2]>250||line.bounds[3]>230||line.bounds[0]>=line.bounds[2]||line.bounds[1]>=line.bounds[3])return null;
   const bounds=line.bounds.map((n:number,k:number)=>n/scale+roi[k%2]);
   lines=[...lines,{text:'淘',bounds}];
   chromeRefinement={frameId:frame.id,sourceSha:hash(bytes),roi,scale,cropSha:hash(crop),path,rawPath,ocrSha:hash(raw),ocrPath,bounds,elapsedMs:performance.now()-started,engine:ocr.engine};
  }
  // Preserve all eight ROIs and their original tile origins/edge denominators.
  // A group has ONE source; neither individual chrome ROIs nor tiles may pick sources.
  const rois=[[0,102,1080,215],[15,215,1065,239],[15,239,160,300],[755,239,1065,300],[15,300,1065,325],[770,330,965,525],[40,2160,165,2275],[475,2160,1050,2280]];
  const groups:{name:MatchedHomeComponents['groups'][number]['name'];rois:number[][]}[]=[
   {name:'chrome',rois:[rois[0],rois[1],rois[2],rois[3],rois[4],rois[6]]},
   {name:'coin-entry',rois:[rois[5]]},{name:'bottom-navigation',rois:[rois[7]]},
  ];
  const matches=new Map<string,MatchedHomeComponents['groups'][number]>();
  for(let index=0;index<sources.length;index+=2){
   const ref=JSON.parse(sources[index+1].toString()) as DeviceFrame;
   // Every used source must prove the same owner, dimensions and complete seven-anchor
   // layout as THIS frame, even when it only supplies a single component.
   if(ref.package!==frame.package||ref.userId!==frame.userId||ref.width!==frame.width||ref.height!==frame.height||ref.observationError||!Array.isArray(ref.lines))continue;
   if(!required.every(t=>{const a=lines.find(l=>l.text===t)!,bs=ref.lines.filter(l=>l.text===t);return bs.length===1&&Array.isArray(bs[0].bounds)&&bs[0].bounds.length===4&&bs[0].bounds.every(Number.isFinite)&&a.bounds.every((n,k)=>Math.abs(n-bs[0].bounds[k])<=5);}))continue;
   const reference=await pixels(sources[index]);
   for(const group of groups){
    if(matches.has(group.name)||!group.rois.every(box=>componentMatches(reference,actual,box)))continue;
    matches.set(group.name,{name:group.name,rois:group.rois.map(box=>[...box]),source:{png:{...activityNavigationSource.files[index]},json:{...activityNavigationSource.files[index+1]}}});
   }
   if(matches.size===groups.length)break;
  }
  if(matches.size!==groups.length||performance.now()-started>=2500)return null;
  const pngSha256=hash(bytes),b=lines.find(l=>l.text==='领淘金币')!.bounds;
  const matchedComponents:MatchedHomeComponents={version:activityNavigationSource.version,frameId:frame.id,pngSha256,groups:groups.map(g=>matches.get(g.name)!)};
  return {state:'home',action:{type:'tap',x:Math.round((b[0]+b[2])/2),y:Math.round((b[1]+b[3])/2)},frameId:frame.id,pngSha256,version:activityNavigationSource.version,provenance:activityNavigationSource,matchedComponents,...(chromeRefinement?{chromeRefinement}: {})};
 }catch{return null;}
}

export const activityHomeTextSource={status:'candidate',sourceRunId:198,version:'home-text-v1',
 policy:'Current PNG and same-file raw OCR; independent home anchors and relative entry layout. History documents origin only; no reference pixels authorize taps.',files:[]} as const;
export const activityLandingTextSource={status:'candidate',sourceRunId:200,version:'landing-text-v1',
 policy:'Current PNG and same-file raw OCR; explicit coin identity and relative landing component layout. History documents origin only; ambiguous OCR needs fresh evidence.',files:[]} as const;

/** Current observation candidate only. Runtime owns age, consumption and dispatch.
 * Raw OCR binding cannot detect every visual occlusion or OCR stale over changed pixels. */
export const activityCurrentHomeTextSource={...activityHomeTextSource,version:'home-text-v2',
 policy:'Current home context and unique unobscured coin entry; only relevant current boxes bind same-file raw OCR.'} as const;
export const activityCurrentLandingTextSource={...activityLandingTextSource,version:'landing-text-v2',
 policy:'Explicit current coin identity and unique unobscured list entry; no historical layout requirements.'} as const;
export const activityCurrentPanelTextSource={...activityCurrentPanelSource,version:'panel-visible-rows-v2',
 policy:'Current list title and at least one actual task row; unrelated OCR geometry and prose grant no action authority.'} as const;

/** Observation only. Runtime retains freshness, attempt and dispatch authority. */
export async function inspectCurrentActivityNavigation(frame:DeviceFrame,owner:Owner):Promise<ActivityNavigationInspection|null>{
 try{
  if(owner?.package!=='com.taobao.taobao'||!Number.isSafeInteger(owner.userId)||owner.userId<0
   ||frame?.package!==owner.package||frame.userId!==owner.userId||frame.width!==1080||frame.height!==2400
   ||!frame.id?.trim()||!frame.path?.endsWith('.png')||frame.observationError||!Number.isSafeInteger(frame.capturedAt)
   ||!Array.isArray(frame.lines)||!frame.lines.length)return null;
  const [bytes,rawBytes]=await Promise.all([readFile(frame.path),readFile(frame.path.replace(/\.png$/,'.ocr.json'))]);
  const raw=JSON.parse(rawBytes.toString()),page=raw.pages?.[0];
  if(raw.engine!=='Apple Vision VNRecognizeTextRequest'||!Array.isArray(raw.pages)||raw.pages.length!==1
   ||page.file!==frame.path||page.width!==frame.width||page.height!==frame.height||!Array.isArray(page.lines)||!page.lines.length)return null;
  const observations=[splitOcrObservation(frame.lines,frame.width,frame.height),splitOcrObservation(page.lines,frame.width,frame.height)];
  // Ordinary merchandise prose is not a barrier. Explicit challenges and visible
  // standalone notices still defer to the existing image/navigation fallback.
  if(observations.some(o=>hasIdentityChallenge(o.ocrObservation.texts.map(panelText))
   ||o.lines.some(l=>/^(温馨提示|我知道了|稍后再说|暂不|关闭|广告)$/.test(panelText(l.text)))))return null;
  const [lines,originals]=observations.map(o=>o.lines);
  const unique=(text:string)=>{
   if(observations.some(o=>o.ocrObservation.texts.filter(t=>panelText(t)===text).length!==1))return undefined;
   const line=lines.find(l=>panelText(l.text)===text),original=originals.find(l=>panelText(l.text)===text);
   return line&&original&&line.text===original.text&&line.bounds.every((n,k)=>n===original.bounds[k])?line:undefined;
  };
  const unobscured=(target:DeviceFrame['lines'][number])=>[lines,originals].every(context=>context.filter(l=>
   l.bounds[0]<target.bounds[2]&&l.bounds[2]>target.bounds[0]&&l.bounds[1]<target.bounds[3]&&l.bounds[3]>target.bounds[1]).length===1);
  await pixels(bytes);
  if(observations.some(o=>o.ocrObservation.texts.some(t=>panelText(t).includes('赚金币抵钱')))){
   const title=unique('赚金币抵钱');
   if(!title||[lines,originals].some(context=>context.some(l=>l!==context.find(n=>panelText(n.text)==='赚金币抵钱')
    &&!/^.+\(\d+\/\d+\)$/.test(panelText(l.text))&&l.bounds[0]<title.bounds[2]&&l.bounds[2]>title.bounds[0]
    &&l.bounds[1]<title.bounds[3]&&l.bounds[3]>title.bounds[1]))
    ||observations.some(o=>o.ocrObservation.texts.some(t=>panelText(t)==='领淘金币')))return null;
   const readable=(context:DeviceFrame['lines'])=>{
    const rows=context.filter(l=>l.bounds[1]>=title.bounds[3]&&/^.+\(\d+\/\d+\)$/.test(panelText(l.text))).sort((a,b)=>a.bounds[1]-b.bounds[1]);
    return rows.some((row,i)=>{
     const q=panelText(row.text).match(/\((\d+)\/(\d+)\)$/)!;
     if(!Number.isSafeInteger(Number(q[1]))||!Number.isSafeInteger(Number(q[2]))||Number(q[2])<=0||Number(q[1])>Number(q[2]))return false;
     const end=rows[i+1]?.bounds[1]??frame.height;
     const buttons=context.filter(l=>l.bounds[0]>=row.bounds[2]&&l.bounds[1]>=row.bounds[1]&&l.bounds[3]<=end
      &&/^(去完成|去逛逛|逛一逛|已完成|领取奖励)$/.test(panelText(l.text)));
     return buttons.length===1&&context.some(l=>l!==row&&l.bounds[1]>=row.bounds[3]&&l.bounds[3]<=end
      &&l.bounds[0]>=row.bounds[0]-15&&l.bounds[2]<=buttons[0].bounds[0]&&panelText(l.text).length>0);
    });
   };
   if(!readable(lines)||!readable(originals))return null;
   return {state:'panel',frameId:frame.id,pngSha256:hash(bytes),version:activityCurrentPanelTextSource.version,provenance:activityCurrentPanelTextSource};
  }
  const coin=unique('去赚金币'),entry=unique('领淘金币');
  if(coin&&!entry){
   const identity=unique('币淘金币')??unique('淘金币');
   if(!identity||!unobscured(identity)||!unobscured(coin))return null;
   return {state:'landing',action:{type:'tap',x:Math.round((coin.bounds[0]+coin.bounds[2])/2),y:Math.round((coin.bounds[1]+coin.bounds[3])/2)},
    frameId:frame.id,pngSha256:hash(bytes),version:activityCurrentLandingTextSource.version,provenance:activityCurrentLandingTextSource};
  }
  if(!entry||!unobscured(entry)||!(unique('推荐')||unique('首页'))||!unique('搜索'))return null;
  return {state:'home',action:{type:'tap',x:Math.round((entry.bounds[0]+entry.bounds[2])/2),y:Math.round((entry.bounds[1]+entry.bounds[3])/2)},
   frameId:frame.id,pngSha256:hash(bytes),version:activityCurrentHomeTextSource.version,provenance:activityCurrentHomeTextSource};
 }catch{return null;}
}

export async function inspectCurrentActivityNavigationV1(frame:DeviceFrame,owner:Owner):Promise<ActivityNavigationInspection|null>{
 try{
  if(owner?.package!=='com.taobao.taobao'||!Number.isSafeInteger(owner.userId)||owner.userId<0
   ||frame?.package!==owner.package||frame.userId!==owner.userId||frame.width!==1080||frame.height!==2400
   ||!frame.id?.trim()||!frame.path?.endsWith('.png')||frame.observationError||!Number.isSafeInteger(frame.capturedAt)
   ||!validPanelLines(frame.lines)||panelRisk(frame.lines))return null;
  // Guard the delegation: only the existing current-text panel branch can run.
  if(frame.lines.some(l=>panelText(l.text).includes('赚金币抵钱'))){
   if(frame.lines.filter(l=>l.text==='赚金币抵钱').length!==1)return null;
   const panel=await inspectLearnedActivityNavigation(frame,owner,undefined,{},true);
   return panel?.state==='panel'&&panel.version===activityCurrentPanelSource.version?panel:null;
  }
  const [bytes,rawBytes]=await Promise.all([readFile(frame.path),readFile(frame.path.replace(/\.png$/,'.ocr.json'))]);
  const raw=JSON.parse(rawBytes.toString()),page=raw.pages?.[0];
  if(raw.engine!=='Apple Vision VNRecognizeTextRequest'||!Array.isArray(raw.pages)||raw.pages.length!==1
   ||page.file!==frame.path||page.width!==frame.width||page.height!==frame.height||!validPanelLines(page.lines)
   ||panelRisk(page.lines))return null;
  await pixels(bytes);
  // Bind only navigation-bearing values/boxes to raw OCR. Refined merchandise
  // and task prose may differ; risks above still inspect every raw/refined line.
  const keyText=(text:string)=>['领淘金币','推荐','搜索','消息','购物车','我的淘宝','淘','视频','去赚金币','赚金币抵钱'].includes(panelText(text))
   ||/^币?淘金币$/.test(panelText(text));
  const keys=frame.lines.filter(l=>keyText(l.text)),rawKeys=(page.lines as DeviceFrame['lines']).filter(l=>keyText(l.text));
  if(keys.length!==rawKeys.length||new Set(keys.map(l=>panelText(l.text))).size!==keys.length||keys.some(l=>{
   const originals=rawKeys.filter(r=>panelText(r.text)===panelText(l.text));
   return originals.length!==1||l.text!==originals[0].text||l.bounds.some((n,k)=>n!==originals[0].bounds[k]);
  }))return null;
  const lines=frame.lines,w=frame.width,h=frame.height;
  const unobscured=(target:DeviceFrame['lines'][number])=>[lines,page.lines as DeviceFrame['lines']].every(context=>context.filter(l=>
   l.bounds[0]<target.bounds[2]&&l.bounds[2]>target.bounds[0]&&l.bounds[1]<target.bounds[3]&&l.bounds[3]>target.bounds[1]).length===1);
  const unique=(text:string)=>{const matches=lines.filter(l=>panelText(l.text)===text);return matches.length===1?matches[0]:undefined;};
  const coin=unique('去赚金币');
  if(coin&&!lines.some(l=>panelText(l.text)==='领淘金币'||panelText(l.text)==='赚金币抵钱')){
   // 200's raw "币淘金市" is ambiguous: never alias it into a readable identity.
   const identities=lines.filter(l=>/^币?淘金币$/.test(panelText(l.text)));
   if(identities.length!==1)return null;
   const identity=identities[0];
   if(!unobscured(identity)||!unobscured(coin)||!inBox(identity,[0,h*.07,w*.25,h*.22])
    ||!inBox(coin,[0,h*.25,w*.25,h*.6])||coin.bounds[1]-identity.bounds[3]<h*.15
    ||coin.bounds[1]-identity.bounds[3]>h*.45||coin.bounds[0]>=identity.bounds[2]||identity.bounds[0]>=coin.bounds[2])return null;
   const b=coin.bounds;
   return {state:'landing',action:{type:'tap',x:Math.round((b[0]+b[2])/2),y:Math.round((b[1]+b[3])/2)},frameId:frame.id,
    pngSha256:hash(bytes),version:activityLandingTextSource.version,provenance:activityLandingTextSource};
  }
  const entry=unique('领淘金币'),recommendation=unique('推荐'),search=unique('搜索');
  const bottom=['消息','购物车','我的淘宝'].map(unique);
  if(!entry||!recommendation||!search||bottom.some(l=>!l)||!unobscured(entry))return null;
  const nav=bottom as DeviceFrame['lines'];
  if(!inBox(recommendation,[0,h*.035,w*.6,h*.12])||!inBox(search,[w*.5,h*.06,w,h*.22])
   ||recommendation.bounds[3]>=search.bounds[1]||nav.some(l=>!inBox(l,[w*.35,h*.84,w,h*.96]))
   ||nav.some((l,i)=>i>0&&nav[i-1].bounds[2]>=l.bounds[0])
   ||Math.max(...nav.map(l=>l.bounds[1]))-Math.min(...nav.map(l=>l.bounds[1]))>h*.025
   ||!inBox(entry,[w*.02,search.bounds[3],w*.98,Math.min(h*.36,nav[0].bounds[1])])
   ||lines.some(l=>panelText(l.text)==='赚金币抵钱'))return null;
  const b=entry.bounds;
  return {state:'home',action:{type:'tap',x:Math.round((b[0]+b[2])/2),y:Math.round((b[1]+b[3])/2)},frameId:frame.id,
   pngSha256:hash(bytes),version:activityHomeTextSource.version,provenance:activityHomeTextSource};
 }catch{return null;}
}
