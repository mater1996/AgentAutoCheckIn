import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {Storage,MIGRATION_MARKER} from '../runner/storage/index.ts';
const project=path.resolve(import.meta.dirname,'..');
function fixture(t:any){const root=fs.realpathSync(fs.mkdtempSync(path.join(process.env.TMPDIR!,'storage-tools-'))),s=new Storage(root);s.sqlite.prepare('INSERT INTO storage_meta VALUES(?,?)').run(MIGRATION_MARKER,'{}');t.after(()=>{s.close();fs.rmSync(root,{recursive:true,force:true});});return {root,s};}
function run(root:string,script:string){return spawnSync(process.execPath,[path.join(project,'node_modules/tsx/dist/cli.mjs'),path.join(project,script)],{cwd:root,encoding:'utf8',env:{...process.env,CHECKIN_DB_PATH:'',CHECKIN_DB:''}});}
test('pre-run backup uses migrated canonical DB when retired DB is absent',t=>{
 const {root,s}=fixture(t);s.putDocument('data/proof.json',{canonical:true});const r=run(root,'probes/pre-text-policy-backup.ts');assert.equal(r.status,0,r.stderr);
 const report=JSON.parse(r.stdout);assert.equal(report.quick_check,'ok');assert.equal(fs.existsSync(path.join(root,'db/checkin.db')),false);
});
for(const script of ['archive-supervised-result','archive-supervised-task3','archive-observation-only','split-task-records','migrate-task-records'])test(`retired JSON writer ${script} refuses migrated roots before file access`,t=>{
 const {root}=fixture(t),r=run(root,'tools/'+script+'.ts');assert.notEqual(r.status,0);assert.match(r.stderr,/retired.*migration|migration.*retired/i);assert.deepEqual(fs.readdirSync(path.join(root,'data')).filter(x=>!x.startsWith('checkin.db')),[]);
});
for(const version of [1,2])test(`v${version} validator uses DB graph documents without legacy JSON`,t=>{
 const {root,s}=fixture(t),scope={appId:'app',accountId:'acct',activityId:'act'},ks={appId:'app',activityId:'act'};
 s.sqlite.exec("CREATE TABLE account(id TEXT,app TEXT,package TEXT,user_id INTEGER); INSERT INTO account VALUES('acct','app','test.app',0); CREATE TABLE activity(id TEXT,account_id TEXT,asset_id TEXT); INSERT INTO activity VALUES('act','acct','coin');");
 const common={scope,account:{id:'acct',appId:'app',userId:0},activity:{id:'act',accountId:'acct',assetId:'coin'},tasks:[],inventories:[],snapshots:[],plans:[],executions:[],progress:[]};
 if(version===1){const base='data/task-records/taobao/tb_main/tb_coin';s.putDocument(base+'/bundle.json',{...common,schemaVersion:1,app:{id:'app',package:'test.app'},experiences:[],scripts:[],migration:{automaticRunnerIntegrated:false}});s.putDocument(base+'/index.json',{scope,records:Object.fromEntries(['tasks','inventories','snapshots','plans','executions','experiences','scripts','progress'].map(k=>[k,[]]))});}
 else{const knowledge='data/knowledge.json',account='data/account.json';s.putDocument(knowledge,{schemaVersion:2,scope:ks,application:{id:'app',package:'test.app'},activity:{id:'act',appId:'app',assetId:'coin'},taskDefinitions:[],scriptVersions:[],experienceVersions:[]});s.putDocument(account,{...common,schemaVersion:2,activity:{...common.activity,activityDefinitionId:'act'}});s.putDocument('data/task-records-v2/index.json',{knowledgeBundle:knowledge,accountBundle:account,knowledgeRecords:{},accountRecords:{}});}
 const r=run(root,version===1?'tools/validate-task-records.ts':'tools/validate-task-records-v2.ts');assert.equal(r.status,0,r.stderr);assert.equal(JSON.parse(r.stdout).valid,true);
});
