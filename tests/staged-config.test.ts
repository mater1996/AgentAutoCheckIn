import test from 'node:test';
import assert from 'node:assert/strict';
import {validateStagedConfig,loadPlanDecisions} from '../runner/staged/config.ts';
test('validated config enforces one-task authorized scope and stage definitions',()=>{
 const c:any={scope:{appId:'a',accountId:'b',activityId:'c',userId:0},package:'p',assetId:'coins',model:{baseUrl:'http://127.0.0.1:1/v1',name:'v'},limits:{maxTasks:1,sessionMs:1000,stageMs:500,agentCalls:5,stageActions:3,inventoryPages:3,maxReturns:3},constraints:['no payment'],stages:Object.fromEntries(['open_app','enter_activity','open_list','open_task','task_receipt','return_list'].map(x=>[x,{goal:x,checkpoint:x}]))};
 assert.equal(validateStagedConfig(c),c);assert.throws(()=>validateStagedConfig({...c,limits:{...c.limits,maxTasks:2}}),/one task/);
 assert.throws(()=>validateStagedConfig({...c,scope:{...c.scope,userId:-1}}),/scope/);
 const learned={enabled:true,version:'continuous-browse-candidate-v1',sourceRunId:153};
 assert.equal(validateStagedConfig({...c,learnedBrowse:learned}).learnedBrowse.version,learned.version);
 const current={...c,learnedBrowse:learned,aiPanelReader:true,scriptValidationMode:false,balanceComponent:false,panelReadPolicy:'focused-v1',taskObservationPolicy:'current-components-v1'};
 assert.equal(validateStagedConfig({...current,taskCompletionPolicy:'current-keywords-v1'}).taskCompletionPolicy,'current-keywords-v1');
 for(const value of ['wrong',true])assert.throws(()=>validateStagedConfig({...current,taskCompletionPolicy:value}),/completion policy/i);
 assert.throws(()=>validateStagedConfig({...c,taskCompletionPolicy:'current-keywords-v1'}),/completion policy/i);
 const immersive={enabled:true,version:'immersive-browse-candidate-v1',sourceRunId:145,task:{name:'好物沉浸看',instruction:'浏览'},observationBudgetMs:20000};
 assert.equal(validateStagedConfig({...c,immersiveBrowse:immersive}).immersiveBrowse,immersive);
 assert.equal(validateStagedConfig({...c,immersiveBrowse:{...immersive,enabled:false,observationBudgetMs:1000}}).immersiveBrowse.enabled,false);
 for(const value of [null,{}, {...immersive,enabled:'true'},{...immersive,version:'wrong'},{...immersive,sourceRunId:153},
  {...immersive,task:null},{...immersive,task:{name:1,instruction:'浏览'}},{...immersive,task:{name:'',instruction:'浏览'}},
  {...immersive,task:{name:'好物沉浸看',instruction:' '}},...[-1,999,20001,1500.5,NaN,Infinity,'20000'].map(observationBudgetMs=>({...immersive,observationBudgetMs}))])
  assert.throws(()=>validateStagedConfig({...c,immersiveBrowse:value}),/immersive browse/i);
 const conflicting={version:'dwell-browse-candidate-v1',contracts:[{task:{name:' 好物沉浸看 ',instruction:'浏览'},dwellMs:5000}]};
 assert.throws(()=>validateStagedConfig({...c,immersiveBrowse:immersive,dwellBrowse:conflicting}),/conflict/i);
 assert.equal(validateStagedConfig({...c,immersiveBrowse:{...immersive,enabled:false},dwellBrowse:conflicting}).immersiveBrowse.enabled,false);
 assert.throws(()=>validateStagedConfig({...c,scriptValidationMode:'true'}),/validation mode/i);
 assert.equal(validateStagedConfig({...c,scriptValidationMode:true}).scriptValidationMode,true);
 assert.throws(()=>validateStagedConfig({...c,dwellBrowse:{version:'wrong',contracts:[]}}),/dwell browse/i);
 assert.throws(()=>validateStagedConfig({...c,dwellBrowse:{version:'dwell-browse-candidate-v1',contracts:[{task:{name:'t',instruction:'浏览'},dwellMs:90000}]}}),/dwell browse/i);
 for(const value of [{enabled:true},{...learned,sourceRunId:0},{...learned,version:'validated'},{...learned,enabled:'true'}])assert.throws(()=>validateStagedConfig({...c,learnedBrowse:value}),/learned browse/i);
});
test('plan import supports saved list and marks decisions without name/instruction unusable',()=>{
 const ds=loadPlanDecisions({tasks:[{name:'T',instruction:'浏览',decision:'do',initialExecutions:1},{name:'U',decision:'do'}]});assert.equal(ds.length,1);assert.equal(ds[0].name,'T');assert.equal(ds[0].times,1);
});
