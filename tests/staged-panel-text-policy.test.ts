import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdtemp,copyFile,mkdir} from 'node:fs/promises';
import {join,resolve,basename,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
import {inspectLearnedActivityNavigation,activityPanelSource} from '../runner/staged/activity-navigation.ts';
import type {DeviceFrame} from '../runner/staged/device.ts';

const owner={package:'com.taobao.taobao',userId:0};
const scratch='/Users/mater/.hermes/cache/scratch';
const heldout='evidence/staged-2026-11-01T19-32-41-877Z/55a6d09a-1b77-4952-91ce-fa867d076087';
const sources=[
 'evidence/staged-2026-11-01T11-56-23-111Z/55b28a1a-f5f7-4939-9724-c478d02bf8ca',
 'evidence/staged-2026-11-01T14-46-46-914Z/b1e5d975-9728-48db-adf6-4f777155f149',
 'evidence/staged-2026-11-01T16-45-09-994Z/e80b88ec-0c1f-44c1-809d-907cc20963c4',
 'evidence/staged-2026-11-01T04-08-28-272Z/ca9ca42a-89ec-4d9b-b063-66ae6fbfaf79',
];
const hash=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
// Rebase every nested path before any write; never use a historical output path.
async function replay(source=heldout){
 const dir=await mkdtemp(join(scratch,'panel-text-'));
 const relocate=(value:any):any=>typeof value==='string'&&value.startsWith(resolve('evidence')+'/')?join(dir,basename(value))
  :Array.isArray(value)?value.map(relocate):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).map(([k,v])=>[k,relocate(v)])):value;
 const frame=relocate(JSON.parse(await readFile(source+'.json','utf8'))) as DeviceFrame;
 const raw=relocate(JSON.parse(await readFile(source+'.ocr.json','utf8')));
 frame.path=join(dir,basename(source)+'.png');raw.pages[0].file=frame.path;
 await copyFile(source+'.png',frame.path);
 assert.ok(!JSON.stringify({frame,raw}).includes(resolve('evidence')+'/'));
 const save=async()=>{
  await writeFile(frame.path.replace(/\.png$/,'.json'),JSON.stringify(frame));
  await writeFile(frame.path.replace(/\.png$/,'.ocr.json'),JSON.stringify(raw));
 };
 await save();return {frame,raw,save,dir};
}
const offline={exec:async()=>{throw Error('Panel text inspection must never invoke OCR or device commands');}};

test('heldout real run216 recognizes panel without an action',async()=>{
 const {frame}=await replay(),before=JSON.stringify(frame);
 const result=await inspectLearnedActivityNavigation(frame,owner,undefined,offline);
 assert.equal(result?.state,'panel','Real run216 panel must be recognized without an action');
 assert.equal(result.action,undefined);
 assert.equal(result.pngSha256,hash(await readFile(heldout+'.png')));
 assert.equal(JSON.stringify(frame),before);
});

test('a readable header cannot conceal a broken visible task row',async()=>{
 const {frame,raw,save}=await replay();
 for(const lines of [frame.lines,raw.pages[0].lines]){
  const index=lines.findIndex((l:any)=>l.text==='去完成'&&l.bounds[1]>1200&&l.bounds[1]<1300);
  assert.ok(index>=0);lines.splice(index,1);
 }
 await save();assert.equal(await inspectLearnedActivityNavigation(frame,owner,undefined,offline),null);
});

test('removing both reward labels does not turn an unscrolled page into a scroll',async()=>{
 const {frame,raw,save}=await replay();
 for(const lines of [frame.lines,raw.pages[0].lines])for(let i=lines.length-1;i>=0;i--)if(lines[i].text==='今日累计奖励'||lines[i].text.startsWith('完成进度'))lines.splice(i,1);
 await save();assert.equal(await inspectLearnedActivityNavigation(frame,owner,undefined,offline),null);
});

test('real 195/203 and scrolled 209 plus another saved scroll remain readable',async()=>{
 for(const source of sources){
  const {frame,dir}=await replay(source);
  const result=await inspectLearnedActivityNavigation(frame,owner,dir,offline);
  assert.equal(result?.state,'panel',source);
  assert.equal(result.action,undefined);
  assert.equal(result.version,'panel-text-v4');
 }
 assert.equal(activityPanelSource.version,'panel-text-v4');
});

test('title, reward summary and list placement are required together',async()=>{
 const modes=['missing-title','duplicate-title','title-position','missing-progress','duplicate-reward','reward-position','invalid-progress','non-list','row-position','row-quota','description-missing'];
 for(const mode of modes){
  const {frame,raw,save}=await replay();
  const mutate=(lines:DeviceFrame['lines'])=>{
   const title=lines.find(l=>l.text==='赚金币抵钱')!;
   if(mode==='missing-title')lines.splice(lines.indexOf(title),1);
   if(mode==='duplicate-title')lines.push({...structuredClone(title),text:'赚 金币抵钱'});
   if(mode==='title-position')title.bounds=title.bounds.map((n,k)=>n+(k%2===0?50:0));
   if(mode==='missing-progress')lines.splice(lines.findIndex(l=>l.text.startsWith('完成进度')),1);
   if(mode==='duplicate-reward')lines.push(structuredClone(lines.find(l=>l.text==='今日累计奖励')!));
   if(mode==='reward-position')lines.find(l=>l.text==='今日累计奖励')!.bounds=[400,620,660,666];
   if(mode==='invalid-progress')lines.find(l=>l.text.startsWith('完成进度'))!.text='完成进度21/20';
   if(mode==='non-list')for(const l of lines)if(l.text.includes('（'))l.text='商品促销广告';
   if(mode==='row-position')lines.find(l=>l.text.startsWith('发现精选'))!.bounds=[50,1189,400,1234];
   if(mode==='row-quota')lines.find(l=>l.text.startsWith('发现精选'))!.text='任意任务（8/6）';
   if(mode==='description-missing')for(let i=lines.length-1;i>=0;i--)if(lines[i].bounds[0]>210&&lines[i].bounds[2]<820&&lines[i].bounds[1]>1240&&lines[i].bounds[3]<1310)lines.splice(i,1);
  };
  mutate(frame.lines);mutate(raw.pages[0].lines);await save();
  assert.equal(await inspectLearnedActivityNavigation(frame,owner,undefined,offline),null,mode);
 }
});

test('owner, risk and malformed frame reject without granting navigation',async()=>{
 for(const mode of ['wrong-package','wrong-user','invalid-owner','bounds','timestamp','observation-error','risk','ad','close']){
  const {frame,raw,save}=await replay();let expectedOwner=owner;
  if(mode==='wrong-package')frame.package='com.example.other';
  if(mode==='wrong-user')frame.userId=10;
  if(mode==='invalid-owner')expectedOwner={...owner,userId:-1};
  if(mode==='bounds')frame.lines[0].bounds[0]=-1;
  if(mode==='timestamp')frame.capturedAt=NaN;
  if(mode==='observation-error')frame.observationError='OCR failed';
  if(mode==='risk'||mode==='ad'||mode==='close')for(const lines of [frame.lines,raw.pages[0].lines])lines.push({text:mode==='ad'?'广告':mode==='close'?'关闭':'请确定授权',bounds:[400,1400,700,1450]});
  await save();assert.equal(await inspectLearnedActivityNavigation(frame,expectedOwner,undefined,offline),null,mode);
 }
});

test('pixel changes with identical saved text are accepted under the text policy',async()=>{
 const {frame,save,dir}=await replay();
 const before=hash(await readFile(frame.path));
 await sharp({create:{width:1080,height:2400,channels:3,background:'#fff'}}).png().toFile(join(dir,'changed.png'));
 await copyFile(join(dir,'changed.png'),frame.path);await save();
 const result=await inspectLearnedActivityNavigation(frame,owner,dir,offline);
 assert.equal(result?.state,'panel');assert.notEqual(result.pngSha256,before);
 assert.equal(result.pngSha256,hash(await readFile(frame.path)));
});

test('saved title refinement may correct a task name within the same row',async()=>{
 const {frame}=await replay('evidence/staged-2026-11-01T10-09-45-444Z/f8aaae2b-3b45-4dcc-a39a-1f16f2f907d3');
 assert.equal((await inspectLearnedActivityNavigation(frame,owner,undefined,offline))?.state,'panel');
});

test('task titles are read from the frame without a business-name allowlist',async()=>{
 const {frame,raw,save}=await replay();
 for(const lines of [frame.lines,raw.pages[0].lines])for(const l of lines)if(l.text.includes('（'))l.text=l.text.replace(/^.+(?=（)/,'新任务名称');
 await save();assert.equal((await inspectLearnedActivityNavigation(frame,owner,undefined,offline))?.state,'panel');
});

test('home and landing retain the existing pixel contract',async()=>{
 for(const [source,state] of [
  ['evidence/staged-2026-11-01T12-38-29-524Z/beac16b7-c76b-412f-8197-df8defaac7b6','home'],
  ['evidence/staged-2026-11-01T13-18-06-815Z/ecf85474-b64c-4ad4-ac55-b38df98ef5f4','landing'],
 ]){
  const {frame,dir}=await replay(source);
  assert.equal((await inspectLearnedActivityNavigation(frame,owner,undefined,offline))?.state,state);
  await sharp({create:{width:1080,height:2400,channels:3,background:'#fff'}}).png().toFile(join(dir,'changed.png'));
  await copyFile(join(dir,'changed.png'),frame.path);
  assert.equal(await inspectLearnedActivityNavigation(frame,owner,undefined,offline),null);
 }
});

test('independent navigation audit replays the same panel inspector offline',async()=>{
 const {verifyAuditActivityNavigation}=await import('../runner/staged/script-validation.ts');
 const {frame,dir}=await replay();
 // Current audit preflights historical paths; these deliberately invalid files
 // prove the inspector uses none of their bytes as pixel authority.
 for(const ref of activityPanelSource.files){const path=join(dir,ref.path);await mkdir(dirname(path),{recursive:true});await writeFile(path,'historical provenance only');}
 const expected=await inspectLearnedActivityNavigation(frame,owner,dir,offline);
 const actual=await verifyAuditActivityNavigation({root:dir,frame,owner});
 assert.deepEqual(actual,expected);assert.equal(actual?.state,'panel');
 const line=frame.lines.find(l=>l.text==='赚金币抵钱')!;line.bounds=[200,477,489,538];
 assert.equal(await verifyAuditActivityNavigation({root:dir,frame,owner}),null);
});

test('panel rejects invalid or unbound raw OCR even when frame text is readable',async()=>{
 for(const mode of ['wrong-file','dimensions','bounds','missing','split-risk']){
  const {frame,raw,save}=await replay();
  if(mode==='wrong-file')raw.pages[0].file=join(scratch,'other.png');
  if(mode==='dimensions')raw.pages[0].width=1079;
  if(mode==='bounds')raw.pages[0].lines[0].bounds[0]=-1;
  if(mode==='missing')raw.pages[0].lines=[];
  if(mode==='split-risk')raw.pages[0].lines.push({text:'登',bounds:[400,1400,450,1450]},{text:'录',bounds:[460,1400,510,1450]});
  await save();
  assert.equal(await inspectLearnedActivityNavigation(frame,owner,undefined,offline),null,mode);
 }
});
