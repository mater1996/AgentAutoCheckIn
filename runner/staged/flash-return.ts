import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import type {DeviceFrame} from './device.ts';
const history='evidence/ocr-browse-2026-11-01T00-53-49-661Z/';
export const flashReturnSource={state:'candidate',sourceRunId:131,version:'flash-return-candidate-v1',files:[
 {path:history+'frame-15.png',sha256:'5056e2d45995900abb7ca09ec728fb0537084a21bef327e93eaedb2e24b25759'},
 {path:history+'frame-15.json',sha256:'78856e05b8d781fd8d199483fa4b38ed826a5a5e3944048cdd4b4bb24010aae8'},
 {path:history+'exit-modal-current.png',sha256:'f4333ef4adaac16f5eab84fa6e64436e37d21fb9a93a355f92362117fd95a833'},
 {path:history+'exit-modal-current.json',sha256:'621eed981a82ffcd264cdbad850f668501266cba7885f36b73f23ff1775f0ac8'},
]} as const;
const norm=(s:string)=>s.normalize('NFKC').replace(/\s/g,'');
/** Observation only: caller owns actual entry, receipt and one successful prior back.
 * Conservative exact historical layout candidate; changed artwork/OCR returns null.
 * Sources are immutable hash-pinned originals, never the mutable account bundle. */
export async function inspectFlashReturn(frame:DeviceFrame,owner:{package:string;userId:number},sourceRoot=new URL('../../',import.meta.url).pathname):Promise<{version:string}|null>{
 try{
  const now=Date.now();
  if(owner?.package!=='com.taobao.taobao'||!Number.isSafeInteger(owner.userId)||owner.userId<0||frame?.package!==owner.package||frame.userId!==owner.userId
   ||frame.width!==1080||frame.height!==2400||!frame.id?.trim()||frame.observationError||!Number.isSafeInteger(frame.capturedAt)||frame.capturedAt>now||now-frame.capturedAt>15000||!Array.isArray(frame.lines)||!frame.lines.length)return null;
  if(!frame.lines.every(l=>typeof l.text==='string'&&Array.isArray(l.bounds)&&l.bounds.length===4&&l.bounds.every(Number.isFinite)&&l.bounds[0]>=0&&l.bounds[1]>=0&&l.bounds[2]<=1080&&l.bounds[3]<=2400&&l.bounds[0]<l.bounds[2]&&l.bounds[1]<l.bounds[3]))return null;
  if(frame.lines.some(l=>/登录|验证码|安全验证|授权|允许访问|任务列表|赚金币抵钱/.test(norm(l.text))))return null;
  const bytes=await Promise.all(flashReturnSource.files.map(async file=>{
   const b=await readFile(path.join(sourceRoot,file.path));if(createHash('sha256').update(b).digest('hex')!==file.sha256)throw Error('Flash source changed');return b;
  }));
  const sharp=(await import('sharp')).default;
  const pixels=async(b:Buffer)=>{const img=sharp(b,{failOn:'warning',limitInputPixels:1080*2400}),m=await img.metadata();if(m.format!=='png'||m.width!==1080||m.height!==2400||(m.pages??1)!==1)throw Error('Invalid PNG');return img.removeAlpha().toColourspace('srgb').raw().toBuffer();};
  const actual=await pixels(await readFile(frame.path));
  for(const i of [0,2]){
   const lines=JSON.parse(bytes[i+1].toString()).pages[0].lines;
   const required=['确定要离开吗?','在这里订外卖,享更多优惠~','离开会场去看看','再逛逛','任务已完成','继续逛逛吧'];
   if(!required.every(text=>{const expected=lines.find((l:any)=>norm(l.text)===text),found=frame.lines.filter(l=>norm(l.text)===text);return expected&&found.length===1&&found[0].bounds.every((v,k)=>Math.abs(v-expected.bounds[k])<=8);}))continue;
   const ref=await pixels(bytes[i]);let matches=true;
   for(const [x1,y1,x2,y2] of [[25,130,610,205],[115,530,966,1730],[880,1755,1060,1915]]){
    for(let y=y1;y<y2&&matches;y+=16)for(let x=x1;x<x2&&matches;x+=16){let changed=0,count=0;
     for(let yy=y;yy<Math.min(y+16,y2);yy++)for(let xx=x;xx<Math.min(x+16,x2);xx++){const p=(yy*1080+xx)*3;if([0,1,2].some(k=>Math.abs(actual[p+k]-ref[p+k])>24))changed++;count++;}
     if(changed/count>.08)matches=false;
    }
   }
   if(matches)return {version:flashReturnSource.version};
  }
  return null;
 }catch{return null;}
}
