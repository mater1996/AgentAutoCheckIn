import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createExecutionWorkspace,inheritRoundAttempts} from '../runner/staged/execution-workspace.ts';
test('independent executions own separate roots, index child artifacts and keep process logs',async t=>{
 const root=fs.mkdtempSync(path.join(process.env.TMPDIR!,'round-workspace-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const scope={appId:'app',accountId:'account',activityId:'coins',userId:0};
 const a=createExecutionWorkspace({evidenceRoot:root,id:'one',batchId:'b',scope}),b=createExecutionWorkspace({evidenceRoot:root,id:'two',batchId:'b',scope});
 assert.notEqual(a.evidenceDir,b.evidenceDir);
 a.registerTask({taskAttemptId:'attempt',sessionId:'s',evidenceDir:path.join(a.evidenceDir,'tasks','attempt')});
 fs.writeFileSync(path.join(a.evidenceDir,'tasks','attempt','frame.png'),'synthetic image placeholder');
 a.event('stage_started',{taskAttemptId:'attempt',stage:'collect_list'});a.save('plans/0001.json',{items:[]});
 const detach=a.captureProcessOutput();process.stdout.write('workspace-log-probe\n');detach();
 a.finalize({status:'completed',attempts:[{result:{roundId:'old',entryDispatched:true,status:'completed',gainCoins:999}},{result:{roundId:'one',entryDispatched:true,status:'completed',gainCoins:10}}]});
 const manifest=JSON.parse(fs.readFileSync(path.join(a.evidenceDir,'manifest.json'),'utf8'));
 assert.equal(manifest.tasks[0].taskAttemptId,'attempt');assert.ok(manifest.files.some((f:any)=>f.path==='tasks/attempt/frame.png'));
 assert.match(fs.readFileSync(path.join(a.evidenceDir,'runner.log'),'utf8'),/workspace-log-probe/);
 assert.equal(JSON.parse(fs.readFileSync(path.join(a.evidenceDir,'summary.json'),'utf8')).gainCoins,10);
 assert.ok(fs.existsSync(path.join(a.evidenceDir,'summary.json')));assert.ok(!fs.existsSync(path.join(b.evidenceDir,'summary.json')));
});
test('new executions inherit batch attempts without inheriting a terminal run or losing reservations',()=>{
 const prior={id:'old',batchId:'b',status:'unknown',attempts:[{identity:'A',status:'consumed'},{identity:'B',status:'reserved'},{identity:'C',status:'pending',evidenceKey:'same'}]};
 const inherited=inheritRoundAttempts(prior,[{identity:'D',status:'consumed'},{identity:'A',status:'consumed'}]);
 assert.equal(inherited.length,4);assert.equal(inherited.find((a:any)=>a.identity==='B').status,'reserved');assert.equal(inherited.find((a:any)=>a.identity==='C').evidenceKey,'same');
});
