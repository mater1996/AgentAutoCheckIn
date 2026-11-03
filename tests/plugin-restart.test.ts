import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {AdbOcrDevice} from '../runner/staged/device.ts';
test('restart only force-stops the configured owner and uses the existing launch path',async()=>{
 const calls:any[]=[];const dir=fs.mkdtempSync(path.join(process.env.TMPDIR??os.tmpdir(),'restart-offline-'));
 const device=new AdbOcrDevice({serial:'offline',evidenceDir:dir,executionPolicy:'development-unbounded-v1',exec:async(_file,args)=>{calls.push(args);if(args.includes('resolve-activity'))return {stdout:'com.example.app/.Main\n'};return {stdout:''};}});
 assert.equal(typeof (device as any).restartApp,'function');
 await (device as any).restartApp({package:'com.example.app',userId:0});
 assert.deepEqual(calls[0],['-s','offline','shell','am','force-stop','--user','0','com.example.app']);
 assert.equal(calls.filter(a=>a.includes('force-stop')).length,1);assert.equal(calls.filter(a=>a.includes('start')).length,1);
 await assert.rejects(()=>(device as any).restartApp({package:'bad;command',userId:0}),/Invalid/);
 assert.equal(calls.length,3);
});
