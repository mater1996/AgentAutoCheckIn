import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';
import {rootedPath,documentKey} from '../runner/storage/index.ts';
import {readStructured,usesStructuredStorage} from '../runner/storage/structured.ts';
test('internal symlink aliases reject before document and state authority selection',t=>{
 const root=fs.realpathSync(fs.mkdtempSync(path.join(process.env.TMPDIR!,'storage-alias-')));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));fs.mkdirSync(path.join(root,'data'));fs.writeFileSync(path.join(root,'data/state.json'),'{}');fs.symlinkSync('data',path.join(root,'alias'));
 for(const ref of ['alias/state.json','alias/missing.json']){
  assert.throws(()=>rootedPath(root,ref),/symlink/i);assert.throws(()=>documentKey(root,ref),/symlink/i);assert.throws(()=>readStructured(root,ref),/symlink/i);assert.throws(()=>usesStructuredStorage(path.join(root,ref),root),/symlink/i);
 }
});
