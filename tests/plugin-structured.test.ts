import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import Database from 'better-sqlite3';import {Storage,MIGRATION_MARKER} from '../runner/storage/index.ts';import {readStructured,writeStructured} from '../runner/storage/structured.ts';
test('migrated structured state reads SQLite even if old JSON is changed and never writes legacy JSON',()=>{
 const root=fs.mkdtempSync(path.join(process.env.TMPDIR??os.tmpdir(),'structured-db-'));fs.mkdirSync(path.join(root,'data'));fs.writeFileSync(path.join(root,'data/item.json'),JSON.stringify({consumed:false}));
 const s=new Storage(root);s.sqlite.prepare('INSERT INTO storage_meta VALUES(?,?)').run(MIGRATION_MARKER,'{}');s.putDocument('data/item.json',{consumed:true});s.close();
 assert.deepEqual(readStructured(root,'data/item.json'),{consumed:true});writeStructured(root,'data/item.json',{consumed:true,failed:true});assert.deepEqual(readStructured(root,'data/item.json'),{consumed:true,failed:true});assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root,'data/item.json'),'utf8')),{consumed:false});
 assert.throws(()=>readStructured(root,'data/missing.json'),/missing in SQLite/);
});

test('a symlinked workspace and JSON null document retain SQLite authority',t=>{
 const root=fs.realpathSync(fs.mkdtempSync(path.join(process.env.TMPDIR??os.tmpdir(),'structured-alias-'))),alias=root+'-alias';fs.symlinkSync(root,alias);
 t.after(()=>{fs.rmSync(alias,{force:true});fs.rmSync(root,{recursive:true,force:true});});
 const s=new Storage(root);s.sqlite.prepare('INSERT INTO storage_meta VALUES(?,?)').run(MIGRATION_MARKER,'{}');s.putDocument('data/null.json',null);s.close();
 assert.equal(readStructured(alias,'data/null.json'),null);writeStructured(alias,'data/null.json',{saved:true});assert.deepEqual(readStructured(root,'data/null.json'),{saved:true});
});
