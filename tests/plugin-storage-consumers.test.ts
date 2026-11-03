import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {Storage,MIGRATION_MARKER} from '../runner/storage/index.ts';
import {saveInventory,loadInventoryLatest} from '../runner/inventory.ts';
import {savePlaybook,loadPlaybook} from '../runner/playbook.ts';
import {recordTaskFailures,loadTaskFailures,isOpeningNoEffectFailure} from '../runner/task-failures.ts';
import crypto from 'node:crypto';
import {observedRecipePath,saveObservedRecipeCandidate,updateObservedRecipeValidation,loadObservedRecipe} from '../runner/observed-recipe.ts';

function fixture(t:any){
 const previous=process.cwd(),root=fs.realpathSync(fs.mkdtempSync(path.join(process.env.TMPDIR!,'storage-consumers-')));
 process.chdir(root);const store=new Storage(root);store.sqlite.prepare('INSERT INTO storage_meta VALUES(?,?)').run(MIGRATION_MARKER,'{}');
 t.after(()=>{store.close();process.chdir(previous);fs.rmSync(root,{recursive:true,force:true});});return {root,store};
}
function stale(root:string,key:string,value:any){const file=path.join(root,key);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(value));return file;}

test('inventory reads migrated documents and saves latest/history only in SQLite',t=>{
 const {root,store}=fixture(t),key='data/inventory/a_b.json',file=stale(root,key,{stale:true});
 const inv:any={account:'a',activity:'b',collected_at:'2026-11-03T00:00:00Z',tasks:[]};store.putDocument(key,inv);
 assert.deepEqual(loadInventoryLatest('a','b'),inv);
 const next={...inv,tasks:[{name:'fresh'}]},saved=saveInventory(next);
 assert.deepEqual(store.getDocument(key),next);assert.deepEqual(store.getDocument(saved.history),next);
 assert.deepEqual(JSON.parse(fs.readFileSync(file,'utf8')),{stale:true});assert.equal(fs.existsSync(saved.history),false);
 store.sqlite.prepare('DELETE FROM legacy_document WHERE key=?').run(key);assert.equal(loadInventoryLatest('a','b'),null);
});

test('playbooks use migrated documents without legacy fallback or writes',t=>{
 const {root,store}=fixture(t),key='data/playbook/a_b.json',file=stale(root,key,{stale:true});
 const pb:any={account:'a',activity:'b',version:2};store.putDocument(key,pb);assert.deepEqual(loadPlaybook('a','b'),pb);
 savePlaybook({...pb,version:3});assert.deepEqual(store.getDocument(key),{...pb,version:3});
 assert.deepEqual(JSON.parse(fs.readFileSync(file,'utf8')),{stale:true});
 store.sqlite.prepare('DELETE FROM legacy_document WHERE key=?').run(key);assert.equal(loadPlaybook('a','b'),null);
});

test('migrated unknown task failures remain blocked and persist only in SQLite',t=>{
 const {root,store}=fixture(t),now=new Date('2026-11-03T12:00:00Z'),day=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
 const key='data/task-failures/'+crypto.createHash('sha256').update(JSON.stringify(['a','b',day])).digest('hex')+'.json';
 const evidence:any={round:1,attempt:{name:'task',instruction:'browse',attemptId:'one',startedAt:now.getTime()},before:{name:'task',done:0,total:1},after:null,workflow:{ok:false},verification:'unknown'};
 const entry={taskName:'task',instruction:'browse',runId:1,timestamp:now.toISOString(),localDay:day,evidence};
 const file=stale(root,key,{entries:[]});store.putDocument(key,{localDay:day,entries:[entry]});
 assert.deepEqual(loadTaskFailures('a','b',{now}),[entry]);assert.equal(isOpeningNoEffectFailure(entry),false);
 recordTaskFailures('a','b',2,[{...evidence,attempt:{...evidence.attempt,attemptId:'two'}}],{now});
 assert.equal(store.getDocument<any>(key).entries.length,2);assert.deepEqual(JSON.parse(fs.readFileSync(file,'utf8')),{entries:[]});
 store.sqlite.prepare('DELETE FROM legacy_document WHERE key=?').run(key);assert.deepEqual(loadTaskFailures('a','b',{now}),[]);
});

test('observed recipe validation uses migrated evidence and never restores stale JSON',t=>{
 const {root,store}=fixture(t),task={name:'task',instruction:'browse'},yaml=path.join(root,'task.yaml');fs.writeFileSync(yaml,'cases: []');
 const file=observedRecipePath('a','b',task.name),key=path.relative(root,file),hash=crypto.createHash('sha256').update(fs.readFileSync(yaml)).digest('hex');
 const evidence=(runId:number):any=>({taskName:task.name,instruction:task.instruction,yamlHash:hash,runId,report:'report.html',timestamp:'2026-11-03T00:00:00Z',status:'completed',before:{name:'task',done:0,total:2},after:{name:'task',done:1,total:2}});
 stale(root,key,{state:'stale'});store.putDocument(key,{state:'validated',validations:2,taskName:task.name,instruction:task.instruction,yaml,yamlHash:hash,evidence:[evidence(1),evidence(2)]});
 assert.equal(loadObservedRecipe('a','b',task)?.state,'validated');
 assert.equal(saveObservedRecipeCandidate('a','b',task,{yaml}).state,'validated');
 const updated=updateObservedRecipeValidation('a','b',task,{...evidence(3),status:'unknown'});assert.equal(updated.state,'stale');assert.equal(loadObservedRecipe('a','b',task),null);
 assert.deepEqual(store.getDocument(key),updated);assert.deepEqual(JSON.parse(fs.readFileSync(file,'utf8')),{state:'stale'});
 store.sqlite.prepare('DELETE FROM legacy_document WHERE key=?').run(key);assert.equal(loadObservedRecipe('a','b',task),null);
});

test('log slicing resumes SQLite offsets and marks without rewriting legacy JSON',async t=>{
 const {root,store}=fixture(t),file=stale(root,'data/log-state.json',{'run.log':0});store.putDocument('data/log-state.json',{'run.log':2});
 fs.mkdirSync(path.join(root,'midscene_run/log'),{recursive:true});fs.writeFileSync(path.join(root,'midscene_run/log/run.log'),'old\nskip\nfresh\n');
 const {sliceLogs,markLogs}=await import('../runner/logslice.ts');
 const sliced=sliceLogs('fixture');assert.equal(fs.readFileSync(path.join(sliced.dir,'run.log'),'utf8'),'fresh\n');
 const marks=markLogs();assert.deepEqual(store.getDocument('data/log-state.json'),marks);assert.deepEqual(JSON.parse(fs.readFileSync(file,'utf8')),{'run.log':0});
});

test('derived templates are stored in SQLite after migration',async t=>{
 const {root,store}=fixture(t),file=stale(root,'data/templates/taobao.json',{stale:true});
 // Import the singleton only after changing cwd to the fixture.
 const canonical=await import('../runner/storage/client.ts'),legacy=await import('../db/client.ts');t.after(()=>{if(canonical.sqlite.open)canonical.sqlite.close();});
 assert.equal(legacy.sqlite,canonical.sqlite);assert.equal(legacy.dbPath,path.join(root,'data/checkin.db'));
 const {saveTemplates}=await import('../runner/derive.ts');saveTemplates('taobao',[]);
 assert.deepEqual(store.getDocument('data/templates/taobao.json'),{platform:'taobao',templates:[]});assert.deepEqual(JSON.parse(fs.readFileSync(file,'utf8')),{stale:true});
});
