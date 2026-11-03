import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,copyFile,mkdtemp,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
import * as navigation from '../runner/staged/activity-navigation.ts';
import type {DeviceFrame} from '../runner/staged/device.ts';

const owner={package:'com.taobao.taobao',userId:0};
const run223='evidence/staged-2026-11-02T01-25-13-762Z/';
async function load(path:string):Promise<DeviceFrame>{return JSON.parse(await readFile(path,'utf8'));}
const current=navigation.inspectCurrentActivityNavigation;
const landing201='evidence/staged-2026-11-01T14-18-29-240Z/2ef5882b-2795-4d31-8d52-2fb3bf75c1f1.json';
const landing214='evidence/staged-2026-11-01T19-06-12-676Z/de799f1e-3112-400e-853d-9a5c6b72e4f9.json';
const landing200='evidence/staged-2026-11-01T13-18-06-815Z/ecf85474-b64c-4ad4-ac55-b38df98ef5f4.json';
// Synthetic variants copy original PNG/raw OCR to scratch, never change evidence.
// Relocating page.file is explicit; no claim that synthetic OCR was freshly recognized.
async function synthetic(source:string,edit:(frame:DeviceFrame,raw:any)=>void=()=>{}){
 const frame=await load(source),raw=JSON.parse(await readFile(frame.path.replace(/\.png$/,'.ocr.json'),'utf8'));
 const dir=await mkdtemp('/Users/mater/.hermes/cache/scratch/navigation-current-text-');
 const path=dir+'/frame.png';await copyFile(frame.path,path);frame.path=path;raw.pages[0].file=path;
 edit(frame,raw);await writeFile(path.replace(/\.png$/,'.ocr.json'),JSON.stringify(raw));return frame;
}
function assertTap(result:navigation.ActivityNavigationInspection|null,frame:DeviceFrame,text:string){
 const b=frame.lines.find(l=>l.text===text)!.bounds;
 assert.deepEqual(result?.action,{type:'tap',x:Math.round((b[0]+b[2])/2),y:Math.round((b[1]+b[3])/2)});
 assert.equal(result?.frameId,frame.id);assert.match(result!.pngSha256,/^[a-f0-9]{64}$/);
}
for(const kind of ['home','landing'] as const)test(`synthetic ${kind} rejects additional raw text overlapping navigation target`,async()=>{
 const source=kind==='home'?run223+'8481bb37-6035-4ee2-87bb-f41b989c4a78.json':landing201;
 const frame=await synthetic(source,(f,r)=>{
  const target=f.lines.find(l=>l.text===(kind==='home'?'领淘金币':'去赚金币'))!;
  // Raw-only overlap cannot be hidden by refined OCR omitting the line.
  r.pages[0].lines.push({text:'继续',bounds:[...target.bounds]});
 });
 assert.equal(await current(frame,owner),null);
});
test('original 200 ambiguous coin identity is rejected without historical alias or fallback',async()=>{
 const frame=await load(landing200);assert.ok(frame.lines.some(l=>l.text==='币淘金市'));
 assert.equal(await current(frame,owner),null);
});
for(const kind of ['home','landing','panel'] as const){
 for(const mode of ['wrong-owner','wrong-package','duplicate','login','raw-risk','bad-bounds','observation-error','raw-file','raw-engine','raw-size','raw-pages','raw-missing','invalid-png','wrong-layout','raw-conflict'] as const){
  test(`synthetic ${kind} rejects ${mode}`,async()=>{
   const source=kind==='home'?run223+'8481bb37-6035-4ee2-87bb-f41b989c4a78.json':kind==='landing'?landing201:panel195;
   const title=kind==='home'?'领淘金币':kind==='landing'?'去赚金币':'赚金币抵钱';
   const frame=await synthetic(source,(f,r)=>{
    const line=f.lines.find(l=>l.text===title)!,rawLine=r.pages[0].lines.find((l:any)=>l.text===title);
    if(mode==='wrong-owner')f.userId=999;
    if(mode==='wrong-package')f.package='com.other';
    if(mode==='duplicate'){f.lines.push({...structuredClone(line),text:title.slice(0,1)+' '+title.slice(1)});r.pages[0].lines.push(structuredClone(f.lines.at(-1)));}
    if(mode==='login')f.lines.push({text:'请登录',bounds:[300,1700,600,1750]});
    if(mode==='raw-risk')r.pages[0].lines.push({text:'安全验证',bounds:[300,1700,600,1750]});
    if(mode==='bad-bounds')line.bounds=[0,900,NaN,950];
    if(mode==='observation-error')f.observationError='synthetic capture error';
    if(mode==='raw-file')r.pages[0].file='other-frame.png';
    if(mode==='raw-engine')r.engine='unsupported OCR';
    if(mode==='raw-size')r.pages[0].width=720;
    if(mode==='raw-pages')r.pages.push(structuredClone(r.pages[0]));
    if(mode==='raw-missing')r.pages[0].lines=[];
    if(mode==='wrong-layout'){line.bounds=[500,1500,750,1550];rawLine.bounds=[...line.bounds];}
    if(mode==='raw-conflict')rawLine.text='关键文字冲突';
   });
   if(mode==='invalid-png')await writeFile(frame.path,'synthetic invalid png');
   if(kind==='panel'&&mode==='wrong-layout')assert.equal((await current(frame,owner))?.state,'panel');
   else assert.equal(await current(frame,owner),null);
  });
 }
}
for(const mode of ['no-identity','target-only','central-game-target','energy-target','conflicting-home','conflicting-panel','repaired-identity','raw-duplicate','refined-key-bounds','identity-under-target'] as const){
 test(`synthetic landing rejects ${mode}`,async()=>{
  const frame=await synthetic(landing201,(f,r)=>{
   const contexts=[f.lines,r.pages[0].lines] as DeviceFrame['lines'][];
   for(const lines of contexts){
    const identity=lines.find(l=>l.text==='币淘金币')!,coin=lines.find(l=>l.text==='去赚金币')!;
    if(mode==='no-identity')lines.splice(lines.indexOf(identity),1);
    if(mode==='target-only')lines.splice(0,lines.length,coin);
    if(mode==='central-game-target')coin.bounds=[...lines.find(l=>l.text==='升级赛车拿钱')!.bounds];
    if(mode==='energy-target')coin.bounds=[...lines.find(l=>l.text==='去赚能量')!.bounds];
    if(mode==='conflicting-home'||mode==='conflicting-panel')lines.push({text:mode==='conflicting-home'?'领淘金币':'赚金币抵钱',bounds:[400,500,700,550]});
    if(mode==='identity-under-target')identity.bounds=[40,1100,180,1140];
   }
   if(mode==='repaired-identity')r.pages[0].lines.find((l:any)=>l.text==='币淘金币').text='币淘金市';
   if(mode==='raw-duplicate')r.pages[0].lines.push(structuredClone(f.lines.find(l=>l.text==='去赚金币')));
   if(mode==='refined-key-bounds')f.lines.find(l=>l.text==='去赚金币')!.bounds[0]+=1;
  });
  assert.equal(await current(frame,owner),null);
 });
}
test('synthetic landing current layout may move beyond historical five-pixel tolerance',async()=>{
 const frame=await synthetic(landing201,(f,r)=>{
  for(const lines of [f.lines,r.pages[0].lines] as DeviceFrame['lines'][])for(const l of lines){
   if(l.text==='去赚金币'||l.text==='币淘金币')l.bounds=l.bounds.map((n,k)=>n+(k%2===0?25:l.text==='币淘金币'?-20:45));
  }
 });
 const result=await current(frame,owner);assert.equal(result?.state,'landing');assertTap(result,frame,'去赚金币');
});
for(const kind of ['home','landing'] as const)test(`synthetic ${kind} decoration pixels are not historical identity`,async()=>{
 const frame=await synthetic(kind==='home'?run223+'8481bb37-6035-4ee2-87bb-f41b989c4a78.json':landing201);
 const image=await sharp(frame.path).composite([{input:await sharp({create:{width:100,height:100,channels:3,background:'#445566'}}).png().toBuffer(),left:0,top:2000}]).png().toBuffer();
 await writeFile(frame.path,image);
 const result=await current(frame,owner);assert.equal(result?.state,kind);
 assert.equal(result?.pngSha256,createHash('sha256').update(image).digest('hex'));
 assert.equal(result?.matchedComponents,undefined);assert.equal(result?.chromeRefinement,undefined);
});
for(const mode of ['negative-owner','invalid-owner','wrong-input-owner','invalid-timestamp','wrong-size','blank-id'] as const)test(`synthetic current contract rejects ${mode}`,async()=>{
 const frame=await load(landing201);let expected=owner;
 if(mode==='negative-owner')expected={...owner,userId:-1};
 if(mode==='invalid-owner')expected={...owner,userId:NaN};
 if(mode==='wrong-input-owner')expected={...owner,userId:999};
 if(mode==='invalid-timestamp')frame.capturedAt=NaN;
 if(mode==='wrong-size')frame.width=720;
 if(mode==='blank-id')frame.id=' ';
 assert.equal(await current(frame,expected),null);
});
const panel195='evidence/staged-2026-11-01T11-56-23-111Z/55b28a1a-f5f7-4939-9724-c478d02bf8ca.json';
test('current landing accepts a relocated entry without historical distance or alignment',async()=>{
 const frame=await synthetic(landing201,(f,r)=>{
  for(const lines of [f.lines,r.pages[0].lines]){
   lines.find((l:any)=>l.text==='去赚金币').bounds=[350,2100,550,2160];
   lines.push({text:'确认取消授权说明',bounds:[-3,2350,600,2390]});
  }
 });
 const result=await current(frame,owner);assert.equal(result?.state,'landing');assertTap(result,frame,'去赚金币');
});
test('current list requires actual row structure beneath its title',async()=>{
 const frame=await synthetic(panel195,(f,r)=>{
  for(const lines of [f.lines,r.pages[0].lines])for(let i=lines.length-1;i>=0;i--)if(/\(\d+\/\d+\)/.test(lines[i].text.normalize('NFKC')))lines.splice(i,1);
 });
 assert.equal(await current(frame,owner),null);
});
for(const kind of ['landing','panel'] as const)test(`current ${kind} rejects raw overlap over its identity`,async()=>{
 const frame=await synthetic(kind==='panel'?panel195:landing201,(f,r)=>{
  const title=f.lines.find(l=>l.text===(kind==='panel'?'赚金币抵钱':'币淘金币'))!;
  r.pages[0].lines.push({text:'遮挡提示',bounds:[...title.bounds]});
 });
 assert.equal(await current(frame,owner),null);
});
test('original panel frames use current row identity without a navigation action',async()=>{
 for(const path of [panel195,'evidence/staged-2026-11-01T14-46-46-914Z/b1e5d975-9728-48db-adf6-4f777155f149.json','evidence/staged-2026-11-01T16-45-09-994Z/e80b88ec-0c1f-44c1-809d-907cc20963c4.json']){
  const frame=await load(path),before=JSON.stringify(frame),result=await current(frame,owner);
  assert.equal(result?.state,'panel');assert.equal(result?.version,'panel-visible-rows-v2');assert.equal(result?.action,undefined);
  assert.equal(JSON.stringify(frame),before);
 }
});
test('original readable 201 and 214 landing frames use current text identity and target',async()=>{
 for(const path of [landing201,landing201.replace('2ef5882b-2795-4d31-8d52-2fb3bf75c1f1','a8841dac-538f-46f0-a381-5a1d143d01c5'),landing214]){
  const frame=await load(path),before=JSON.stringify(frame),result=await current(frame,owner);
  assert.equal(result?.state,'landing');assert.equal(result?.version,'landing-text-v2');
  assert.deepEqual(result?.provenance.files,[]);assertTap(result,frame,'去赚金币');
  assert.equal(JSON.stringify(frame),before);
 }
});
test('current home accepts missing optional navigation and unrelated clipped merchandise',async()=>{
 const frame=await synthetic(run223+'8481bb37-6035-4ee2-87bb-f41b989c4a78.json',(f,r)=>{
  for(const lines of [f.lines,r.pages[0].lines]){
   for(let i=lines.length-1;i>=0;i--)if(['消息','购物车','我的淘宝'].includes(lines[i].text))lines.splice(i,1);
   lines.push({text:'确认授权版商品介绍',bounds:[-4,1800,400,1840]});
   lines.push({text:'普通商品确认取消授权说明',bounds:[400,2300,850,2340]});
  }
 });
 const result=await current(frame,owner);assert.equal(result?.state,'home');assertTap(result,frame,'领淘金币');
});
test('synthetic home ignores duplicated optional chrome outside its actual entry',async()=>{
 const frame=await synthetic(run223+'8481bb37-6035-4ee2-87bb-f41b989c4a78.json',f=>{
  const tao=f.lines.find(l=>l.text==='淘')!,video=f.lines.find(l=>l.text==='视频')!;
  video.text=tao.text;video.bounds=[...tao.bounds];
 });
 assert.equal((await current(frame,owner))?.state,'home');
});
test('synthetic home permits refined merchandise text while preserving navigation raw anchors',async()=>{
 const frame=await synthetic(run223+'8481bb37-6035-4ee2-87bb-f41b989c4a78.json',f=>{
  f.lines.find(l=>l.text==='西麦奇亚籽谷物燕麦')!.text='非导航商品正文修正';
  f.lines.reverse();
 });
 const result=await current(frame,owner);assert.equal(result?.state,'home');assertTap(result,frame,'领淘金币');
});
test('original run223 home frames rejected by legacy pass current text navigation',async()=>{
 for(const id of ['8481bb37-6035-4ee2-87bb-f41b989c4a78','4e600a9b-ca8a-411f-abb1-7497f70a2c8c']){
  const frame=await load(run223+id+'.json'),before=JSON.stringify(frame);
  assert.equal(await navigation.inspectLearnedActivityNavigation(frame,owner),null);
  const result=await current?.(frame,owner);
  assert.equal(result?.state,'home');
  assert.equal(result?.version,'home-text-v2');
  assert.equal(result?.provenance.sourceRunId,198);
  assert.deepEqual(result?.provenance.files,[]);
  const b=frame.lines.find(l=>l.text==='领淘金币')!.bounds;
  assert.deepEqual(result?.action,{type:'tap',x:Math.round((b[0]+b[2])/2),y:Math.round((b[1]+b[3])/2)});
  assert.equal(JSON.stringify(frame),before);
 }
});
