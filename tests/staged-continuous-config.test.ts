import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {validateStagedConfig} from '../runner/staged/config.ts';
const fixture=()=>JSON.parse(fs.readFileSync('data/evidence/plans/stable-scripts-20261101/available35-config.json','utf8'));
test('development config accepts finite procedures above old browse and capture ceilings',()=>{
 const c=fixture();c.executionPolicy='development-unbounded-v1';delete c.learnedBrowse.contract;c.learnedBrowse.autoContract=true;c.stages.task_receipt.continuousScroll={maxSwipes:1,maxMs:1};
 c.dwellBrowse={version:'dwell-browse-candidate-v1',contracts:[{task:{name:'offline duration',instruction:'浏览60秒'},dwellMs:60000}]};c.immersiveBrowse.observationBudgetMs=60000;
 assert.equal(validateStagedConfig(c),c);assert.throws(()=>validateStagedConfig({...c,executionPolicy:undefined}),/continuous|contract/);
});
test('entry recovery requires an explicit boolean and local activity navigation',()=>{
 const c=fixture();
 for(const entryRecovery of ['true',{},1,null])assert.throws(()=>validateStagedConfig({...c,entryRecovery}),/entry recovery/i);
 for(const localActivityNavigation of [false,undefined])assert.throws(()=>validateStagedConfig({...c,entryRecovery:true,localActivityNavigation}),/entry recovery/i);
 assert.equal(validateStagedConfig({...c,localActivityNavigation:true,entryRecovery:true}).entryRecovery,true);
 assert.equal(validateStagedConfig({...c,entryRecovery:false}).entryRecovery,false);
});
test('immersive OCR quality requires explicit v2 activation',()=>{
 const c=fixture(),b={...c.immersiveBrowse,version:'immersive-browse-candidate-v2',enabled:true};
 for(const ocrQuality of ['true',{},1,null])assert.throws(()=>validateStagedConfig({...c,immersiveBrowse:{...b,ocrQuality}}),/OCR quality/i);
 assert.throws(()=>validateStagedConfig({...c,immersiveBrowse:{...b,enabled:false,ocrQuality:true}}),/OCR quality/i);
 assert.throws(()=>validateStagedConfig({...c,immersiveBrowse:{...b,version:'immersive-browse-candidate-v1',ocrQuality:true}}),/OCR quality/i);
 assert.equal(validateStagedConfig({...c,immersiveBrowse:{...b,ocrQuality:true}}).immersiveBrowse.ocrQuality,true);
});
test('local activity navigation must be an explicit boolean',()=>{
 const c=fixture();for(const localActivityNavigation of ['true',{},1,null])assert.throws(()=>validateStagedConfig({...c,localActivityNavigation}),/navigation/i);
 assert.equal(validateStagedConfig({...c,localActivityNavigation:true}).localActivityNavigation,true);
});
test('local launch option must be an explicit boolean',()=>{
 const c=fixture();for(const localLaunch of ['true',{},1,null])assert.throws(()=>validateStagedConfig({...c,localLaunch}),/launch/i);
 assert.equal(validateStagedConfig({...c,localLaunch:true}).localLaunch,true);
});
test('balance component option must be an explicit boolean',()=>{
 const c=fixture();for(const balanceComponent of ['true',{},1,null])assert.throws(()=>validateStagedConfig({...c,balanceComponent}),/balance/i);
 assert.equal(validateStagedConfig({...c,balanceComponent:true}).balanceComponent,true);
 assert.equal(validateStagedConfig({...c,balanceComponent:false}).balanceComponent,false);
});
test('automatic continuous contract requires explicit activation and exact maximum authorized segment',()=>{
 const c=fixture();delete c.learnedBrowse.contract;c.learnedBrowse.autoContract=true;
 assert.equal(validateStagedConfig(c),c);
 for(const autoContract of ['true',1,null])assert.throws(()=>validateStagedConfig({...c,learnedBrowse:{...c.learnedBrowse,autoContract}}),/continuous|contract/i);
 assert.throws(()=>validateStagedConfig({...c,learnedBrowse:{...c.learnedBrowse,enabled:false}}),/continuous|contract/i);
 assert.throws(()=>validateStagedConfig({...c,learnedBrowse:{...c.learnedBrowse,contract:{rewardCoins:50,requiredMs:25000}}}),/continuous|contract/i);
 for(const continuousScroll of [{maxSwipes:31,maxMs:35000,requiredMs:25000},{maxSwipes:30,maxMs:36000,requiredMs:25000},{maxSwipes:16,maxMs:18000}])assert.throws(()=>validateStagedConfig({...c,stages:{...c.stages,task_receipt:{...c.stages.task_receipt,continuousScroll}}}),/continuous|contract/i);
 assert.equal(validateStagedConfig(fixture()).learnedBrowse.contract.rewardCoins,50);
});
