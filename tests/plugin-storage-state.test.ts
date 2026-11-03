import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {openStorage} from '../runner/storage/index.ts';

test('round state scope matches independent of property order and reservation identity cannot be replaced',t=>{
 const root=fs.realpathSync(fs.mkdtempSync(path.join(process.env.TMPDIR || '/Users/mater/.hermes/cache/scratch','plugin-storage-state-')));
 const s=openStorage(root);t.after(()=>{s.close();fs.rmSync(root,{recursive:true,force:true});});
 const scope={appId:'a',accountId:'b'},attempt={reservationId:'r',identity:'task-1',status:'pending'};
 s.putRoundState('data/state.json',{batchId:'b',scope,attempts:[attempt]});
 assert.ok(s.getRoundState('data/state.json','b',{accountId:'b',appId:'a'}));
 assert.throws(()=>s.putRoundState('data/state.json',{batchId:'b',scope,attempts:[{...attempt,identity:'task-2',status:'consumed'}]}),/identity|binding/i);
 assert.throws(()=>s.putRoundState('data/state.json',{batchId:'b',scope,attempts:[attempt,attempt]}),/duplicate/i);
});

test('document CAS and evidence links roll back together on failure',t=>{
 const root=fs.realpathSync(fs.mkdtempSync(path.join(process.env.TMPDIR || '/Users/mater/.hermes/cache/scratch','plugin-storage-cas-')));
 const s=openStorage(root);t.after(()=>{s.close();fs.rmSync(root,{recursive:true,force:true});});
 s.putDocument('data/a.json',{v:1});assert.throws(()=>s.putDocument('data/a.json',{v:2},{expectedRevision:0}),/revision/);
 assert.deepEqual(s.getDocument('data/a.json'),{v:1});
 assert.throws(()=>s.putDocument('data/a.json',{v:3},{evidencePaths:['../outside.png']}),/root|path/i);assert.deepEqual(s.getDocument('data/a.json'),{v:1});
});

test('unknown round reservation cannot reopen as retryable pending state',t=>{
 const root=fs.realpathSync(fs.mkdtempSync(path.join(process.env.TMPDIR!,'storage-unknown-'))),s=openStorage(root);
 t.after(()=>{s.close();fs.rmSync(root,{recursive:true,force:true});});
 const state={batchId:'b',scope:{appId:'a'},attempts:[{reservationId:'r',identity:'task',status:'unknown'}]};s.putRoundState('data/state.json',state);
 assert.throws(()=>s.putRoundState('data/state.json',{...state,attempts:[{...state.attempts[0],status:'pending'}]}),/unknown|reopen/i);
 assert.deepEqual(s.getRoundState('data/state.json'),state);
});
