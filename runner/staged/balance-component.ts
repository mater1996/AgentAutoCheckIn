import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import type { DeviceExec, DeviceFrame } from './device.ts';

// Immutable original captures, not OCR-derived or rendered digit exemplars.
export const BALANCE_COMPONENT_SOURCES = [
  { path: 'evidence/staged-2026-11-01T11-56-23-111Z/55b28a1a-f5f7-4939-9724-c478d02bf8ca.png', sha256: '2463e5d7b76ba37a100845f54ae2076f53a7da8bb44bb1df9ac4ae206e18183d', value: 2155 },
  { path: 'evidence/staged-2026-11-01T11-46-47-689Z/25811c26-a30c-4e73-8c1e-9b726e81e9f4.png', sha256: '9d250232d021952bbc66c2d5717ea9561a7d3c6f679aca24a52c4e6c7bb29852', value: 2085 },
  { path: 'evidence/staged-2026-11-01T11-46-47-689Z/fdcbc6b8-2005-4d02-9534-ea9bd8a8d1a7.png', sha256: '30ed14f42c0adc831f848f0a788e2f4fba9de7ce98bd4b22da61be3f0677a940', value: 2135 },
  { path: 'evidence/staged-2026-11-01T11-50-22-744Z/a7aaab9d-c2e8-4ac3-b3a0-0340f2d849c0.png', sha256: '8a2a260a285c3cfd0bf09cf9609ae8951c2c907bf44b002459b56a01eefd4506', value: 2135 },
] as const;
const ROI = { left: 86, top: 238, width: 128, height: 70 } as const;
const CHROME = [{ left: 32, top: 250, width: 48, height: 54 }, { left: 214, top: 250, width: 24, height: 45 }, { left: 390, top: 472, width: 300, height: 70 }];
export const LEGACY_BALANCE_COMPONENT_VERSION = 'original-glyph-composition-v4';
export const BALANCE_COMPONENT_VERSION = 'ocr-region-v5';
// These source numbers label original pixel glyphs only; runtime never compares the whole value.
const EXTRA_SOURCES = [
 {path:'evidence/staged-2026-11-01T14-46-46-914Z/b1e5d975-9728-48db-adf6-4f777155f149.png',sha256:'1251924521582feb0588e9a2be641a2af7917db73f2f61cb38435befb7245242',value:2155},
 {path:'evidence/staged-2026-11-01T14-28-53-024Z/fe1dce16-9782-4b0e-a70f-87b0c82b8f09.png',sha256:'bb13541fde0147fb944bf1614dc128af50bc9463465cbb7d58c6d98f61758dcd',value:2155},
 {path:'evidence/staged-2026-11-01T07-57-48-797Z/5f8f972b-ec18-4fc7-a1d8-b80f2c2875e3.png',sha256:'a055114f3b25d8426abedc335b14e289e864751b0130393f563f19dc8d0cd816',value:1950},
 {path:'evidence/staged-2026-11-01T07-53-12-088Z/264e12d5-1c88-449f-8bd7-9aed931e3b2f.png',sha256:'73a521bf61490daea715910e43299a752c9127c994d07687f43d36620648ec68',value:1890},
 {path:'evidence/staged-2026-11-01T04-08-28-272Z/58a043b3-1538-4cb4-8708-d6543552394d.png',sha256:'9061a98fae18fe1fc1807a19fe86228f2beb80029d7ed043b1ae5906ae55f2e4',value:1580},
 {path:'evidence/staged-2026-11-01T04-08-28-272Z/21668a68-2dd6-4a69-a28f-6a80f920d091.png',sha256:'12f39c347954f0ea7dc6bf5153f9b415aad1e670163564a68e5a35c1f617923c',value:1600},
 {path:'evidence/staged-2026-11-01T07-49-31-673Z/e5fc457e-8c5e-47c9-82e0-90958d32e634.png',sha256:'b367a742fb78115b5852fc72af89632c6cd7b1cb1557b2155c6bb6bead807c91',value:1840},
 {path:'evidence/staged-2026-11-01T09-25-55-016Z/39249c8e-2a97-41d5-8cab-23213ed0cbf8.png',sha256:'5fcb314d7c52a3a6fecbf8fe5ecbd21ae9396af51c460bb82a0ecbcd88776673',value:1970},
];
type Region = {left:number;top:number;width:number;height:number};
function mask(p:Buffer,r:Region,kind='digit') {
 const out=Buffer.alloc(r.width*r.height);
 for(let y=0;y<r.height;y++)for(let x=0;x<r.width;x++){
  const i=((y+r.top)*1080+x+r.left)*3,[a,b,c]=p.subarray(i,i+3),lo=Math.min(a,b,c),hi=Math.max(a,b,c);
  out[y*r.width+x]=Number(kind==='title'?hi<100:kind==='coin'?a>160&&b>100&&c<100:lo>180&&hi-lo<25);
 }return out;
}
function splitDigits(p:Buffer) {
 const ink=mask(p,ROI),spans:Region[]=[];let start=-1;
 for(let x=0;x<=ROI.width;x++){
  let present=false;for(let y=0;y<ROI.height&&x<ROI.width;y++)if(ink[y*ROI.width+x])present=true;
  if(present&&start<0)start=x;
  if(!present&&start>=0){let top:number=ROI.height,bottom=0;for(let y=0;y<ROI.height;y++)for(let z=start;z<x;z++)if(ink[y*ROI.width+z]){top=Math.min(top,y);bottom=Math.max(bottom,y);}
   if(start<2||x>ROI.width-2||top<2||bottom>ROI.height-3)throw Error('Clipped digit pixels differ');
   spans.push({left:start+ROI.left,top:top+ROI.top,width:x-start,height:bottom-top+1});start=-1;
  }
 }
 if(spans.length!==4)throw Error('Four complete digit pixels differ');
 return spans.map(r=>({region:r,ink:mask(p,r)}));
}
const hash = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const root = new URL('../../', import.meta.url);
export type BalanceComponentInput = { executionPolicy?: 'development-unbounded-v1'; fullDeviceFrame: DeviceFrame; originalPNG: Buffer; evidenceDir: string; exec: DeviceExec; budgetMs?: number };
export type BalanceComponentResult = {
  status: 'accepted' | 'rejected'; value: number | null; reason?: string;
  sourcePngSha256: string; frameId: string; roi: typeof ROI; cropHash?: string;
  referencePngSha256?: string;
  ocrEvidence?: { path: string; sha256: string; cropPath: string; text: string; bounds: number[] };
  applicability: string; version: string;
  fullFrameOcrEvidence?: {path:string;sha256:string};
  referenceProvenance?: {path:string;sha256:string}[];
  glyphRecognition?: {text:string;glyphs:{digit:string;region:Region;referenceRegion:Region;referencePath:string;referencePngSha256:string}[]};
};
export const BALANCE_GLYPH_SOURCES = [...BALANCE_COMPONENT_SOURCES,...EXTRA_SOURCES];
/** Offline four-digit reader. Blank-column projection isolates complete digit ink.
 * Each normalized binary foreground must equal an original reference in both
 * directions; unknown or ambiguous shapes reject. Complete coin, arrow and title
 * foregrounds guard this measured layout. The fixed arrow bounds the right edge;
 * clipped digits reject. Other lengths, layouts, themes and scales are unsupported.
 * OCR is another algorithm on the same frame, not independent capture evidence.
 */
export async function readLegacyBalanceComponent(input: BalanceComponentInput): Promise<BalanceComponentResult> {
  const { fullDeviceFrame: f, originalPNG: bytes } = input;
  const result: BalanceComponentResult = { status: 'rejected', value: null, frameId: f.id, sourcePngSha256: hash(bytes), roi: ROI,
    version: LEGACY_BALANCE_COMPONENT_VERSION, applicability: '1080x2400 Taobao u0, four digits only; exact original foreground glyph composition plus same-frame strict integer OCR; unknown glyph/layout rejected.' };
  const started = performance.now(), budget = input.budgetMs ?? 5000;
  const remaining = () => Math.floor(budget - (performance.now() - started));
  const checkBudget = () => { if (remaining() <= 0) throw Error('Balance component timeout'); };
  try {
    if (!Number.isFinite(budget) || budget <= 0 || budget > 10000) throw Error('Invalid budget');
    if (!f.id || f.width !== 1080 || f.height !== 2400 || f.package !== 'com.taobao.taobao' || f.userId !== 0 || f.observationError) throw Error('Invalid owning frame');
    const markers = f.lines.filter(l => l.text === '赚金币抵钱');
    if (markers.length !== 1 || !Array.isArray(markers[0].bounds) || markers[0].bounds.length !== 4
      || markers[0].bounds.some((v, i) => !Number.isFinite(v) || Math.abs(v - [394, 478, 685, 538][i]) > 8)) throw Error('Missing or ambiguous owning marker');
    const decode = async (b: Buffer) => {
      const image = sharp(b, { failOn: 'warning', limitInputPixels: 1080 * 2400 });
      const m = await image.metadata();
      if (m.format !== 'png' || m.width !== 1080 || m.height !== 2400 || (m.pages ?? 1) !== 1) throw Error('Invalid original PNG');
      if (m.hasAlpha && (await sharp(b).stats()).isOpaque !== true) throw Error('Nonopaque original PNG');
      return image.removeAlpha().toColourspace('srgb').raw().toBuffer();
    };
    const pixels = await decode(bytes);
    const current=splitDigits(pixels), references:{source:typeof BALANCE_GLYPH_SOURCES[number];p:Buffer;digits:ReturnType<typeof splitDigits>}[]=[];
    for(const source of BALANCE_GLYPH_SOURCES) {
      checkBudget();const b=await readFile(new URL(source.path,root));
      if(hash(b)!==source.sha256)throw Error('Reference PNG hash mismatch');
      const p=await decode(b);references.push({source,p,digits:splitDigits(p)});
    }
    const chromeReference=references.find(ref=>CHROME.every((r,i)=>mask(pixels,r,['coin','digit','title'][i]).equals(mask(ref.p,r,['coin','digit','title'][i]))));
    if(!chromeReference)throw Error('Complete stable chrome pixels differ');
    const glyphs=current.map(g=>{
      const matches=references.flatMap(ref=>ref.digits.flatMap((d,i)=>d.region.width===g.region.width&&d.region.height===g.region.height&&d.ink.equals(g.ink)?[{digit:String(ref.source.value)[i],source:ref.source,region:d.region}]:[]));
      if(new Set(matches.map(m=>m.digit)).size!==1)throw Error('Unknown or ambiguous digit glyph pixels differ');
      return {digit:matches[0].digit,region:g.region,referenceRegion:matches[0].region,referencePngSha256:matches[0].source.sha256,referencePath:matches[0].source.path};
    });
    const recognized=glyphs.map(g=>g.digit).join('');
    result.glyphRecognition={text:recognized,glyphs};
    result.referenceProvenance=references.map(r=>({path:r.source.path,sha256:r.source.sha256}));
    const reference=chromeReference.source;
    checkBudget();
    await mkdir(input.evidenceDir, { recursive: true });
    const token = randomUUID(), cropPath = join(input.evidenceDir, token + '.balance.png'), output = join(input.evidenceDir, token + '.balance.ocr.json');
    // A fixed same-frame foreground separation improves local integer OCR.
    const ocrPixels=Buffer.from(Uint8Array.from(mask(pixels,ROI),v=>v?0:255));
    const crop = await sharp(ocrPixels,{raw:{width:ROI.width,height:ROI.height,channels:1}}).resize(ROI.width * 4, ROI.height * 4).png().toBuffer();
    result.cropHash = hash(crop);
    await writeFile(cropPath, crop, { flag: 'wx' });
    checkBudget();
    // The executor must honor timeoutMs and settle after draining its process.
    await input.exec('/Users/mater/.hermes/cache/scratch/checkin-apple-ocr', [output, cropPath], { timeoutMs: remaining() });
    checkBudget();
    const raw = await readFile(output), pages = JSON.parse(raw.toString()).pages;
    if (!Array.isArray(pages) || pages.length !== 1 || pages[0].file !== cropPath || pages[0].width !== 512 || pages[0].height !== 280 || !Array.isArray(pages[0].lines) || pages[0].lines.length !== 1) throw Error('Ambiguous crop OCR');
    const line = pages[0].lines[0], b = line.bounds;
    if (typeof line.text !== 'string' || !/^[0-9]+$/.test(line.text) || line.text.length !== 4 || !Number.isSafeInteger(Number(line.text)) || line.text !== recognized
      || !Array.isArray(b) || b.length !== 4 || !b.every(Number.isFinite) || b[0] < 4 || b[1] < 4 || b[2] > 508 || b[3] > 276 || b[0] >= b[2] || b[1] >= b[3]) throw Error('Unsafe integer, bounds or glyph/OCR disagreement');
    checkBudget();
    return { ...result, status: 'accepted', value: Number(line.text), referencePngSha256: reference.sha256,
      ocrEvidence: { path: output, sha256: hash(raw), cropPath, text: line.text, bounds: b } };
  } catch (error) { return { ...result, reason: error instanceof Error ? error.message : String(error) }; }
}

const TEXT_APPLICABILITY = '1080x2400 Taobao u0 panel; four complete digits in fixed ROI only; strict same-frame local OCR, no glyph/chrome templates; other capacities/layouts unsupported.';
const boundsValid = (b:any,w:number,h:number) => Array.isArray(b)&&b.length===4&&b.every(Number.isFinite)&&b[0]>=0&&b[1]>=0&&b[2]<=w&&b[3]<=h&&b[0]<b[2]&&b[1]<b[3];
/** Validate ownership and the original full-frame OCR in the amount region.
 * An attached arrow may be recognized in full OCR only; never strip arbitrary symbols.
 * Full-frame OCR is a conflict veto, not the value authority. */
export function validateBalanceTextFrame(f:Pick<DeviceFrame,'id'|'width'|'height'|'observationError'|'lines'>&{path?:string;package?:string;userId?:number}, fullRaw:any, text?:string):void {
 if(!f.id||!f.path||!f.path.endsWith('.png')||f.width!==1080||f.height!==2400||f.package!=='com.taobao.taobao'||f.userId!==0||f.observationError||!Array.isArray(f.lines))throw Error('Invalid owning frame');
 if(f.lines.some(l=>typeof l.text!=='string'||!boundsValid(l.bounds,1080,2400)))throw Error('Invalid full-frame OCR lines');
 const markers=f.lines.filter(l=>l.text==='赚金币抵钱');
 if(markers.length!==1||markers[0].bounds.some((v,i)=>Math.abs(v-[394,478,685,538][i])>8)||f.lines.some(l=>/登录|验证码|滑块验证|安全验证|请完成验证|授权/.test(l.text)))throw Error('Missing or ambiguous owning marker');
 const page=fullRaw?.pages?.[0];
 if(fullRaw?.engine!=='Apple Vision VNRecognizeTextRequest'||!Array.isArray(fullRaw.pages)||fullRaw.pages.length!==1||page.file!==f.path||page.width!==1080||page.height!==2400||!Array.isArray(page.lines))throw Error('Invalid original full-frame OCR');
 const relevant=(lines:any[])=>lines.filter(l=>l.text==='赚金币抵钱'||boundsValid(l.bounds,1080,2400)&&l.bounds[0]<214&&l.bounds[2]>86&&l.bounds[1]<308&&l.bounds[3]>238).map(l=>({text:l.text,bounds:l.bounds}));
 if(JSON.stringify(relevant(page.lines))!==JSON.stringify(relevant(f.lines)))throw Error('Original full-frame OCR differs');
 const amount=relevant(f.lines).filter(l=>l.text!=='赚金币抵钱');
 if(amount.length!==1)throw Error('Missing or conflicting full-frame amount');
 const l=amount[0],match=/^([1-9][0-9]{3})([>›]?)$/.exec(l.text),b=l.bounds;
 if(!match||b[0]<86||b[0]>110||b[1]<238||b[3]>308||b[2]>242||match[2]&&b[2]<214||!match[2]&&b[2]>214||text!==undefined&&match[1]!==text)throw Error('Unsafe integer or full-frame OCR conflict/capacity');
}

/** Strict single whole positive integer; no normalization or numeric substring parsing. */
export function validateBalanceCropOCR(raw:any,cropPath:string):{text:string;bounds:number[]} {
 const p=raw?.pages?.[0],l=p?.lines?.[0],b=l?.bounds;
 if(raw?.engine!=='Apple Vision VNRecognizeTextRequest'||!Array.isArray(raw.pages)||raw.pages.length!==1||p.file!==cropPath||p.width!==512||p.height!==280||!Array.isArray(p.lines)||p.lines.length!==1
  ||typeof l.text!=='string'||!/^[1-9][0-9]{3}$/.test(l.text)||!Number.isSafeInteger(Number(l.text))||!boundsValid(b,512,280)||b[0]<4||b[1]<4||b[2]>508||b[3]>276)throw Error('Unsafe integer, capacity or crop OCR bounds');
 return {text:l.text,bounds:b};
}

/** Recompute fixed same-frame mask crop and capacity/edge completeness, without templates. */
export async function balanceTextCrop(bytes:Buffer):Promise<Buffer> {
 const image=sharp(bytes,{failOn:'warning',limitInputPixels:1080*2400}),m=await image.metadata();
 if(m.format!=='png'||m.width!==1080||m.height!==2400||(m.pages??1)!==1||m.hasAlpha&&(await sharp(bytes).stats()).isOpaque!==true)throw Error('Invalid original PNG');
 const pixels=await image.removeAlpha().toColourspace('srgb').raw().toBuffer();
 // Projection is only an edge/capacity check, never a digit identity comparison.
 splitDigits(pixels);
 const ink=Buffer.from(Uint8Array.from(mask(pixels,ROI),v=>v?0:255));
 return sharp(ink,{raw:{width:ROI.width,height:ROI.height,channels:1}}).resize(512,280).png().toBuffer();
}

/** Current live reader. Historical v4 is available only through its explicit legacy API. */
export async function readBalanceComponent(input:BalanceComponentInput):Promise<BalanceComponentResult> {
 const f=input.fullDeviceFrame,result:BalanceComponentResult={status:'rejected',value:null,frameId:f.id,sourcePngSha256:hash(input.originalPNG),roi:ROI,version:BALANCE_COMPONENT_VERSION,applicability:TEXT_APPLICABILITY};
 const unbounded=input.executionPolicy==='development-unbounded-v1';
 const started=performance.now(),budget=input.budgetMs??5000;
 const remaining=()=>Math.floor(budget-(performance.now()-started));
 const check=()=>{if(!unbounded&&remaining()<=0)throw Error('Balance component timeout');};
 try {
  if(!unbounded&&(!Number.isFinite(budget)||budget<=0||budget>10000))throw Error('Invalid budget');
  const fullPath=f.path.replace(/\.png$/,'.ocr.json'),fullBytes=await readFile(fullPath),fullRaw=JSON.parse(fullBytes.toString());
  validateBalanceTextFrame(f,fullRaw);
  if(!input.originalPNG.equals(await readFile(f.path)))throw Error('Owning PNG differs');
  result.fullFrameOcrEvidence={path:fullPath,sha256:hash(fullBytes)};
  const crop=await balanceTextCrop(input.originalPNG);check();
  await mkdir(input.evidenceDir,{recursive:true});
  const token=randomUUID(),cropPath=join(input.evidenceDir,token+'.balance.png'),output=join(input.evidenceDir,token+'.balance.ocr.json');
  result.cropHash=hash(crop);await writeFile(cropPath,crop,{flag:'wx'});check();
  await input.exec('/Users/mater/.hermes/cache/scratch/checkin-apple-ocr',[output,cropPath],{timeoutMs:unbounded?60000:remaining()});check();
  if(!(await readFile(cropPath)).equals(crop))throw Error('OCR crop changed');
  const raw=await readFile(output),line=validateBalanceCropOCR(JSON.parse(raw.toString()),cropPath);
  validateBalanceTextFrame(f,fullRaw,line.text);check();
  return {...result,status:'accepted',value:Number(line.text),ocrEvidence:{path:output,sha256:hash(raw),cropPath,...line}};
 }catch(error){return {...result,reason:error instanceof Error?error.message:String(error)};}
}
