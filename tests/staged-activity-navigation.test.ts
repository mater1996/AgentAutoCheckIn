import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, mkdtemp, writeFile, mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join,dirname} from 'node:path';
import sharp from 'sharp';
import {inspectLearnedActivityNavigation, activityNavigationSource, activityLandingSource} from '../runner/staged/activity-navigation.ts';
const dir='evidence/staged-2026-11-01T12-38-29-524Z/';
const ids=['beac16b7-c76b-412f-8197-df8defaac7b6','7af61f07-22ea-4a16-bfb8-e720119cd22e'];
async function load(id=ids[0]) {return JSON.parse(await readFile(dir+id+'.json','utf8'));}
const owner={package:'com.taobao.taobao',userId:0};
const landingDir='evidence/staged-2026-11-01T13-18-06-815Z/';
const landingId='ecf85474-b64c-4ad4-ac55-b38df98ef5f4';
async function loadLanding(){return JSON.parse(await readFile(landingDir+landingId+'.json','utf8'));}
test('real 200 landing proposes only the unique current coin navigation',async()=>{
 const f=await loadLanding(),before=JSON.stringify(f);
 const r=await inspectLearnedActivityNavigation(f,owner,undefined,{exec:async()=>{throw Error('landing must not refine OCR');}});
 assert.equal(r?.state,'landing');
 const b=f.lines.find((l:any)=>l.text==='去赚金币').bounds;
 assert.deepEqual(r?.action,{type:'tap',x:Math.round((b[0]+b[2])/2),y:Math.round((b[1]+b[3])/2)});
 assert.equal(r?.frameId,f.id);assert.equal(r?.chromeRefinement,undefined);
 assert.equal(r?.provenance.sourceRunId,200);assert.equal(r?.provenance.files.length,2);
 assert.equal(JSON.stringify(f),before);
});
test('real 201 fully rendered landing matches original pixels without OCR aliases',async()=>{
 for(const id of ['a8841dac-538f-46f0-a381-5a1d143d01c5','2ef5882b-2795-4d31-8d52-2fb3bf75c1f1']){
  const f=JSON.parse(await readFile('evidence/staged-2026-11-01T14-18-29-240Z/'+id+'.json','utf8'));
  const r=await inspectLearnedActivityNavigation(f,owner);assert.equal(r?.state,'landing');assert.deepEqual(r?.action,{type:'tap',x:115,y:998});
  assert.equal(await inspectLearnedActivityNavigation(await edited(f,[0,885,235,1035]),owner),null);
 }
});
test('real 205 system navigation OCR variation retains exact pixel authority',async()=>{
 const f=JSON.parse(await readFile('evidence/staged-2026-11-01T15-13-15-888Z/978bb211-fdf4-484b-98a2-a4fe75f68e94.json','utf8'));
 assert.ok(f.lines.some((l:any)=>l.text==='三'&&l.bounds[1]>2280));
 assert.equal((await inspectLearnedActivityNavigation(f,owner))?.state,'landing');
 assert.equal(await inspectLearnedActivityNavigation(await edited(f,[0,2280,1080,2400]),owner),null);
});
test('real 206 icon OCR variation retains full unchanged chrome pixel checks',async()=>{
 const f=JSON.parse(await readFile('evidence/staged-2026-11-01T15-16-32-943Z/5788b3d7-172a-46c5-b9ad-16497acbcb7f.json','utf8'));
 assert.equal((await inspectLearnedActivityNavigation(f,owner))?.state,'landing');
 assert.equal(await inspectLearnedActivityNavigation(await edited(f,[15,115,110,205]),owner),null);
});
test('home keeps its existing contract when merchandise mentions the landing coin label',async()=>{
 const f=await load();f.lines.push({text:'去赚金币',bounds:[400,1500,650,1550]});
 const r=await inspectLearnedActivityNavigation(f,owner);assert.equal(r?.state,'home');
 assert.equal(r?.version,activityNavigationSource.version);
});
test('landing rejects a dismissible overlay anywhere in full OCR context',async()=>{
 const f=await loadLanding();f.lines.push({text:'我知道了',bounds:[400,1500,680,1600]});
 assert.equal(await inspectLearnedActivityNavigation(f,owner),null);
});
test('landing rejects normalized duplicate coin labels rather than choosing exact text',async()=>{
 const f=await loadLanding();f.lines.push({text:'去赚 金币',bounds:[400,900,680,950]});
 assert.equal(await inspectLearnedActivityNavigation(f,owner),null);
});
test('landing rejects additional OCR crossing the protected coin component',async()=>{
 const f=await loadLanding();f.lines.push({text:'继续',bounds:[10,920,200,970]});
 assert.equal(await inspectLearnedActivityNavigation(f,owner),null);
});
const dir199='evidence/staged-2026-11-01T12-48-57-664Z/';
const ids199=['31fc0e2c-e563-45ba-a0e2-fc3bb4b29c9f','11e3c401-c043-4db0-a3ce-e97948a31973'];
async function load199(index=0){return JSON.parse(await readFile(dir199+ids199[index]+'.json','utf8'));}
test('real 199 home accepts changed live promotion and regenerates current entry',async()=>{
 const f=await load199();const r=await inspectLearnedActivityNavigation(f,owner);
 assert.equal(r?.state,'home');assert.deepEqual(r?.action,{type:'tap',x:862,y:487});
});
test('real 199 missing tao is recovered from the same PNG without mutating raw observation',async()=>{
 const f=await load199(1),before=JSON.stringify(f),start=performance.now();
 const r=await inspectLearnedActivityNavigation(f,owner);
 assert.equal(r?.state,'home');assert.deepEqual(r?.action,{type:'tap',x:862,y:487});
 assert.equal(JSON.stringify(f),before);assert.ok(performance.now()-start<2500);
 const proof=(r as any).chromeRefinement;assert.equal(proof.frameId,f.id);assert.equal(proof.sourceSha,r?.pngSha256);
 assert.deepEqual(proof.roi,[40,2160,165,2275]);assert.equal(proof.scale,2);
 const {createHash}=await import('node:crypto');const hash=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
 assert.equal(hash(await readFile(proof.path)),proof.cropSha);assert.equal(hash(await readFile(proof.ocrPath)),proof.ocrSha);
 assert.equal(hash(await readFile(proof.rawPath)),proof.sourceSha);assert.ok(!proof.path.includes('/evidence/'));
});
async function edited(f:any,box:number[]){
 const path=(await mkdtemp('/Users/mater/.hermes/cache/scratch/nav198-'))+'/frame.png';
 await sharp(f.path).composite([{input:await sharp({create:{width:box[2]-box[0],height:box[3]-box[1],channels:3,background:'#777'}}).png().toBuffer(),left:box[0],top:box[1]}]).png().toFile(path);return {...f,path};
}
for(const [name,box] of [
 ['tao component',[40,2160,165,2275]],['messages',[475,2160,620,2280]],['cart',[700,2160,840,2280]],
 ['entry edge',[770,330,790,525]],
] as const)test(`199 rejects stale OCR over ${name}`,async()=>{
 assert.equal(await inspectLearnedActivityNavigation(await edited(await load199(),[...box]),owner),null);
});
for(const mode of ['unknown','double','wrong-bounds','alias','wrong-file','tampered-crop','tampered-raw','timeout','elapsed','covered'])test(`same-frame tao refinement rejects ${mode}`,async()=>{
 let f=await load199(1);if(mode==='covered')f=await edited(f,[40,2160,165,2275]);
 const original=JSON.stringify(f);
 const exec=async(_file:string,args:string[],options:{timeout:number})=>{
  assert.ok(options.timeout>0&&options.timeout<=1500);
  if(mode==='timeout')throw Error('timeout');
  if(mode==='elapsed')await new Promise(resolve=>setTimeout(resolve,1510));
  const line={text:'淘',bounds:[60,52,196,166]};let lines:any[]=[line];
  if(mode==='unknown')lines=[];if(mode==='double')lines=[line,line];if(mode==='alias')line.text='掏';
  if(mode==='wrong-bounds')line.bounds=[100,52,220,166];
  if(mode==='tampered-crop')await writeFile(args[1],'tamper');
  if(mode==='tampered-raw')await writeFile(args[1].replace('tao.png','frame.png'),'tamper');
  await writeFile(args[0],JSON.stringify({engine:'Apple Vision VNRecognizeTextRequest',pages:[{file:mode==='wrong-file'?'other.png':args[1],width:250,height:230,lines}]}));
 };
 assert.equal(await inspectLearnedActivityNavigation(f,owner,undefined,{exec}),null);assert.equal(JSON.stringify(f),original);
});
for(const mode of ['owner','package','duplicate','shift','wrong-page','login','verification','missing-search','bad-bounds','observation-error'])test(`rejects ${mode}`,async()=>{
 const f=await load();
 if(mode==='owner')f.userId=999;
 if(mode==='package')f.package='com.other';
 if(mode==='duplicate')f.lines.push(structuredClone(f.lines.find((l:any)=>l.text==='领淘金币')));
 if(mode==='shift')f.lines.find((l:any)=>l.text==='领淘金币').bounds[0]+=100;
 if(mode==='wrong-page')f.lines=f.lines.filter((l:any)=>l.text==='领淘金币');
 if(mode==='login'||mode==='verification')f.lines.push({text:mode==='login'?'请登录':'安全验证',bounds:[10,700,300,800]});
 if(mode==='missing-search')f.lines=f.lines.filter((l:any)=>l.text!=='搜索');
 if(mode==='bad-bounds')f.lines[0].bounds=[0,0,NaN,5];
 if(mode==='observation-error')f.observationError='capture failed';
 assert.equal(await inspectLearnedActivityNavigation(f,owner),null);
});
for(const [name,box] of [
 ['dialog-over-entry',[770,330,965,525]],['same-OCR title covered',[790,467,938,507]],
 ['icon covered',[800,340,930,445]],['recommendation covered',[180,120,300,195]],
 ['search covered',[890,240,1000,300]],['bottom navigation covered',[900,2150,1040,2280]],
] as const)test(`rejects stale OCR when ${name}`,async()=>{
 assert.equal(await inspectLearnedActivityNavigation(await edited(await load(),[...box]),owner),null);
});
test('merchandise change does not bind home identity',async()=>{
 const f=await edited(await load(),[10,650,1060,2050]);
 f.lines=f.lines.filter((l:any)=>l.bounds[1]<650||l.bounds[1]>=2050);
 assert.equal((await inspectLearnedActivityNavigation(f,owner))?.state,'home');
});
test('action is regenerated from current bounds within learned OCR jitter',async()=>{
 const f=await load();const l=f.lines.find((l:any)=>l.text==='领淘金币');l.bounds=l.bounds.map((n:number)=>n+2);
 const r=await inspectLearnedActivityNavigation(f,owner);assert.equal(r?.action?.x,866);assert.equal(r?.action?.y,489);
});
test('source tampering rejects rather than relearning',async()=>{
 const root=await mkdtemp('/Users/mater/.hermes/cache/scratch/nav198-source-');
 const {mkdir}=await import('node:fs/promises');
 for(const ref of activityNavigationSource.files){const dest=root+'/'+ref.path;await mkdir(dest.slice(0,dest.lastIndexOf('/')),{recursive:true});await writeFile(dest,await readFile(ref.path));}
 await writeFile(root+'/'+activityNavigationSource.files[1].path,'{}');
 assert.equal(await inspectLearnedActivityNavigation(await load(),owner,root),null);
});
for(const mode of ['normal','covered','duplicate','text-only'])test(`real task panel arrival ${mode}`,async()=>{
 let f=JSON.parse(await readFile('evidence/staged-2026-11-01T11-56-23-111Z/55b28a1a-f5f7-4939-9724-c478d02bf8ca.json','utf8'));
 if(mode==='covered')f=await edited(f,[380,468,700,550]);
 if(mode==='duplicate')f.lines.push(structuredClone(f.lines.find((l:any)=>l.text==='赚金币抵钱')));
 if(mode==='text-only')f.path=(await load()).path;
 const r=await inspectLearnedActivityNavigation(f,owner);if(mode==='normal'){assert.equal(r?.state,'panel');assert.equal(r?.action,undefined);}else assert.equal(r,null);
});
for(const [name,box] of [
 ['back',[15,115,110,205]],['cart',[775,115,875,205]],['audio',[880,115,975,205]],['menu',[980,115,1065,205]],
 ['coin identity',[20,225,195,282]],['full coin button',[0,885,235,1035]],['coin icon',[60,900,150,965]],
 ['coin label',[35,970,195,1025]],['coin left edge',[0,885,18,1035]],['coin right edge',[217,885,235,1035]],
 ['coin top edge',[0,885,235,901]],['coin bottom edge',[0,1019,235,1035]],['system navigation',[0,2280,1080,2400]],
] as const)test(`landing rejects stale OCR over ${name}`,async()=>{
 assert.equal(await inspectLearnedActivityNavigation(await edited(await loadLanding(),[...box]),owner),null);
});
for(const mode of ['wrong-owner','wrong-package','wrong-owner-input','invalid-owner','observation-error','malformed-bounds',
 'duplicate','missing-identity','text-only','wrong-image','wrong-bounds','central-game-bounds','energy-bounds','alias',
 'conflicting-home','conflicting-panel'])test(`landing rejects ${mode}`,async()=>{
 const f=await loadLanding(),coin=f.lines.find((l:any)=>l.text==='去赚金币');let o=owner;
 if(mode==='wrong-owner')f.userId=999;
 if(mode==='wrong-package')f.package='com.other';
 if(mode==='wrong-owner-input')o={...owner,userId:999};
 if(mode==='invalid-owner')o={...owner,userId:-1};
 if(mode==='observation-error')f.observationError='capture failed';
 if(mode==='malformed-bounds')coin.bounds=[0,900,NaN,1000];
 if(mode==='duplicate')f.lines.push(structuredClone(coin));
 if(mode==='missing-identity')f.lines=f.lines.filter((l:any)=>l.text!=='币淘金市');
 if(mode==='text-only')f.lines=[coin];
 if(mode==='wrong-image')f.path=(await load()).path;
 if(mode==='wrong-bounds')coin.bounds=coin.bounds.map((n:number)=>n+6);
 if(mode==='central-game-bounds')coin.bounds=[...f.lines.find((l:any)=>l.text==='升级赛车拿钱').bounds];
 if(mode==='energy-bounds')coin.bounds=[...f.lines.find((l:any)=>l.text==='去赚能量').bounds];
 if(mode==='alias')coin.text='去赚金市';
 if(mode==='conflicting-home'||mode==='conflicting-panel')f.lines.push({text:mode==='conflicting-home'?'领淘金币':'赚金币抵钱',bounds:[400,500,700,550]});
 assert.equal(await inspectLearnedActivityNavigation(f,o),null);
});
test('landing missing menu OCR still requires intact full menu pixel guard',async()=>{
 const f=await loadLanding();f.lines=f.lines.filter((l:any)=>l.text!=='•••');
 assert.equal((await inspectLearnedActivityNavigation(f,owner))?.state,'landing');
 assert.equal(await inspectLearnedActivityNavigation(await edited(f,[980,115,1065,205]),owner),null);
});
for(const text of ['请登录','安全验证','请求授权','允 许','温馨提示','确定','取消','同意','关闭','暂不','稍后再说','广告'])test(`landing rejects full-context safety marker ${text}`,async()=>{
 const f=await loadLanding();f.lines.push({text,bounds:[400,1800,680,1850]});
 assert.equal(await inspectLearnedActivityNavigation(f,owner),null);
});
test('landing regenerates tap from current coin bounds within unchanged five-pixel tolerance',async()=>{
 const f=await loadLanding(),coin=f.lines.find((l:any)=>l.text==='去赚金币');coin.bounds=coin.bounds.map((n:number)=>n+5);
 const r=await inspectLearnedActivityNavigation(f,owner);assert.equal(r?.state,'landing');
 assert.deepEqual(r?.action,{type:'tap',x:Math.round((coin.bounds[0]+coin.bounds[2])/2),y:Math.round((coin.bounds[1]+coin.bounds[3])/2)});
 assert.ok(r!.action!.x!<235);assert.ok(r!.action!.y!>=885&&r!.action!.y!<1035);
});
for(const [name,box] of [
 ['campaign title',[125,115,765,205]],['counters',[200,225,1060,420]],['car theme',[0,425,1080,880]],
 ['central game',[245,885,875,1035]],['energy invitation',[880,780,1080,1035]],['promotion and merchandise',[0,1045,1080,2280]],
] as const)test(`synthetic landing ${name} change is not page identity or game authorization`,async()=>{
 const f=await edited(await loadLanding(),[...box]);
 f.lines=f.lines.filter((l:any)=>!(l.bounds[0]<box[2]&&l.bounds[2]>box[0]&&l.bounds[1]<box[3]&&l.bounds[3]>box[1]));
 const r=await inspectLearnedActivityNavigation(f,owner);assert.equal(r?.state,'landing');assert.deepEqual(r?.action,{type:'tap',x:115,y:998});
});
for(const mode of ['intact','png-tampered','json-tampered','missing'])test(`landing sourceRoot isolated provenance ${mode}`,async()=>{
 const root=await mkdtemp('/Users/mater/.hermes/cache/scratch/nav200-source-');
 for(const ref of activityLandingSource.files){
  const bytes=await readFile(ref.path);assert.equal(createHash('sha256').update(bytes).digest('hex'),ref.sha256);
  if(mode==='missing')continue;
  const dest=join(root,ref.path);await mkdir(dirname(dest),{recursive:true});await writeFile(dest,bytes);
 }
 if(mode==='png-tampered')await writeFile(join(root,activityLandingSource.files[0].path),'tampered');
 if(mode==='json-tampered')await writeFile(join(root,activityLandingSource.files[1].path),'{}');
 const f=await loadLanding();const r=await inspectLearnedActivityNavigation(f,owner,root);
 if(mode==='intact'){
  assert.equal(r?.state,'landing');assert.equal(r?.version,activityLandingSource.version);
  assert.deepEqual(r?.provenance,activityLandingSource);assert.equal(r?.pngSha256,activityLandingSource.files[0].sha256);
 }else assert.equal(r,null);
});
for(const id of ids) test(`real 198 home ${id} proposes only current exact coin entry`,async()=>{
 const f=await load(id), before=JSON.stringify(f);const r=await inspectLearnedActivityNavigation(f,owner);
 assert.equal(r?.state,'home');const b=f.lines.find((l:any)=>l.text==='领淘金币').bounds;
 assert.deepEqual(r?.action,{type:'tap',x:Math.round((b[0]+b[2])/2),y:Math.round((b[1]+b[3])/2)});
 assert.equal(r?.provenance.sourceRunId,198);assert.deepEqual(r?.provenance.files,activityNavigationSource.files);assert.equal(JSON.stringify(f),before);
});
