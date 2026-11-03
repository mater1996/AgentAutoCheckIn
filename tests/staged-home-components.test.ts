// Offline only: held-out run213 PNG and persisted crop OCR, never new references.
import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdtemp,rm,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve,join,relative,isAbsolute,dirname} from 'node:path';
import sharp from 'sharp';
import {componentMatches} from '../runner/staged/panel-claim.ts';
import {inspectLearnedActivityNavigation,activityNavigationSource} from '../runner/staged/activity-navigation.ts';
import type {DeviceFrame} from '../runner/staged/device.ts';
const root=resolve(import.meta.dirname,'..'),scratch='/Users/mater/.hermes/cache/scratch/';
const runDir='evidence/staged-2026-11-01T18-41-05-697Z/',id='4dd2680a-fbbe-4211-a578-15d1dded50a4';
const sha=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
const report=JSON.parse(await readFile(join(root,'docs/probes/run213-home-gates.results.json'),'utf8'));
const savedRaw=Buffer.from(report.ocr.rawBase64,'base64');
assert.equal(sha(savedRaw),'6cd2ef40646feb26ec9551497ed67f386caae900e2f8434e35a2ed391e06686e');
const protectedPaths=[...new Set([...activityNavigationSource.files.flatMap(f=>f.path.endsWith('.json')?[f.path,f.path.replace(/\.json$/,'.ocr.json')]:[f.path]),...['png','json','ocr.json'].map(ext=>runDir+id+'.'+ext),'docs/probes/run213-home-gates.results.json'])];
const protectedHashes=await Promise.all(protectedPaths.map(async p=>[p,sha(await readFile(join(root,p)))] as const));
const tmp=await mkdtemp(scratch+'home-components-'),previousTmp=process.env.TMPDIR;
process.env.TMPDIR=tmp;
after(async()=>{for(const [p,h]of protectedHashes)assert.equal(sha(await readFile(join(root,p))),h,p);if(previousTmp===undefined)delete process.env.TMPDIR;else process.env.TMPDIR=previousTmp;await rm(tmp,{recursive:true,force:true});});
function inside(p:string){const r=relative(tmp,p);assert.ok(r&&!r.startsWith('..')&&!isAbsolute(r),p);return p;}
function rebase(v:any):any{
 if(typeof v==='string'&&(v.startsWith(join(root,'evidence')+'/')||v.startsWith('evidence/')))return inside(join(tmp,'copies',v.startsWith('evidence/')?v:relative(root,v)));
 return Array.isArray(v)?v.map(rebase):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).map(([k,x])=>[k,rebase(x)])):v;
}
async function fixture(){
 const bytes=await readFile(join(root,runDir+id+'.png'));
 assert.equal(sha(bytes),'cb703db52578484c1293b97cbafec5c9f40748750c0027d82b3f662dc4869b9e');
 const frame=rebase(JSON.parse(await readFile(join(root,runDir+id+'.json'),'utf8'))) as DeviceFrame;
 frame.path=inside(join(tmp,'frame.png'));await writeFile(frame.path,bytes);return frame;
}
let replayCalls=0;
const replay={exec:async(_file:string,args:string[])=>{
 replayCalls++;args.forEach(inside);
 assert.equal(sha(await readFile(args[1])),report.ocr.cropSha256);
 const output=JSON.parse(savedRaw.toString());output.pages[0].file=args[1];
 await writeFile(args[0],JSON.stringify(output));
}};
const owner={package:'com.taobao.taobao',userId:0};
test('held-out original run213 home matches three complete existing components after saved same-frame refinement',async()=>{
 const frame=await fixture(),before=JSON.stringify(frame);
 const result=await inspectLearnedActivityNavigation(frame,owner,root,replay);
 assert.equal(result?.state,'home','Original run213 has covered complete components despite no single whole-page reference');
 assert.equal(result.frameId,id);assert.equal(result.pngSha256,'cb703db52578484c1293b97cbafec5c9f40748750c0027d82b3f662dc4869b9e');
 assert.equal(result.version,activityNavigationSource.version);assert.equal(replayCalls,1);
 const entry=frame.lines.find(l=>l.text==='领淘金币')!.bounds;
 assert.deepEqual(result.action,{type:'tap',x:Math.round((entry[0]+entry[2])/2),y:Math.round((entry[1]+entry[3])/2)});
 assert.equal(result.chromeRefinement?.frameId,id);assert.equal(JSON.stringify(frame),before);
 assert.ok(activityNavigationSource.files.every(f=>!f.path.includes(runDir)));
});
const rois=[[0,102,1080,215],[15,215,1065,239],[15,239,160,300],[755,239,1065,300],[15,300,1065,325],[770,330,965,525],[40,2160,165,2275],[475,2160,1050,2280]];
const required=['领淘金币','推荐','搜索','淘','消息','购物车','我的淘宝'];
const definitions=[{name:'chrome',rois:[...rois.slice(0,5),rois[6]]},{name:'coin-entry',rois:[rois[5]]},{name:'bottom-navigation',rois:[rois[7]]}];
const raw=async(b:Buffer)=>sharp(b).flatten({background:'#fff'}).removeAlpha().toColourspace('srgb').raw().toBuffer();
const noExec={exec:async()=>{throw Error('No subprocess allowed');}};
function refined(frame:DeviceFrame):DeviceFrame{const b=JSON.parse(savedRaw.toString()).pages[0].lines[0].bounds;return {...frame,lines:[...frame.lines,{text:'淘',bounds:b.map((n:number,k:number)=>n/2+rois[6][k%2])}]};}
async function png(p:Buffer,label:string){const path=inside(join(tmp,label+'.png'));await sharp(p,{raw:{width:1080,height:2400,channels:3}}).png().toFile(path);return path;}
function copyBox(target:Buffer,source:Buffer,box:number[]){for(let y=box[1];y<box[3];y++){const start=(y*1080+box[0])*3;source.copy(target,start,start,(y*1080+box[2])*3);}}
test('witness names first full source for each fixed group and recomputes identically without temporary paths',async()=>{
 const frame=await fixture(),result=await inspectLearnedActivityNavigation(frame,owner,root,replay);assert.ok(result?.matchedComponents);
 const actual=await raw(await readFile(frame.path)),lines=refined(frame).lines,expected=[];
 for(const group of definitions){let match;
  for(let i=0;i<activityNavigationSource.files.length;i+=2){const p=activityNavigationSource.files[i],j=activityNavigationSource.files[i+1],ref=JSON.parse(await readFile(join(root,j.path),'utf8'));
   assert.equal(sha(await readFile(join(root,p.path))),p.sha256);assert.equal(sha(await readFile(join(root,j.path))),j.sha256);
   if(ref.package!==frame.package||ref.userId!==frame.userId||ref.width!==frame.width||ref.height!==frame.height)continue;
   if(!required.every(t=>ref.lines.filter((l:any)=>l.text===t).length===1&&lines.find(l=>l.text===t)!.bounds.every((n,k)=>Math.abs(n-ref.lines.find((l:any)=>l.text===t).bounds[k])<=5)))continue;
   const refPixels=await raw(await readFile(join(root,p.path)));
   if(group.rois.every(box=>componentMatches(refPixels,actual,box))){match={...group,source:{png:p,json:j}};break;}
  }
  assert.ok(match);expected.push(match);
 }
 assert.deepEqual(result.matchedComponents,{version:activityNavigationSource.version,frameId:frame.id,pngSha256:sha(await readFile(frame.path)),groups:expected});
 assert.deepEqual(expected.map(g=>g.source.png.path),[activityNavigationSource.files[0].path,activityNavigationSource.files[0].path,activityNavigationSource.files[4].path]);
 const again=await inspectLearnedActivityNavigation(frame,owner,root,replay);
 assert.deepEqual(again?.matchedComponents,result.matchedComponents);
 const serialized=JSON.stringify(result.matchedComponents);assert.deepEqual(JSON.parse(serialized),result.matchedComponents);
 assert.ok(!serialized.includes(tmp));assert.ok(!/elapsed|session|account|capturedAt|page/.test(serialized));
 assert.deepEqual(result.provenance,activityNavigationSource);
});
for(const [name,box]of [...definitions.map(g=>[g.name,g.rois[g.rois.length-1]] as const),...rois.map((box,i)=>['R'+(i+1),box] as const),
 ['icon',[835,375,885,425]],['title',[790,467,938,507]],['badge-neighbor',[611,2160,619,2168]],['entry-partial-tile',[962,522,965,525]],['bottom-partial-tile',[1035,2272,1050,2280]]] as [string,number[]][])test('complete components reject stale OCR occlusion '+name,async()=>{
 const frame=refined(await fixture()),pixels=await raw(await readFile(frame.path));
 for(let y=box[1];y<box[3];y++)for(let x=box[0];x<box[2];x++)pixels.fill(119,(y*1080+x)*3,(y*1080+x)*3+3);
 assert.equal(await inspectLearnedActivityNavigation({...frame,path:await png(pixels,'covered-'+name)},owner,root,noExec),null);
});
for(const which of ['coin-entry','bottom-navigation'])test('rejects selecting different source tiles inside complete '+which,async()=>{
 const frame=refined(await fixture()),actual=await raw(await readFile(frame.path)),group=definitions.find(g=>g.name===which)!,box=group.rois[0];
 const a=await raw(await readFile(join(root,activityNavigationSource.files[which==='coin-entry'?4:0].path))),b=await raw(await readFile(join(root,activityNavigationSource.files[which==='coin-entry'?6:4].path)));
 let count=0;for(let y=box[1];y<box[3];y+=16)for(let x=box[0];x<box[2];x+=16){copyBox(actual,(count++%2?a:b),[x,y,Math.min(x+16,box[2]),Math.min(y+16,box[3])]);}
 // A per-tile source selector accepts every tile; no complete original component does.
 assert.ok(!componentMatches(a,actual,box));assert.ok(!componentMatches(b,actual,box));
 assert.equal(await inspectLearnedActivityNavigation({...frame,path:await png(actual,'tile-mosaic-'+which)},owner,root,noExec),null);
});
for(const mode of ['wrong-owner-current','wrong-owner-frame','wrong-layout','risk','png-ocr-mismatch'])test('rejects held-out '+mode,async()=>{
 let frame=refined(await fixture()),o=owner;
 if(mode==='wrong-owner-current'){frame.userId=999;o={...owner,userId:999};}
 if(mode==='wrong-owner-frame')frame.userId=999;
 if(mode==='wrong-layout')frame.lines.find(l=>l.text==='推荐')!.bounds=frame.lines.find(l=>l.text==='推荐')!.bounds.map(n=>n+6) as [number,number,number,number];
 if(mode==='risk')frame.lines.push({text:'安全验证',bounds:[100,900,500,1000]});
 if(mode==='png-ocr-mismatch'){const path=inside(join(tmp,'foreign.png'));await writeFile(path,await readFile(join(root,'evidence/staged-2026-11-01T11-56-23-111Z/55b28a1a-f5f7-4939-9724-c478d02bf8ca.png')));frame.path=path;}
 assert.equal(await inspectLearnedActivityNavigation(frame,o,root,noExec),null);
});
async function sourceCopies(label:string){const base=inside(join(tmp,label));for(const f of activityNavigationSource.files){const p=join(base,f.path);await mkdir(dirname(p),{recursive:true});await writeFile(p,await readFile(join(root,f.path)));}return base;}
for(const mode of ['package','user','dimensions','anchor','duplicate-anchor'])test('each selected source must have same owner and seven-anchor layout: '+mode,async()=>{
 const base=await sourceCopies('source-'+mode),files=activityNavigationSource.files as unknown as {path:string;sha256:string}[],saved=structuredClone(files);
 try{
  for(let i=1;i<files.length;i+=2){const path=join(base,files[i].path),ref=JSON.parse(await readFile(path,'utf8'));
   if(mode==='package')ref.package='com.other';if(mode==='user')ref.userId=999;if(mode==='dimensions')ref.width=1079;
   if(mode==='anchor')ref.lines.find((l:any)=>l.text==='我的淘宝').bounds[0]+=6;
   if(mode==='duplicate-anchor')ref.lines.push(structuredClone(ref.lines.find((l:any)=>l.text==='我的淘宝')));
   const bytes=Buffer.from(JSON.stringify(ref));await writeFile(path,bytes);files[i].sha256=sha(bytes);
  }
  assert.equal(await inspectLearnedActivityNavigation(refined(await fixture()),owner,base,noExec),null);
 }finally{files.splice(0,files.length,...saved);}
});
for(const sample of activityNavigationSource.files.filter(f=>f.path.endsWith('.png')))test('existing real source keeps deterministic full-component witness '+sample.path,async()=>{
 const original=JSON.parse(await readFile(join(root,sample.path.replace(/\.png$/,'.json')),'utf8')) as DeviceFrame;
 const path=inside(join(tmp,'self.png'));await writeFile(path,await readFile(join(root,sample.path)));
 const result=await inspectLearnedActivityNavigation({...rebase(original),path},owner,root,noExec);
 assert.equal(result?.state,'home');assert.equal(result.matchedComponents?.groups.length,3);
 assert.equal(result.matchedComponents?.pngSha256,sample.sha256);
});
test('chrome cannot select a different original for each of its six ROIs',async()=>{
 const base=await sourceCopies('chrome-mosaic'),files=activityNavigationSource.files as unknown as {path:string;sha256:string}[],saved=structuredClone(files);
 try{
  // Every original differs from current in one chrome ROI. Each individual ROI
  // still has an exact alternative, but none supplies the entire chrome group.
  for(let i=0;i<files.length;i+=2){const path=join(base,files[i].path),pixels=await raw(await readFile(path)),box=rois[(i/2)%2];
   for(let y=box[1];y<box[3];y++)for(let x=box[0];x<box[2];x++)pixels.fill(119,(y*1080+x)*3,(y*1080+x)*3+3);
   const bytes=await sharp(pixels,{raw:{width:1080,height:2400,channels:3}}).png().toBuffer();await writeFile(path,bytes);files[i].sha256=sha(bytes);
  }
  assert.equal(await inspectLearnedActivityNavigation(refined(await fixture()),owner,base,noExec),null);
 }finally{files.splice(0,files.length,...saved);}
});
test('witness snapshots source records and binds both current frame id and current PNG digest',async()=>{
 const frame=refined(await fixture()),result=await inspectLearnedActivityNavigation(frame,owner,root,noExec);assert.ok(result?.matchedComponents);
 const saved=JSON.stringify(result.matchedComponents),source=activityNavigationSource.files[0] as {path:string;sha256:string},prior=source.sha256;
 try{source.sha256='0'.repeat(64);assert.equal(JSON.stringify(result.matchedComponents),saved);}finally{source.sha256=prior;}
 const pixels=await raw(await readFile(frame.path));pixels.fill(119,(1000*1080+200)*3,(1000*1080+216)*3);
 const changed=await inspectLearnedActivityNavigation({...frame,id:'different-frame',path:await png(pixels,'merchandise-changed')},owner,root,noExec);
 assert.equal(changed?.state,'home');assert.equal(changed.matchedComponents?.frameId,'different-frame');assert.notEqual(changed.matchedComponents?.pngSha256,result.pngSha256);
 assert.deepEqual(changed.matchedComponents?.groups,result.matchedComponents.groups);
});
for(let i=0;i<10;i++)test('pinned original source byte integrity rejects tamper '+i,async()=>{
 const base=await sourceCopies('tamper-'+i),path=join(base,activityNavigationSource.files[i].path);await writeFile(path,Buffer.concat([await readFile(path),Buffer.from('\n')]));
 assert.equal(await inspectLearnedActivityNavigation(refined(await fixture()),owner,base,noExec),null);
});
