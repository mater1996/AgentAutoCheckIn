import assert from 'node:assert/strict';
import test from 'node:test';
import { scopedId, validateTaskRecords } from '../runner/task-records.ts';
const scope={appId:'taobao',accountId:'tb_main',activityId:'tb_coin'};
const fixture=()=>({schemaVersion:1,scope,app:{id:'taobao',package:'com.taobao.taobao'},account:{id:'tb_main',appId:'taobao',userId:0},activity:{id:'tb_coin',accountId:'tb_main',assetId:'coins'},tasks:[{id:'task-a',scope,name:'浏览任务',instruction:'浏览15秒'}],inventories:[{id:'inv-a',scope,complete:true,taskSnapshotIds:['snap-a'],source:'evidence/a.json'}],snapshots:[{id:'snap-a',scope,inventoryId:'inv-a',taskId:'task-a',done:0,total:1}],plans:[{id:'plan-a',scope,inventoryId:'inv-a',decisions:[{taskSnapshotId:'snap-a',decision:'do'}]}],executions:[{id:'exec-a',scope,runId:129,taskSnapshotId:'snap-a',planId:'plan-a',decisionTaskSnapshotId:'snap-a',status:'supervised_success',evidenceDir:'evidence/a',resultFile:'evidence/a/result.json',assetId:'coins'}],experiences:[{id:'experience-a',scope,sourceExecutionIds:['exec-a'],taskIds:['task-a'],scriptId:'script-a',validation:'supervised_only'}],scripts:[{id:'script-a',scope,path:'probes/a.ts',mode:'interactive_probe'}],progress:[{id:'progress-a',scope,planId:'plan-a',executionIds:['exec-a'],requiresInventoryRefresh:true}]});
test('scoped identifiers separate same task across activities and accounts',()=>{
 assert.notEqual(scopedId('task',scope,['same','浏览']),scopedId('task',{...scope,activityId:'other'},['same','浏览']));
 assert.notEqual(scopedId('task',scope,['same','浏览']),scopedId('task',{...scope,accountId:'other'},['same','浏览']));
 assert.equal(scopedId('task',scope,['same','浏览']),scopedId('task',scope,['same','浏览']));
});
test('valid complete relationship graph is accepted',()=>validateTaskRecords(fixture()));
test('missing task reference is rejected',()=>{const b=fixture();b.snapshots[0].taskId='missing';assert.throws(()=>validateTaskRecords(b),/task/);});
test('execution must point to matching plan decision even after a partial refresh',()=>{const b=fixture();b.executions[0].decisionTaskSnapshotId='missing';assert.throws(()=>validateTaskRecords(b),/decision/);});
test('execution cannot attach evidence to a different asset',()=>{const b=fixture();b.executions[0].assetId='other';assert.throws(()=>validateTaskRecords(b),/asset/);});
test('duplicate identities are rejected',()=>{const b=fixture();b.tasks.push({...b.tasks[0]});assert.throws(()=>validateTaskRecords(b),/Duplicate/);});
test('experience cannot reference an absent execution',()=>{const b=fixture();b.experiences[0].sourceExecutionIds=['absent'];assert.throws(()=>validateTaskRecords(b),/execution/);});
test('replaced task may not inherit old execution',()=>{const b=fixture();b.tasks.push({...b.tasks[0],id:'new-task',name:'replacement'});b.snapshots.push({...b.snapshots[0],id:'new-snap',taskId:'new-task'});b.inventories[0].taskSnapshotIds.push('new-snap');b.plans[0].decisions.push({taskSnapshotId:'new-snap',decision:'skip'});b.executions[0].taskSnapshotId='new-snap';assert.throws(()=>validateTaskRecords(b),/identity/);});
test('rejects cross-activity execution even when task name is identical',()=>{
 const b=fixture(); b.executions[0].scope={...scope,activityId:'other'};
 assert.throws(()=>validateTaskRecords(b),/scope/);
});
