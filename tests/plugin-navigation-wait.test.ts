import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';
import {readNavigation} from '../runner/staged/navigation-reader.ts';
function fixture(t:any){const dir=fs.mkdtempSync(path.join(process.env.TMPDIR!,'plugin-navigation-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const frame={id:'synthetic-navigation',path:path.join(dir,'frame.png'),width:1080,height:2400,capturedAt:Date.now(),package:'com.taobao.taobao',userId:0,lines:[]};const png=Buffer.alloc(33);Buffer.from([137,80,78,71,13,10,26,10]).copy(png);png.write('IHDR',12);png.writeUInt32BE(1080,16);png.writeUInt32BE(2400,20);fs.writeFileSync(frame.path,png);fs.writeFileSync(path.join(dir,'frame.json'),JSON.stringify(frame));return {frame,owner:{package:frame.package,userId:0},evidenceDir:dir,maxMs:1,stageId:'open_list',expectedCheckpoint:'list_visible'};}
test('host-owned decisions may wait beyond the former navigation transport deadline',async t=>{
 const result=await readNavigation({...fixture(t),model:{hostManagedDecisions:true,query:async()=>{await new Promise(r=>setTimeout(r,20));return {pageKind:'panel',targets:[]};}}});assert.equal(result.status,'accepted');
});
test('HTTP model navigation retains its finite transport timeout',async t=>{
 const result=await readNavigation({...fixture(t),model:{query:async()=>new Promise(()=>{})}});assert.equal(result.status,'rejected');assert.equal(result.error,'Navigation query failed');
});
