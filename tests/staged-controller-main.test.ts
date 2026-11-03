import test from 'node:test';
import assert from 'node:assert/strict';
import {createControllerCaptureDeps} from '../runner/staged/main.ts';
test('main raw adapter binds callback owning attempt and forwards original batch without device authority',async()=>{
 const calls:any[]=[],batch={id:'raw',frames:[]},frames=[{id:'original',capturedAt:100}];
 const raw={captureBurst:async(...args:any[])=>{calls.push(args);return batch;},deriveFrames:async(...args:any[])=>{calls.push(args);return frames;}};
 const cfg={package:'com.taobao.taobao',scope:{userId:0},rawCapture:{ocrBinary:'/offline/ocr'}};
 const deps=createControllerCaptureDeps(raw,cfg,{taskAttemptId:'session-attempt'});
 assert.equal(await deps.captureRawBurst({frames:8,intervalMs:250,maxMs:2000}),batch);
 assert.deepEqual(calls[0],[{package:cfg.package,userId:0,taskAttemptId:'session-attempt'},{frames:8,intervalMs:250,budgetMs:2000}]);
 assert.equal(await deps.deriveRawFrames(batch,{budgetMs:3000}),frames);assert.deepEqual(calls[1],[batch,{ocrBinary:'/offline/ocr'},{budgetMs:3000}]);
 assert.throws(()=>createControllerCaptureDeps(raw,cfg,{}),/attempt/);
 assert.equal('act' in deps,false);
});
