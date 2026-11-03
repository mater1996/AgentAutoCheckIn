import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
const root=new URL('../',import.meta.url).pathname;
const history='evidence/staged-2026-11-01T17-01-55-133Z/';
const ids=['68bb8b03-bd5d-48e3-b6f8-e64af551261c','1f9cd4fe-0927-4a6a-90c9-e1f49d934c2b'];
const owner={package:'com.taobao.taobao',userId:0};
const sha=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
async function api(){try{return await import('../runner/staged/entry-recovery.ts');}catch(e:any){if(e.code==='ERR_MODULE_NOT_FOUND')return null;throw e;}}
async function original(i=0){return JSON.parse(await fs.readFile(path.join(root,history,ids[i]+'.json'),'utf8'));}
async function fixture(dir:string,base:any,now:number,edit?:(f:any,r:any)=>void){
 const f=structuredClone(base),r=JSON.parse(await fs.readFile(base.path.replace(/\.png$/,'.ocr.json'),'utf8'));
 f.id=randomUUID();f.path=path.join(dir,f.id+'.png');f.capturedAt=now;r.pages[0].file=f.path;
 edit?.(f,r);
 await fs.copyFile(base.path,f.path);
 await fs.writeFile(f.path.replace(/\.png$/,'.json'),JSON.stringify(f));
 await fs.writeFile(f.path.replace(/\.png$/,'.ocr.json'),JSON.stringify(r));return f;
}
test('run210 two immutable references produce current skip centers and full provenance',async()=>{
 const m=await api();assert.ok(m?.inspectEntryRecovery,'production entry recovery inspector missing');
 assert.equal(m.entryRecoverySource.version,'entry-recovery-210-v1');assert.equal(m.entryRecoverySource.files.length,6);
 for(const x of m.entryRecoverySource.files)assert.equal(sha(await fs.readFile(path.join(root,x.path))),x.sha256);
 for(let i=0;i<2;i++){
  const f=await original(i),p=await m.inspectEntryRecovery(f,owner);assert.ok(p);
  assert.equal(p.state,'known-launch-ad');assert.equal(p.frameId,f.id);assert.equal(p.version,m.entryRecoverySource.version);
  assert.deepEqual(p.action,{type:'tap',x:i?921:920,y:157});
  assert.equal(p.pngSha256,sha(await fs.readFile(f.path)));
  assert.equal(p.frameJsonSha256,sha(await fs.readFile(f.path.replace(/\.png$/,'.json'))));
  assert.equal(p.rawOcrSha256,sha(await fs.readFile(f.path.replace(/\.png$/,'.ocr.json'))));
  assert.deepEqual(p.provenance,m.entryRecoverySource);
 }
});
for(const mode of ['wrong-owner','wrong-package','risk','split-risk','raw-risk','duplicate-skip','fake-skip','shift','invalid-bounds','empty','engine','raw-file','raw-size','saved-owner','saved-id','observation-error','content-missing'])test(`narrow inspector rejects ${mode}`,async()=>{
 const m=await api(),dir=await fs.mkdtemp('/Users/mater/.hermes/cache/scratch/entry-inspect-');
 const f=await fixture(dir,await original(),Date.now(),(f,r)=>{
  const add=(text:string)=>{const l={text,bounds:[10,10,100,30]};f.lines.push(l);r.pages[0].lines.push(l);};
  if(mode==='wrong-owner')f.userId=999;if(mode==='wrong-package')f.package='com.other';
  if(mode==='risk')add('确认付款');if(mode==='split-risk'){add('登');add('录');}if(mode==='raw-risk')r.pages[0].lines.push({text:'授权',bounds:[10,10,100,30]});
  if(mode==='duplicate-skip')add('跳 过');
  if(mode==='fake-skip') {f.lines.find((l:any)=>l.text==='跳过').text='跳过广告';r.pages[0].lines=f.lines;}
  if(mode==='shift'){f.lines.find((l:any)=>l.text==='跳过').bounds=[500,130,600,180];r.pages[0].lines=f.lines;}
  if(mode==='invalid-bounds'){f.lines[0].bounds=[-1,0,10,10];r.pages[0].lines=f.lines;}
  if(mode==='empty'){f.lines=[];r.pages[0].lines=[];}
  if(mode==='engine')r.engine='other';if(mode==='raw-file')r.pages[0].file='other.png';if(mode==='raw-size')r.pages[0].width=100;
  if(mode==='observation-error')f.observationError='failed';
  if(mode==='content-missing'){f.lines.splice(4,1);r.pages[0].lines=f.lines;}
 });
 if(mode.startsWith('saved-')){const p=f.path.replace(/\.png$/,'.json'),v=JSON.parse(await fs.readFile(p,'utf8'));if(mode==='saved-id')v.id='other';else v.userId=999;await fs.writeFile(p,JSON.stringify(v));}
 assert.equal(await m.inspectEntryRecovery(f,owner),null);
});
test('complete page pixels reject central, skip, footer and system navigation occlusion',async()=>{
 const {default:sharp}=await import('sharp'),m=await api(),dir=await fs.mkdtemp('/Users/mater/.hermes/cache/scratch/entry-pixels-');
 for(const box of [[850,110,1000,205],[250,950,850,1450],[400,2070,650,2230],[0,2300,1080,2400]]){
  const f=await fixture(dir,await original(1),Date.now());
  const b=await sharp(f.path).composite([{input:await sharp({create:{width:box[2]-box[0],height:box[3]-box[1],channels:3,background:'#777'}}).png().toBuffer(),left:box[0],top:box[1]}]).png().toBuffer();await fs.writeFile(f.path,b);
  assert.equal(await m.inspectEntryRecovery(f,owner),null);
 }
});
test('split skip across status lines cannot create a second global skip control',async()=>{
 const m=await api(),dir=await fs.mkdtemp('/Users/mater/.hermes/cache/scratch/entry-split-skip-');
 const f=await fixture(dir,await original(),Date.now(),(f,r)=>{
  for(const text of ['跳','过']){const l={text,bounds:[10,10,60,40]};f.lines.push(l);r.pages[0].lines.push(l);}
 });
 assert.equal(await m.inspectEntryRecovery(f,owner),null);
});
test('reference manifest cannot be mutated into new authority',async()=>{
 const m=await api();assert.equal(Object.isFrozen(m.entryRecoverySource),true);assert.equal(Object.isFrozen(m.entryRecoverySource.files),true);assert.ok(m.entryRecoverySource.files.every(Object.isFrozen));
});
test('alternate sourceRoot must preserve all six original bytes and is revalidated on every call',async()=>{
 const m=await api(),dir=await fs.mkdtemp('/Users/mater/.hermes/cache/scratch/entry-sources-');
 for(const x of m.entryRecoverySource.files){const p=path.join(dir,x.path);await fs.mkdir(path.dirname(p),{recursive:true});await fs.copyFile(path.join(root,x.path),p);}
 const f=await original();assert.ok(await m.inspectEntryRecovery(f,owner,dir));
 await fs.appendFile(path.join(dir,m.entryRecoverySource.files[5].path),' ');
 assert.equal(await m.inspectEntryRecovery(f,owner,dir),null);
});
