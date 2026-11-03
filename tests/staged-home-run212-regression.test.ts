// Original read-only observations after run212; offline regression training samples.
import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve,join,dirname,relative,isAbsolute} from 'node:path';
import sharp from 'sharp';
import {inspectLearnedActivityNavigation,activityNavigationSource} from '../runner/staged/activity-navigation.ts';
import {componentMatches} from '../runner/staged/panel-claim.ts';
import type {DeviceFrame} from '../runner/staged/device.ts';
const root=resolve(import.meta.dirname,'..'),scratchBase='/Users/mater/.hermes/cache/scratch/';
const dir='evidence/entry-readonly-2026-11-01T18-19-01-962Z/';
// Scope production refinement tmpdir to scratch even on hosts exporting macOS TMPDIR.
const previousTmpdir=process.env.TMPDIR,refinementScratch=await mkdtemp(scratchBase+'home212-refinement-');
process.env.TMPDIR=refinementScratch;
after(async()=>{if(previousTmpdir===undefined)delete process.env.TMPDIR;else process.env.TMPDIR=previousTmpdir;await rm(refinementScratch,{recursive:true,force:true});});
const samples=[
 {id:'43b48497-68e2-4925-9d75-adca1a877c4d',png:'3349e84f7eea46d8c9202445adf0012267160dbc4a0cfee23514d844ccb46f24',json:'4c4b404f3e746228d6cf5941a377c9306ea18aeb96e655b4a4b3b69f147d5226',ocr:'26df1a0abe8055451edf3841db14b3017e637b3f06ad29f05a1b279cd533511f'},
 {id:'f73180ca-3b8d-43d2-9098-06473cc7a1a5',png:'31b0f3fcf1b992efc06b38ff7aff808ae025e469b38f6d72b56f2147035707c5',json:'c187988e0b045cb50199e2d1437b80fb6248a5f45968cd4eecd2687666fa1df2',ocr:'f389b7435e35a9c03580b674926fc70f7c46e461539896e9cdda42ee0de4c856'},
 {id:'3a0a1ac9-05ed-4c67-a014-52127a4d6ee7',png:'2d720a24b6ce19fad227c0fcc80955b465563e148e48b87d4a2f26a98ce74c7f',json:'9d5e4150f46201dfca16fec3ad68fd896fd2dab8cf34ae7bb58c711303340c20',ocr:'04926f6b3c0ac54eebd88761aed184cdec08a6d340df87c1073183a22709eb07'}, 
];
const owner={package:'com.taobao.taobao',userId:0};
const originalPaths=[...new Set([...activityNavigationSource.files.map(f=>f.path),...samples.flatMap(s=>['png','json','ocr.json'].map(ext=>dir+s.id+'.'+ext))])];
const originalHashes=new Map(await Promise.all(originalPaths.map(async p=>[p,createHash('sha256').update(await readFile(join(root,p))).digest('hex')] as const)));
after(async()=>{for(const [p,h]of originalHashes)assert.equal(createHash('sha256').update(await readFile(join(root,p))).digest('hex'),h,'Original evidence changed: '+p);});
const sha=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
let execCalls=0;
const noExec={exec:async()=>{execCalls++;throw Error('Offline regression forbids subprocesses');}};
const read=async(p:string)=>JSON.parse(await readFile(join(root,p),'utf8'));
function inside(base:string,p:string){const rel=relative(base,p);assert.ok(rel&&!rel.startsWith('..')&&!isAbsolute(rel),p);return p;}
// Rebase all embedded evidence paths before any synthetic frame is written.
function rewrite(v:any,base:string):any{
 if(typeof v==='string'&&(v.startsWith(join(root,'evidence')+'/')||v.startsWith('evidence/')))return inside(base,join(base,'copies',v.startsWith('evidence/')?v:relative(root,v)));
 return Array.isArray(v)?v.map(x=>rewrite(x,base)):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).map(([k,x])=>[k,rewrite(x,base)])):v;
}
async function fixture(t:any,id:string,sourceDir=dir){
 const base=await mkdtemp(scratchBase+'home212-');t.after(()=>rm(base,{recursive:true,force:true}));
 const original=await read(sourceDir+id+'.json'),frame=rewrite(original,base) as DeviceFrame;
 frame.path=inside(base,join(base,'frame.png'));
 await writeFile(frame.path,await readFile(join(root,sourceDir+id+'.png')));
 assert.equal(JSON.stringify(frame).includes(join(root,'evidence')+'/'),false);
 await writeFile(inside(base,join(base,'frame.json')),JSON.stringify(frame));
 return {base,frame};
}
for(const sample of samples)test('real read-only home accepts original frame '+sample.id,async t=>{
 const {frame}=await fixture(t,sample.id),before=JSON.stringify(frame);
 const r=await inspectLearnedActivityNavigation(frame,owner,root,noExec);
 assert.equal(r?.state,'home','Saved real animation/badge frame must match a complete reference');
 const b=frame.lines.find(l=>l.text==='领淘金币')!.bounds;
 assert.deepEqual(r.action,{type:'tap',x:Math.round((b[0]+b[2])/2),y:Math.round((b[1]+b[3])/2)});
 assert.equal(r.frameId,frame.id);assert.equal(r.pngSha256,sha(await readFile(frame.path)));
 assert.equal(r.chromeRefinement,undefined);assert.equal(JSON.stringify(frame),before);
});
const rois=[[0,102,1080,215],[15,215,1065,239],[15,239,160,300],[755,239,1065,300],[15,300,1065,325],[770,330,965,525],[40,2160,165,2275],[475,2160,1050,2280]];
const occlusions:Record<string,number[]>={
 R1:rois[0],R2:rois[1],R3:rois[2],R4:rois[3],R5:rois[4],R6:rois[5],R7:rois[6],R8:rois[7],
 'icon-center':[835,375,885,425],'entry-left':[770,330,786,525],'entry-right':[949,330,965,525],
 'entry-top':[770,330,965,346],'entry-bottom':[770,509,965,525],'entry-text':[790,467,938,507],
 recommendation:[180,120,300,195],search:[890,240,1000,300],tao:[40,2160,165,2275],
 'message-body':[500,2200,575,2240],cart:[700,2160,840,2280],profile:[900,2160,1040,2280],
 'badge-neighbor':[611,2160,619,2168],'R6-last-partial-tile':[962,522,965,525],'R8-last-partial-tile':[1035,2272,1050,2280],
};
async function covered(base:string,frame:DeviceFrame,box:number[]){
 const path=inside(base,join(base,'covered.png'));
 await sharp(frame.path).composite([{input:{create:{width:box[2]-box[0],height:box[3]-box[1],channels:3,background:'#777'}},left:box[0],top:box[1]}]).png().toFile(path);
 const f={...frame,path};await writeFile(inside(base,join(base,'covered.json')),JSON.stringify(f));return f;
}
for(const sample of samples)for(const [name,box]of Object.entries(occlusions))test(`${sample.id} rejects stale OCR over ${name}`,async t=>{
 const {base,frame}=await fixture(t,sample.id);
 assert.equal(await inspectLearnedActivityNavigation(await covered(base,frame,box),owner,root,noExec),null);
});
const required=['领淘金币','推荐','搜索','淘','消息','购物车','我的淘宝'];
for(const sample of samples)for(const mode of ['owner-package','owner-user','invalid-owner','frame-package','frame-user','duplicate','missing-entry','alias','missing-search','bounds-six','malformed','outside','observation-error','dimensions','bad-id','bad-time','login','verify','authorize','allow','confirm'])test(`${sample.id} rejects ${mode}`,async t=>{
 const {frame}=await fixture(t,sample.id);let o=owner;
 const entry=frame.lines.find(l=>l.text==='领淘金币')!;
 if(mode==='owner-package')o={...owner,package:'com.other'};
 if(mode==='owner-user')o={...owner,userId:999};if(mode==='invalid-owner')o={...owner,userId:-1};
 if(mode==='frame-package')frame.package='com.other';if(mode==='frame-user')frame.userId=999;
 if(mode==='duplicate')frame.lines.push(structuredClone(entry));
 if(mode==='missing-entry')frame.lines=frame.lines.filter(l=>l!==entry);if(mode==='alias')entry.text='领淘金市';
 if(mode==='missing-search')frame.lines=frame.lines.filter(l=>l.text!=='搜索');
 if(mode==='bounds-six')entry.bounds=entry.bounds.map(n=>n+6) as typeof entry.bounds;
 if(mode==='malformed')frame.lines[0].bounds=[0,0,NaN,5];if(mode==='outside')frame.lines[0].bounds=[0,0,1081,10];
 if(mode==='observation-error')frame.observationError='capture failed';if(mode==='dimensions')frame.width=1079;
 if(mode==='bad-id')frame.id=' ';if(mode==='bad-time')frame.capturedAt=NaN;
 const risk:Record<string,string>={login:'请登录',verify:'安全验证',authorize:'请求授权',allow:'允许',confirm:'确认'};
 if(risk[mode])frame.lines.push({text:risk[mode],bounds:[10,800,300,850]});
 assert.equal(await inspectLearnedActivityNavigation(frame,o,root,noExec),null);
});
for(const sample of samples)for(const text of required)for(const mode of ['duplicate-anchor','shift-anchor','missing-anchor']){
 if(mode==='missing-anchor'&&text==='淘')continue; // Missing tao has its own saved same-frame refinement contract.
 test(`${sample.id} rejects ${mode} ${text}`,async t=>{
  const {frame}=await fixture(t,sample.id),line=frame.lines.find(l=>l.text===text)!;
  if(mode==='duplicate-anchor')frame.lines.push(structuredClone(line));
  if(mode==='missing-anchor')frame.lines=frame.lines.filter(l=>l!==line);
  if(mode==='shift-anchor')line.bounds=line.bounds.map(n=>n+6) as typeof line.bounds;
  assert.equal(await inspectLearnedActivityNavigation(frame,owner,root,noExec),null);
 });
}
for(const sample of samples)test(sample.id+' regenerates action at unchanged five pixel boundary',async t=>{
 const {frame}=await fixture(t,sample.id),line=frame.lines.find(l=>l.text==='领淘金币')!;
 line.bounds=line.bounds.map(n=>n+5) as typeof line.bounds;
 const r=await inspectLearnedActivityNavigation(frame,owner,root,noExec);assert.equal(r?.state,'home');
 assert.deepEqual(r.action,{type:'tap',x:Math.round((line.bounds[0]+line.bounds[2])/2),y:Math.round((line.bounds[1]+line.bounds[3])/2)});
});
const splashDir='evidence/staged-2026-11-01T18-17-48-785Z/';
const splashIds=['51f4f327-6d30-4e13-94b9-6f29c7aaeb01','44acb6cd-6404-44fa-ba44-4dd948211a89'];
for(const id of splashIds)test('run212 splash remains unknown '+id,async t=>{
 const {frame}=await fixture(t,id,splashDir);assert.equal(await inspectLearnedActivityNavigation(frame,owner,root,noExec),null);
});
const otherPngs=[splashDir+splashIds[0]+'.png','evidence/staged-2026-11-01T13-18-06-815Z/ecf85474-b64c-4ad4-ac55-b38df98ef5f4.png','evidence/staged-2026-11-01T11-56-23-111Z/55b28a1a-f5f7-4939-9724-c478d02bf8ca.png'];
for(const sample of samples)for(const other of [...otherPngs,'corrupt','wrong-size','jpeg'])test(sample.id+' rejects home OCR with PNG '+other,async t=>{
 const {base,frame}=await fixture(t,sample.id);frame.path=inside(base,join(base,'mismatch.png'));
 let bytes:Buffer;
 if(other==='corrupt')bytes=Buffer.from('not PNG');
 else if(other==='wrong-size')bytes=await sharp({create:{width:100,height:100,channels:3,background:'#fff'}}).png().toBuffer();
 else if(other==='jpeg')bytes=await sharp(join(root,dir+sample.id+'.png')).jpeg().toBuffer();
 else bytes=await readFile(join(root,other));
 await writeFile(frame.path,bytes);assert.equal(await inspectLearnedActivityNavigation(frame,owner,root,noExec),null);
});
async function raw(bytes:Buffer){return sharp(bytes).flatten({background:'#fff'}).removeAlpha().toColourspace('srgb').raw().toBuffer();}
test('each new frame matches only its own complete third/fourth/fifth pair',async()=>{
 const refs=activityNavigationSource.files;
 assert.equal(refs.length,10);
 for(let i=0;i<samples.length;i++){
  const sample=samples[i],actual=await raw(await readFile(join(root,dir+sample.id+'.png'))),matches:number[]=[];
  for(let j=0;j<refs.length;j+=2){
   const pixels=await raw(await readFile(join(root,refs[j].path))),ref=await read(refs[j+1].path),f=await read(dir+sample.id+'.json');
   if(required.every(text=>f.lines.find((l:any)=>l.text===text).bounds.every((n:number,k:number)=>Math.abs(n-ref.lines.find((l:any)=>l.text===text).bounds[k])<=5))&&rois.every(box=>componentMatches(pixels,actual,box)))matches.push(j/2+1);
  }
  assert.deepEqual(matches,[i+3],'Actual whole-reference match, not aggregate provenance');
 }
});
// Mutate only the in-memory candidate list; never historical bytes. Restore even on failure.
for(const [i,sample]of samples.entries())test('actual iteration requires pair '+(i+3),async t=>{
 const {frame}=await fixture(t,sample.id),files=activityNavigationSource.files as unknown as {path:string;sha256:string}[];
 const saved=[...files],pair=saved.slice(4+i*2,6+i*2);
 assert.equal((await inspectLearnedActivityNavigation(frame,owner,root,noExec))?.state,'home');
 try{
  files.splice(4+i*2,2);
  assert.equal(await inspectLearnedActivityNavigation(frame,owner,root,noExec),null,'Other whole references cannot authorize this frame');
  files.splice(0,files.length,...pair);
  assert.equal((await inspectLearnedActivityNavigation(frame,owner,root,noExec))?.state,'home','The exact source pair is sufficient');
 }finally{files.splice(0,files.length,...saved);}
});
for(const sample of samples)test(sample.id+' accepts synthetic combination of independently covered complete components',async t=>{
 const {base,frame}=await fixture(t,sample.id),p=await raw(await readFile(frame.path)),old=await raw(await readFile(join(root,activityNavigationSource.files[0].path)));
 const box=rois[7];for(let y=box[1];y<box[3];y++){const start=(y*1080+box[0])*3;old.copy(p,start,start,(y*1080+box[2])*3);}
 const path=inside(base,join(base,'synthetic-splice.png'));await sharp(p,{raw:{width:1080,height:2400,channels:3}}).png().toFile(path);
 const result=await inspectLearnedActivityNavigation({...frame,path},owner,root,noExec);
 assert.equal(result?.state,'home','Explicit component policy permits whole known components; this synthetic image is not live evidence');
 assert.equal(result.matchedComponents?.groups.length,3);
 assert.equal(result.matchedComponents?.groups.find(g=>g.name==='bottom-navigation')?.source.png.path,activityNavigationSource.files[0].path);
 assert.equal(result.matchedComponents?.groups.find(g=>g.name==='coin-entry')?.source.png.path,dir+sample.id+'.png');
});
for(let i=0;i<10;i++)test('every fixed source rejects independent byte tamper '+i,async t=>{
 const {base,frame}=await fixture(t,samples[0].id),sources=inside(base,join(base,'sources'));
 await mkdir(sources,{recursive:true});
 for(const f of activityNavigationSource.files){const p=inside(sources,join(sources,f.path));await mkdir(dirname(p),{recursive:true});await writeFile(p,await readFile(join(root,f.path)));}
 assert.equal((await inspectLearnedActivityNavigation(frame,owner,sources,noExec))?.state,'home');
 const target=inside(sources,join(sources,activityNavigationSource.files[i].path)),bytes=await readFile(target);
 await writeFile(target,Buffer.concat([bytes,Buffer.from('\n')]));
 assert.equal(await inspectLearnedActivityNavigation(frame,owner,sources,noExec),null);
 await writeFile(target,bytes);assert.equal((await inspectLearnedActivityNavigation(frame,owner,sources,noExec))?.state,'home');
});
for(let i=0;i<10;i++)test('every fixed source rejects independent digest tamper '+i,async t=>{
 const {frame}=await fixture(t,samples[0].id),entry=activityNavigationSource.files[i] as {path:string;sha256:string},saved=entry.sha256;
 try{entry.sha256='0'.repeat(64);assert.equal(await inspectLearnedActivityNavigation(frame,owner,root,noExec),null);}finally{entry.sha256=saved;}
});
for(const id of ['beac16b7-c76b-412f-8197-df8defaac7b6','7af61f07-22ea-4a16-bfb8-e720119cd22e'])test('original run198 reference still passes '+id,async t=>{
 const {frame}=await fixture(t,id,'evidence/staged-2026-11-01T12-38-29-524Z/');assert.equal((await inspectLearnedActivityNavigation(frame,owner,root,noExec))?.state,'home');
});
test('run199 missing tao still refines with saved same-frame OCR and no live executable',async t=>{
 const {frame}=await fixture(t,'11e3c401-c043-4db0-a3ce-e97948a31973','evidence/staged-2026-11-01T12-48-57-664Z/'),before=JSON.stringify(frame);
 const code=await readFile(join(root,'tests/staged-script-validation.test.ts'),'utf8'),encoded=code.match(/const navigationOCR=Buffer.from\('([^']+)','base64'\)/)?.[1];assert.ok(encoded);
 const bytes=Buffer.from(encoded,'base64');assert.equal(sha(bytes),'9e06648e435408a1daea9c0da312e6b15baba2cfff2b7c3d2629c1afb64f3161');let replayCalls=0;
 const r=await inspectLearnedActivityNavigation(frame,owner,root,{exec:async(_file,args)=>{
  replayCalls++;assert.ok(args.every(p=>p.startsWith(scratchBase)));const ocr=JSON.parse(bytes.toString());ocr.pages[0].file=args[1];await writeFile(args[0],JSON.stringify(ocr));
 }});
 assert.equal(r?.state,'home');assert.equal(replayCalls,1);assert.equal(r.chromeRefinement?.frameId,frame.id);assert.equal(JSON.stringify(frame),before);
});
test('complete run199 home remains accepted without refinement',async t=>{
 const {frame}=await fixture(t,'31fc0e2c-e563-45ba-a0e2-fc3bb4b29c9f','evidence/staged-2026-11-01T12-48-57-664Z/');assert.equal((await inspectLearnedActivityNavigation(frame,owner,root,noExec))?.state,'home');
});
test('read-only provenance pins original PNG/JSON pairs and accurately names observations',async()=>{
 assert.equal(activityNavigationSource.sourceRunId,198);assert.equal(activityNavigationSource.status,'candidate');
 assert.deepEqual(activityNavigationSource.readOnlyObservationSources[0].frameIds,samples.map(s=>s.id));
 assert.match(activityNavigationSource.readOnlyObservationSources[0].description,/not frames from run212/);
 for(const [i,sample]of samples.entries()){
  assert.deepEqual(activityNavigationSource.files.slice(4+i*2,6+i*2),[{path:dir+sample.id+'.png',sha256:sample.png},{path:dir+sample.id+'.json',sha256:sample.json}]);
  for(const [ext,hash]of [['png',sample.png],['json',sample.json],['ocr.json',sample.ocr]])assert.equal(sha(await readFile(join(root,dir+sample.id+'.'+ext))),hash);
  const frame=await read(dir+sample.id+'.json'),ocr=await read(dir+sample.id+'.ocr.json');assert.deepEqual(frame.lines,ocr.pages[0].lines.map((l:any)=>({text:l.text,bounds:l.bounds})));
 }
 assert.equal(execCalls,0);
});
