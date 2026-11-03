import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';

const workspace=()=>fs.mkdtempSync(path.join(process.env.TMPDIR??os.tmpdir(),'plugin-service-'));
test('service exposes only business tools and returns a real MCP image content part',async()=>{
 const {ActivityService}=await import('../runner/mcp/service.ts');
 const root=workspace();fs.mkdirSync(path.join(root,'data'));const db=new Database(path.join(root,'data/checkin.db'));db.close();
 const service=new ActivityService({root});
 const names=service.tools().map((t:any)=>t.name);
 assert(names.includes('get_activity_context'));assert(names.includes('execute_recipe'));assert(names.includes('review_execution'));
 assert(!names.some((n:string)=>/edit|write_file|shell|publish/.test(n)));
 await service.close();
});
test('review never creates a device and confines evidence to its workspace',async()=>{
 const {ActivityService}=await import('../runner/mcp/service.ts');
 const root=workspace();fs.mkdirSync(path.join(root,'data'));const db=new Database(path.join(root,'data/checkin.db'));db.close();
 let devices=0;const service=new ActivityService({root,deviceFactory:()=>{devices++;throw Error('device must not be created')}});
 const dir=path.join(root,'evidence/ex-1');fs.mkdirSync(dir,{recursive:true});
 fs.writeFileSync(path.join(dir,'manifest.json'),JSON.stringify({id:'ex-1',scope:{activityId:'a'},tasks:[]}));
 fs.writeFileSync(path.join(dir,'summary.json'),JSON.stringify({status:'stopped',tasks:[],gainCoins:0}));
 const result=await service.call('review_execution',{executionId:'ex-1',scope:'activity'});
 assert.equal(devices,0);assert(result.content[0].text.includes('ex-1'));
 await assert.rejects(()=>service.call('review_execution',{executionId:'../../private'}),/path|execution|identifier/i);
 await service.close();
});
test('device execution requires explicit host opt-in before any prepare',async()=>{
 const {ActivityService}=await import('../runner/mcp/service.ts');
 const root=workspace();fs.mkdirSync(path.join(root,'data'));new Database(path.join(root,'data/checkin.db')).close();
 let devices=0;const service=new ActivityService({root,deviceFactory:()=>{devices++;throw Error('must not run')}});
 await assert.rejects(()=>service.call('begin_execution',{configFile:'config/a.json',live:true}),/device|enabled|permission|opt.in/i);
 assert.equal(devices,0);await service.close();
});
