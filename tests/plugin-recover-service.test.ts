import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import Database from 'better-sqlite3';import {ActivityService} from '../runner/mcp/service.ts';
const decode=(r:any)=>JSON.parse(r.content[0].text);
function setup(t:any,partial=false){
 const root=fs.mkdtempSync(path.join(process.env.TMPDIR!,'plugin-recover-service-'));const previousSerial=process.env.ADB_SERIAL;process.env.ADB_SERIAL='offline-'+path.basename(root);t.after(()=>{if(previousSerial===undefined)delete process.env.ADB_SERIAL;else process.env.ADB_SERIAL=previousSerial;});fs.mkdirSync(path.join(root,'data'),{recursive:true});new Database(path.join(root,'data/checkin.db')).close();fs.mkdirSync(path.join(root,'runner/staged'),{recursive:true});fs.writeFileSync(path.join(root,'runner/staged/offline.ts'),'// fixture');
 const cfg=JSON.parse(fs.readFileSync('config/plugin/taobao-coin.json','utf8'));cfg.round.priorPlanFiles=[];delete cfg.round.stateFile;cfg.knowledgeIndex='data/index.json';cfg.round.batchId='fixture';fs.writeFileSync(path.join(root,'data/config.json'),JSON.stringify(cfg));fs.writeFileSync(path.join(root,'data/index.json'),JSON.stringify({knowledgeBundle:'data/knowledge.json'}));fs.writeFileSync(path.join(root,'data/knowledge.json'),'{}');
 let entries=0,returns=0,archives=0;
 const service=new ActivityService({root,allowDevice:true,deviceFactory:()=>({prepare:async()=>{},cleanup:async()=>({errors:[]}),returnHome:async()=>({confirmed:true})}),runtimeFactory:()=>({adoptSelection:async()=>({status:'completed'}),stage:async(id:string)=>{
 if(id==='open_task')entries++;
 if(id==='task_receipt')return {status:'stopped',error:'ordinary receipt failure'};
 if(id==='return_list')return {status:++returns===1?'stopped':'completed',error:returns===1?'navigation failure':undefined};
 return {status:'completed'};
 }}),nextFinder:async(o:any)=>{
 if(o.attempts.length){assert.equal(o.attempts[0].result.returned,true);return {decision:'finish',coverage:{complete:true,topVerified:true,bottomVerified:true}};}
 const task={name:'fixture',instruction:'browse',done:0,total:1};return {decision:'task',item:{...task,decision:'do',times:1},selection:{task,balanceBefore:10,taskAttemptId:o.taskAttemptId,evidenceKey:'fixture'}};
 },saveTask:async()=>{archives++;return {runId:1,v2Archived:!partial,partial,gainCoins:0}}});
 t.after(async()=>{await service.close();fs.rmSync(root,{recursive:true,force:true});});return {service,root,stats:()=>({entries,returns,archives})};
}
test('safe return recovery updates the durable original attempt without second entry or gain',async t=>{
 const {service,root,stats}=setup(t);await service.call('begin_execution',{configFile:'data/config.json',live:true});await service.call('execute_recipe',{recipeId:'find-next-task'});await service.call('execute_recipe',{recipeId:'execute-task'});
 await service.call('recover',{strategy:'return-list',reason:'ordinary navigation failure'});
 const db=new Database(path.join(root,'data/checkin.db'),{readonly:true});try{const row=db.prepare('select result_json from plugin_attempt').get()as any;assert.equal(JSON.parse(row.result_json).returned,true);}finally{db.close();}
 await service.call('execute_recipe',{recipeId:'find-next-task'});assert.deepEqual(stats(),{entries:1,returns:2,archives:1});assert.equal(decode(await service.call('get_run_state')).attempts[0].result.status,'stopped');
});
test('persistence failure blocks recovery input as well as selecting another task',async t=>{
 const {service,stats}=setup(t,true);await service.call('begin_execution',{configFile:'data/config.json',live:true});await service.call('execute_recipe',{recipeId:'find-next-task'});await service.call('execute_recipe',{recipeId:'execute-task'});
 await assert.rejects(()=>service.call('recover',{strategy:'return-list',reason:'cannot fix persistence by navigation'}),/persist/i);assert.equal(stats().returns,1);
});
