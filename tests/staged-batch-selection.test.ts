import test from 'node:test';
import assert from 'node:assert/strict';
import {plannedTaskEligible} from '../runner/staged/observations.ts';
const current={name:'发现精选好物',instruction:'浏览',done:1,total:3};
const plan={...current,decision:'do',initialExecutions:1};
test('explicit batch budget permits remaining live quota despite an earlier same-day round',()=>{
 assert.equal(plannedTaskEligible(current,plan,{mode:'batch-attempts-v1',completed:['发现精选好物']}),true);
});
test('batch attempts consume budget even when no reward was reconciled',()=>{
 assert.equal(plannedTaskEligible(current,{...plan,attemptsThisBatch:1},{mode:'batch-attempts-v1',completed:[]}),false);
 for(const decision of ['pending','skip'])assert.equal(plannedTaskEligible(current,{...plan,decision},{mode:'batch-attempts-v1'}),false);
 assert.equal(plannedTaskEligible({...current,done:3},plan,{mode:'batch-attempts-v1'}),false);
});
test('legacy day exclusion and exact task requirement remain unchanged',()=>{
 assert.equal(plannedTaskEligible(current,plan,{completed:['发现精选好物']}),false);
 assert.equal(plannedTaskEligible({...current,instruction:'搜索并浏览'},plan,{mode:'batch-attempts-v1'}),false);
});
