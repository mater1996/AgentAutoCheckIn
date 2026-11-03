import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
import {componentMatches} from './panel-claim.ts';
import type {DeviceFrame} from './device.ts';
const history='evidence/staged-2026-11-01T17-01-55-133Z/';
export const entryRecoverySource={status:'candidate',version:'entry-recovery-210-v1',sourceRunId:210,files:[
 {path:history+'68bb8b03-bd5d-48e3-b6f8-e64af551261c.png',sha256:'062f41a6171fab79c96e74bb5a52e786c94062f89ddbc4ea895efbafc3d3288a'},
 {path:history+'68bb8b03-bd5d-48e3-b6f8-e64af551261c.json',sha256:'00c4c463d0917c6094076feb0025565dd8af8bed4b863af6c120bcb56c90c074'},
 {path:history+'68bb8b03-bd5d-48e3-b6f8-e64af551261c.ocr.json',sha256:'5a545d51a2ae05d9b8ac1917a83f939ea3f7da7b1547aedcd252b8611f7d6491'},
 {path:history+'1f9cd4fe-0927-4a6a-90c9-e1f49d934c2b.png',sha256:'1c7646e9a17c4b88d4731bea5ca4bf97d7b215d58be1034da0df80eb9ae007d1'},
 {path:history+'1f9cd4fe-0927-4a6a-90c9-e1f49d934c2b.json',sha256:'5cc8a276e172217aec253b3f1cde53624eadf0965f0905481cc52ca119f48368'},
 {path:history+'1f9cd4fe-0927-4a6a-90c9-e1f49d934c2b.ocr.json',sha256:'4e41b2b244cd6aa7bff63df7239b96c93d2abffbb1b6c5ece44a79dd8e28df18'},
]} as const;
for(const file of entryRecoverySource.files)Object.freeze(file);
Object.freeze(entryRecoverySource.files);Object.freeze(entryRecoverySource);
const hash=(b:Buffer|string)=>createHash('sha256').update(b).digest('hex');
export const entryRecoveryManifestDigest=hash(JSON.stringify(entryRecoverySource));
const norm=(s:string)=>s.normalize('NFKC').replace(/\s/g,'');
const validLine=(l:any)=>typeof l?.text==='string'&&Array.isArray(l.bounds)&&l.bounds.length===4&&l.bounds.every(Number.isFinite)&&l.bounds[0]>=0&&l.bounds[1]>=0&&l.bounds[2]<=1080&&l.bounds[3]<=2400&&l.bounds[0]<l.bounds[2]&&l.bounds[1]<l.bounds[3];
const lines=(v:any)=>Array.isArray(v)&&v.length>0&&v.every(validLine);
const content=(f:any)=>f.lines.filter((l:any)=>l.bounds[3]>100);
const sameLines=(a:any[],b:any[])=>a.length===b.length&&a.every((l,i)=>l.text===b[i].text&&l.bounds.every((n:number,k:number)=>n===b[i].bounds[k]));
async function pixels(b:Buffer){const s=sharp(b,{failOn:'warning',limitInputPixels:1080*2400}),m=await s.metadata();if(m.format!=='png'||m.width!==1080||m.height!==2400||(m.pages??1)!==1)throw Error('Invalid PNG');return s.flatten({background:'#fff'}).removeAlpha().toColourspace('srgb').raw().toBuffer();}
/** Observation only, confined to run210's two complete campaign references. */
export async function inspectEntryRecovery(frame:DeviceFrame,owner:{package:string;userId:number},sourceRoot=new URL('../../',import.meta.url).pathname){
 try{
  if(owner?.package!=='com.taobao.taobao'||owner.userId!==0||frame?.package!==owner.package||frame.userId!==0||frame.width!==1080||frame.height!==2400||!frame.id?.trim()||!frame.path?.endsWith('.png')||frame.observationError||!Number.isSafeInteger(frame.capturedAt)||!lines(frame.lines))return null;
  const [png,jsonBytes,rawBytes]=await Promise.all([readFile(frame.path),readFile(frame.path.replace(/\.png$/,'.json')),readFile(frame.path.replace(/\.png$/,'.ocr.json'))]);
  const saved=JSON.parse(jsonBytes.toString()),raw=JSON.parse(rawBytes.toString()),page=raw.pages?.[0];
  if(['id','path','width','height','capturedAt','package','userId'].some(k=>saved[k]!== (frame as any)[k])||saved.observationError||!sameLines(frame.lines,saved.lines)||raw.engine!=='Apple Vision VNRecognizeTextRequest'||raw.pages.length!==1||page.file!==frame.path||page.width!==1080||page.height!==2400||!lines(page.lines)||!sameLines(frame.lines,page.lines))return null;
  // Join all raw lines so split risks such as 登 / 录 cannot escape the gate.
  if(/登录|登陆|验证|授权|允许|付款|支付|同意|确认|确定|取消|关闭|我知道了|温馨提示/.test(norm(page.lines.map((l:any)=>l.text).join(''))))return null;
  const skip=frame.lines.filter(l=>norm(l.text).includes('跳过'));
  const skipCount=norm(frame.lines.map(l=>l.text).join('')).split('跳过').length-1;
  if(skipCount!==1||skip.length!==1||skip[0].text!=='跳过'||skip[0].bounds.some((n,k)=>k<2?n<[850,110][k]:n>[1000,205][k-2]))return null;
  const sources=await Promise.all(entryRecoverySource.files.map(async f=>{const b=await readFile(join(sourceRoot,f.path));if(hash(b)!==f.sha256)throw Error('Entry source changed');return b;}));
  const actual=await pixels(png),current=content(frame);
  for(let i=0;i<sources.length;i+=3){
   const ref=JSON.parse(sources[i+1].toString()),refRaw=JSON.parse(sources[i+2].toString()),rp=refRaw.pages?.[0];
   if(ref.package!==owner.package||ref.userId!==0||ref.width!==1080||ref.height!==2400||refRaw.engine!==raw.engine||refRaw.pages.length!==1||rp.file!==ref.path||rp.width!==1080||rp.height!==2400||!sameLines(ref.lines,rp.lines))return null;
   const expected=content(ref),remaining=[...current];
   if(expected.length!==current.length)continue;
   let matches=true;
   for(const l of expected){const candidates=remaining.map((a,k)=>({a,k})).filter(({a})=>a.text===l.text&&a.bounds.every((n:number,k:number)=>Math.abs(n-l.bounds[k])<=5));if(candidates.length!==1){matches=false;break;}remaining.splice(candidates[0].k,1);}
   if(!matches||!componentMatches(await pixels(sources[i]),actual,[0,100,1080,2400]))continue;
   const b=skip[0].bounds;
   return {state:'known-launch-ad' as const,version:entryRecoverySource.version,frameId:frame.id,pngSha256:hash(png),frameJsonSha256:hash(jsonBytes),rawOcrSha256:hash(rawBytes),provenance:entryRecoverySource,action:{type:'tap' as const,x:Math.round((b[0]+b[2])/2),y:Math.round((b[1]+b[3])/2)}};
  }
  return null;
 }catch{return null;}
}
