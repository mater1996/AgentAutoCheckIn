import test, {mock} from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readLegacyBalanceComponent as readBalanceComponent, LEGACY_BALANCE_COMPONENT_VERSION as BALANCE_COMPONENT_VERSION } from '../runner/staged/balance-component.ts';
// Replay historical v4 through the real capture seam with mocked ADB transport.
// The production default reader stays v5; keep every original glyph/tamper check.
const balance = await import('../runner/staged/balance-component.ts');
mock.module(new URL('../runner/staged/balance-component.ts',import.meta.url).href, {
 exports:{...balance,readBalanceComponent},
});
const { AdbOcrDevice } = await import('../runner/staged/device.ts');
const { readPanel, stableSettlement } = await import('../runner/staged/observations.ts');
const execute = promisify(execFile);
const source = 'evidence/staged-2026-11-01T11-56-23-111Z/55b28a1a-f5f7-4939-9724-c478d02bf8ca';
async function capture(options: { enabled?: boolean; marker?: boolean; expired?: boolean; source?:string } = {}) {
 const sample=options.source??source;
 const bytes = await readFile(sample + '.png');
 const raw = JSON.parse(await readFile(sample + '.ocr.json', 'utf8'));
 const evidenceDir = await mkdtemp('/Users/mater/.hermes/cache/scratch/balance-device-');
 let now = 1000; const calls: { file: string; args: string[]; timeout?: number }[] = [];
 const device = new AdbOcrDevice({serial:'mock-only',evidenceDir,balanceComponent:options.enabled ?? true,now:()=>now,
  exec:async(file,args,limits)=>{
   calls.push({file,args,timeout:limits?.timeoutMs});
   if(file==='adb') {
    if(args.includes('screencap')) return {stdout:bytes};
    assert.ok(args.includes('dumpsys')); return {stdout:'topResumedActivity=ActivityRecord{x u0 com.taobao.taobao/.Main}'};
   }
   if(args[1].endsWith('.png') && !args[1].includes('.balance.') && args.length===2) {
    const pages=structuredClone(raw.pages); pages[0].file=args[1];
    if(options.marker===false) pages[0].lines=pages[0].lines.filter((l:any)=>l.text!=='赚金币抵钱');
    await writeFile(args[0],JSON.stringify({pages})); if(options.expired) now=7000;
    return {stdout:''};
   }
   assert.equal(file,'/Users/mater/.hermes/cache/scratch/checkin-apple-ocr','Only local OCR may spawn a process');
   return execute(file,args,{timeout:limits?.timeoutMs ?? 3000});
  }});
 const frame=await device.capture(); return {frame,device,calls,evidenceDir};
}
test('historical v4: optional component saves real same-frame 195 correction and preserves raw lines',async()=>{
 const {frame,calls}=await capture();
 assert.equal(frame.balanceEvidence?.status,'accepted',frame.balanceEvidence?.reason ?? 'missing optional balance evidence');
 assert.equal(frame.balanceEvidence?.version,BALANCE_COMPONENT_VERSION);
 assert.equal(readPanel(frame).balance,2155);
 const raw=JSON.parse(await readFile(source+'.ocr.json','utf8')).pages[0];
 assert.deepEqual(frame.lines.filter(l=>l.bounds[1]<400),raw.lines.filter((l:any)=>l.bounds[1]<400).map((l:any)=>({text:l.text,bounds:l.bounds})));
 const balanceCalls=calls.filter(c=>c.args[1]?.includes('.balance.png'));
 assert.equal(balanceCalls.length,1);assert.ok(balanceCalls.every(c=>c.timeout!>0&&c.timeout!<=3000));
 assert.deepEqual(JSON.parse(await readFile(frame.path.replace(/\.png$/,'.json'),'utf8')),frame);
});
test('historical v4: historical193 changing balance survives capture persistence readback and stable positive settlement',async()=>{
 // Original historical image replay through mocked transport, not a new earned reward.
 const root='evidence/staged-2026-11-01T11-46-47-689Z/';
 const before=readPanel((await capture({source:root+'25811c26-a30c-4e73-8c1e-9b726e81e9f4'})).frame);
 const samples=[];
 for(let i=0;i<2;i++)samples.push(readPanel((await capture({source:root+'fdcbc6b8-2005-4d02-9534-ea9bd8a8d1a7'})).frame));
 assert.equal(before.balance,2085);assert.deepEqual(samples.map(p=>p.balance),[2135,2135]);
 const result=stableSettlement({before:{name:'Replay',instruction:'browse',done:0,total:1,reward:50,button:'去完成'},balanceBefore:before.balance!,samples,receipt:true});
 assert.equal(result.ok,true);assert.equal((result as any).delta,50);
});

test('historical v4: component evidence rejects altered binding, value, OCR, ROI and missing artifacts without legacy fallback',async()=>{
 const {frame}=await capture(); assert.equal(frame.balanceEvidence?.status,'accepted');
 for(const mutate of [
  (f:any)=>f.balanceEvidence.frameId='different-frame',
  (f:any)=>f.id='different-frame',
  (f:any)=>f.path=source+'.ocr.json',
  (f:any)=>f.balanceEvidence.sourcePngSha256='0'.repeat(64),
  (f:any)=>f.balanceEvidence.value=195,
  (f:any)=>f.balanceEvidence.version='unknown-version',
  (f:any)=>f.lines.find((l:any)=>l.text==='赚金币抵钱').bounds=[0,0,1,1],
  (f:any)=>f.balanceEvidence.glyphRecognition.text='195',
  (f:any)=>f.balanceEvidence.value=0,
  (f:any)=>f.balanceEvidence.value=9007199254740992,
  (f:any)=>f.balanceEvidence.roi.width=129,
  (f:any)=>f.balanceEvidence.cropHash='0'.repeat(64),
  (f:any)=>f.balanceEvidence.ocrEvidence.sha256='0'.repeat(64),
  (f:any)=>f.balanceEvidence.ocrEvidence.text='195',
  (f:any)=>f.balanceEvidence.ocrEvidence.bounds=[0,0,512,280],
  (f:any)=>f.balanceEvidence.ocrEvidence.path='missing-ocr',
  (f:any)=>f.balanceEvidence.ocrEvidence.cropPath='missing-crop',
  (f:any)=>f.balanceEvidence.status='rejected',
  (f:any)=>f.balanceEvidence=undefined,
 ]) { const altered=structuredClone(frame); mutate(altered); assert.equal(readPanel(altered).balance,null); }
 const evidence=frame.balanceEvidence!.ocrEvidence!;
 await writeFile(evidence.path,'{}'); assert.equal(readPanel(frame).balance,null);
});
test('historical v4: disabled component retains the legacy OCR reading',async()=>{
 const {frame,calls}=await capture({enabled:false});
 assert.equal('balanceEvidence' in frame,false); assert.equal(readPanel(frame).balance,null);
 const legacy=structuredClone(frame); legacy.lines=legacy.lines.filter(l=>l.bounds[1]>=400);legacy.lines.push({text:'195',bounds:[90,245,210,300]});
 assert.equal(readPanel(legacy).balance,195);
 assert.equal(calls.some(c=>c.args[1]?.includes('.balance.png')),false);
});
test('historical v4: missing owning marker skips the component',async()=>{
 const {frame,calls}=await capture({marker:false});
 assert.equal('balanceEvidence' in frame,false); assert.equal(readPanel(frame).balance,null);
 assert.equal(calls.some(c=>c.args[1]?.includes('.balance.png')),false);
});
test('historical v4: expired parent frame is persisted rejected without renewing capturedAt or spawning balance OCR',async()=>{
 const {frame,device,calls}=await capture({expired:true});
 assert.equal(frame.capturedAt,1000);assert.equal(frame.balanceEvidence?.status,'rejected');assert.equal(readPanel(frame).balance,null);
 assert.equal(calls.some(c=>c.args[1]?.includes('.balance.png')),false);
 await assert.rejects(()=>device.act({type:'tap',x:10,y:10},frame),/expired/);
 assert.deepEqual(JSON.parse(await readFile(frame.path.replace(/\.png$/,'.json'),'utf8')),frame);
});

