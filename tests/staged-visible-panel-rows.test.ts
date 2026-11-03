// Original real PNG/OCR copied into scratch; mutations are synthetic negatives.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createHash} from 'node:crypto';
import {inspectCurrentActivityNavigation} from '../runner/staged/activity-navigation.ts';
const source=path.resolve('evidence/staged-2026-11-02T09-24-17-023Z/9e2047d2-3c99-4c3e-bf6f-caa49359225f.json');
async function replay(t:any,mode='real'){
 const dir=fs.mkdtempSync('/Users/mater/.hermes/cache/scratch/visible-panel-');t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const bytes=fs.readFileSync(source),sha=createHash('sha256').update(bytes).digest('hex');t.after(()=>assert.equal(createHash('sha256').update(fs.readFileSync(source)).digest('hex'),sha));
 const f=JSON.parse(bytes.toString()),png=fs.readFileSync(f.path),raw=JSON.parse(fs.readFileSync(f.path.replace(/\.png$/,'.ocr.json'),'utf8'));delete f.aiPanelEvidence;f.path=path.join(dir,'frame.png');f.capturedAt=Date.now();raw.pages[0].file=f.path;
 const norm=(s:string)=>s.normalize('NFKC').replace(/\s/g,'');
 if(mode==='overlay')for(const lines of [f.lines,raw.pages[0].lines])lines.push({text:'温馨提示',bounds:[300,800,900,900]});
 if(mode==='clipped-top')for(const lines of [f.lines,raw.pages[0].lines]){const row=lines.find((l:any)=>/^.+\(\d+\/\d+\)$/.test(norm(l.text)));row.bounds=[row.bounds[0],520,row.bounds[2],560];}
 if(mode==='only-one')for(const lines of [f.lines,raw.pages[0].lines]){let count=0;for(let i=lines.length-1;i>=0;i--)if(/^.+\(\d+\/\d+\)$/.test(norm(lines[i].text))&&++count>1)lines.splice(i,1);}
 if(mode==='bad-quota')for(const lines of [f.lines,raw.pages[0].lines]){const row=lines.find((l:any)=>/^.+\(\d+\/\d+\)$/.test(norm(l.text)));row.text=row.text.replace('（0/1）','（9/1）');}
 if(mode==='foreign')f.userId=999;
 fs.writeFileSync(f.path,png);fs.writeFileSync(f.path.replace(/\.png$/,'.ocr.json'),JSON.stringify(raw));fs.writeFileSync(f.path.replace(/\.png$/,'.json'),JSON.stringify(f));
 return inspectCurrentActivityNavigation(f,{package:'com.taobao.taobao',userId:0});
}
for(const mode of ['real','clipped-top','only-one'])test('visible list uses current header and complete rows: '+mode,async t=>assert.equal((await replay(t,mode))?.state,'panel'));
for(const mode of ['overlay','foreign'])test('visible list rejects '+mode,async t=>assert.equal(await replay(t,mode),null));
test('one invalid quota does not erase other actual list rows',async t=>assert.equal((await replay(t,'bad-quota'))?.state,'panel'));
