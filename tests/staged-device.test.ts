import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
const foreground = 'topResumedActivity=ActivityRecord{abc u999 test.app/.Main t42}\n mResumedActivity: ActivityRecord{old u0 other.app/.Old t1}';
const load = () => import('../runner/staged/device.ts');
test('continuous scroll consumes one region authority and bounds consecutive gestures without wait or model reads',async()=>{
 const {AdbOcrDevice}=await load();await fixture(async(dir,exec,calls)=>{
  const d=new AdbOcrDevice({serial:'offline',evidenceDir:dir,ocrBinary:'offline-ocr',exec});const f=await d.capture();
  await (d as any).scrollContinuously({type:'swipe',fromX:0,fromY:0,toX:0,toY:0,ms:900},f,{maxSwipes:3,maxMs:5000});
  assert.equal(calls.filter(c=>c.args.includes('swipe')).length,3);
  await assert.rejects(d.act({type:'tap',x:0,y:0},f),/frame/i);
  const log=JSON.parse(await readFile(join(dir,'continuous-scroll.json'),'utf8'));assert.equal(log.actions.length,3);
 });
});
test('explicit 25-second contract dispatches thirty 900ms gestures with remaining-time exec limits', async () => {
 const {AdbOcrDevice}=await load();await fixture(async(dir,exec)=>{
  let clock=0;const segment:{args:string[];timeoutMs:number;remaining:number}[]=[];
  const d=new AdbOcrDevice({serial:'offline',evidenceDir:dir,ocrBinary:'offline-ocr',now:()=>123,monotonic:()=>clock,exec:async(file,args,limits)=>{
   if(limits){segment.push({args,timeoutMs:limits.timeoutMs,remaining:35000-clock});clock+=args.includes('swipe')?900:100;}
   return exec(file,args);
  }});
  const f=await d.capture();
  await d.scrollContinuously({type:'swipe',fromX:0,fromY:0,toX:0,toY:0,ms:900},f,{maxSwipes:30,maxMs:35000,requiredMs:25000});
  assert.equal(segment.length,60);
  segment.forEach((call,i)=>{
   assert.equal(call.args.includes(i%2===0?'activities':'swipe'),true);
   if(i%2)assert.equal(call.args.at(-1),'900');
   assert.ok(call.timeoutMs>0&&call.timeoutMs<=call.remaining);
  });
  assert.ok(segment.at(-1)!.timeoutMs<segment[0].timeoutMs);
  const log=JSON.parse(await readFile(join(dir,'continuous-scroll.json'),'utf8'));
  assert.equal(log.requestedSwipes,30);assert.equal(log.dispatchedSwipes,30);
  assert.equal(log.nominalGestureMs,27000);assert.equal(log.elapsedMs,30000);assert.equal(log.stopReason,'max_swipes');
  await assert.rejects(d.scrollContinuously({type:'swipe',ms:900},f,{maxSwipes:30,maxMs:35000,requiredMs:25000}),/frame/i);
 });
});

test('continuous scroll rejects every unauthorized extension without consuming the frame', async () => {
 const {AdbOcrDevice}=await load();await fixture(async(dir,exec,calls)=>{
  const d=new AdbOcrDevice({serial:'offline',evidenceDir:dir,ocrBinary:'offline-ocr',exec});const f=await d.capture();
  const swipe={type:'swipe' as const,fromX:0,fromY:0,toX:0,toY:0,ms:900};const before=calls.length;
  for(const limits of [
   {maxSwipes:21,maxMs:20000},{maxSwipes:20,maxMs:20001},
   {maxSwipes:30,maxMs:35000},{maxSwipes:30,maxMs:35000,requiredMs:10000},
   {maxSwipes:31,maxMs:35000,requiredMs:25000},{maxSwipes:30,maxMs:35001,requiredMs:25000},
   {maxSwipes:29,maxMs:35000,requiredMs:25000},
  ])await assert.rejects(d.scrollContinuously(swipe,f,limits),/bounds/);
  await assert.rejects(d.scrollContinuously({...swipe,ms:901},f,{maxSwipes:30,maxMs:35000,requiredMs:25000}),/bounds/);
  assert.equal(calls.length,before);
  await d.scrollContinuously(swipe,f,{maxSwipes:20,maxMs:20000});
  assert.equal(calls.filter(c=>c.args.includes('swipe')).length,20);
 });
});

test('continuous scroll requires budget for gesture and check before and after foreground', async () => {
 const {AdbOcrDevice}=await load();
 for(const maxMs of [900,901,1000])await fixture(async(dir,exec,calls)=>{
  let clock=0;const d=new AdbOcrDevice({serial:'offline',evidenceDir:dir,ocrBinary:'offline-ocr',monotonic:()=>clock,exec:async(file,args,limits)=>{
   if(limits&&args.includes('activities'))clock+=100;
   return exec(file,args);
  }});const f=await d.capture();const before=calls.length;
  await d.scrollContinuously({type:'swipe',fromX:0,fromY:0,toX:0,toY:0,ms:900},f,{maxSwipes:3,maxMs});
  assert.equal(calls.filter(c=>c.args.includes('swipe')).length,0);
  assert.equal(calls.length-before,maxMs===900?0:1);
  const log=JSON.parse(await readFile(join(dir,'continuous-scroll.json'),'utf8'));
  assert.equal(log.stopReason,'budget_exhausted');assert.equal(log.dispatchedSwipes,0);
  await assert.rejects(d.act({type:'tap',x:0,y:0},f),/frame/i);
 });
});

test('continuous scroll stops after foreground change or unknown exec with no replay', async () => {
 const {AdbOcrDevice}=await load();
 for(const failure of ['package','user','foreground timeout','late foreground','swipe timeout','late swipe'])await fixture(async(dir,exec)=>{
  let clock=0,active=false;const segment:string[][]=[];
  const d=new AdbOcrDevice({serial:'offline',evidenceDir:dir,ocrBinary:'offline-ocr',monotonic:()=>clock,exec:async(file,args,limits)=>{
   if(active){
    segment.push(args);assert.ok(limits&&limits.timeoutMs>0&&limits.timeoutMs<=35000-clock);
    if(args.includes('activities')){
     if(failure==='package')return {stdout:foreground.replace('test.app','other.app')};
     if(failure==='user')return {stdout:foreground.replace('u999','u0')};
     if(failure==='foreground timeout'){clock+=limits!.timeoutMs;throw Error('exec timeout');}
     if(failure==='late foreground')clock=35000;
    }
    if(args.includes('swipe')){
     if(failure==='swipe timeout'){clock+=limits!.timeoutMs;throw Error('exec timeout');}
     if(failure==='late swipe')clock=35000;
    }
   }
   return exec(file,args);
  }});const f=await d.capture();active=true;
  const swipe={type:'swipe' as const,fromX:0,fromY:0,toX:0,toY:0,ms:900};
  await assert.rejects(d.scrollContinuously(swipe,f,{maxSwipes:30,maxMs:35000,requiredMs:25000}),/Foreground|timeout|unknown/);
  const count=segment.length;
  await assert.rejects(d.scrollContinuously(swipe,f,{maxSwipes:30,maxMs:35000,requiredMs:25000}),/frame/i);
  assert.equal(segment.length,count);assert.equal(count,failure.includes('swipe')?2:1);
  const log=JSON.parse(await readFile(join(dir,'continuous-scroll.json'),'utf8'));
  assert.equal(log.dispatchedSwipes,0);assert.equal(log.nominalGestureMs,0);
  assert.equal(log.stopReason,failure==='package'||failure==='user'?'foreground_changed':failure==='foreground timeout'||failure==='late foreground'?'foreground_unknown':'dispatch_unknown');
  if(failure.includes('swipe'))assert.equal(log.actions[0].status,'unknown');
 });
});

test('prepare allows wake transition to settle before returning control for foreground capture',async()=>{
 const {AdbOcrDevice}=await load();
 await fixture(async(dir,exec)=>{
  const device=new AdbOcrDevice({serial:'offline',evidenceDir:dir,exec:async(file,args)=>args.includes('get')&&args.includes('settings')?{stdout:'15\n'}:exec(file,args)});
  const started=performance.now();await device.prepare();
  assert.ok(performance.now()-started>=900,'wake transition must settle for about one second');
 });
});

test('continuous scroll rejects invalid limits and stops before another gesture if foreground changes',async()=>{
 const {AdbOcrDevice}=await load();await fixture(async(dir,exec,calls)=>{
  let changes=false;
  const d=new AdbOcrDevice({serial:'offline',evidenceDir:dir,ocrBinary:'offline-ocr',exec:async(file,args)=>{
   if(changes&&args.includes('activities'))return {stdout:'topResumedActivity=ActivityRecord{x u0 other.app/.Main}'};
   const r=await exec(file,args);if(args.includes('swipe'))changes=true;return r;
  }});const f=await d.capture();const swipe:any={type:'swipe',fromX:0,fromY:0,toX:0,toY:0,ms:900};
  await assert.rejects(d.scrollContinuously(swipe,f,{maxSwipes:21,maxMs:5000}),/bounds/);
  await assert.rejects(d.scrollContinuously(swipe,f,{maxSwipes:3,maxMs:5000}),/Foreground/);
  assert.equal(calls.filter(c=>c.args.includes('swipe')).length,1);
 });
});

test('capture rejects ambiguous foreground including same package in different Android users', async () => {
  const { AdbOcrDevice } = await load();
  await fixture(async (dir, exec) => {
    for (const raw of ['', 'topResumedActivity=null\nmResumedActivity: ActivityRecord{x u0 test.app/.Main}', foreground + '\ntopResumedActivity=ActivityRecord{other u0 test.app/.Main t9}']) {
      const device = new AdbOcrDevice({ serial: 'offline', evidenceDir: dir, exec: async (file, args) => args.includes('activities') ? { stdout: raw } : exec(file, args) });
      await assert.rejects(device.capture(), /foreground/i);
    }
  });
});

test('capture rejects corrupt dimensions, OCR mismatch and foreground changes but preserves already captured raw evidence', async () => {
  const { AdbOcrDevice } = await load();
  await fixture(async (dir, exec) => {
    const invalid = Buffer.from(png); invalid.writeUInt32BE(0, 16);
    const badPng = new AdbOcrDevice({ serial: 'offline', evidenceDir: dir, exec: async (file, args) => args.includes('screencap') ? { stdout: invalid } : exec(file, args) });
    await assert.rejects(badPng.capture(), /PNG|dimensions/i);
    const badOcr = new AdbOcrDevice({ serial: 'offline', evidenceDir: dir, ocrBinary: 'offline-ocr', exec: async (file, args) => {
      if (file === 'offline-ocr') { await writeFile(args[0], JSON.stringify({ pages: [{ file: args[1], width: 2, height: 1, lines: [] }] })); return { stdout: '' }; }
      return exec(file, args);
    } });
    await assert.rejects(badOcr.capture(), /OCR/i);
    let reads = 0;
    const changed = new AdbOcrDevice({ serial: 'offline', evidenceDir: dir, ocrBinary: 'offline-ocr', exec: async (file, args) => {
      if (args.includes('activities')) return { stdout: ++reads === 1 ? foreground : 'topResumedActivity=ActivityRecord{x u0 changed.app/.Main t9}' };
      return exec(file, args);
    } });
    await assert.rejects(changed.capture(), /foreground/i);
    assert.ok((await readdir(dir)).some(name => name.endsWith('.png')));
  });
});

test('run225 clipped product OCR preserves completion text and excludes invalid action geometry', async t => {
  const { AdbOcrDevice } = await load();
  const source = join(process.cwd(), 'evidence/staged-2026-11-02T11-52-57-317Z/55bcb1f8-20b2-4b96-ad45-69bd3864bf07');
  const bytes = await readFile(source + '.png');
  const original = JSON.parse(await readFile(source + '.ocr.json', 'utf8'));
  await fixture(async (dir, exec, calls) => {
    const device = new AdbOcrDevice({ serial: 'offline', evidenceDir: dir, ocrBinary: 'offline-ocr', exec: async (file, args) => {
      if (args.includes('screencap')) return { stdout: bytes };
      if (file === 'offline-ocr') { const raw = structuredClone(original); raw.pages[0].file = args[1]; await writeFile(args[0], JSON.stringify(raw)); return { stdout: '' }; }
      return exec(file, args);
    }});
    const frame: any = await device.capture();
    assert.ok(frame.lines.some((l: any) => l.text === '任务已完成'));
    assert.ok(frame.ocrObservation.texts.includes('任务已完成'));
    assert.ok(frame.ocrObservation.excludedLineIndexes.length > 0);
    assert.equal(frame.observationError, undefined);
    assert.ok(frame.lines.every((l: any) => l.bounds[0] >= 0 && l.bounds[2] <= frame.width));
    assert.deepEqual(await readFile(frame.path), bytes);
    await assert.rejects(device.act({ type: 'tap', x: -1, y: 0 }, frame), /coordinates/);
    assert.equal(calls.some(c => c.args.includes('tap')), false);
  });
});

test('capture separates historical clipped OCR text from valid action lines without changing raw evidence', async () => {
  const { AdbOcrDevice } = await load();
  await fixture(async (dir, exec, calls) => {
    let rawOcr = '';
    const device = new AdbOcrDevice({ serial: 'offline', evidenceDir: dir, ocrBinary: 'offline-ocr', allowVisualFallback: true, now: () => 123, exec: async (file, args) => {
      if (file === 'offline-ocr') {
        // Minimized from 90089616-c6e5-4e7f-b414-46031f46451c.ocr.json:
        // the real Apple Vision left edge was -0.28778930410577175 pixels.
        rawOcr = JSON.stringify({ pages: [{ file: args[1], width: 1, height: 1, lines: [
          { text: 'valid line must also be discarded', bounds: [0, 0, 1, 1] },
          { text: '金币精选店铺', bounds: [-0.28778930410577175, 0, 1, 1] },
        ] }] });
        await writeFile(args[0], rawOcr);
        return { stdout: '' };
      }
      return exec(file, args);
    } });
    const frame = await device.capture();
    assert.deepEqual(frame.lines, [{text:'valid line must also be discarded',bounds:[0,0,1,1]}]);
    assert.deepEqual(frame.ocrObservation?.texts, ['valid line must also be discarded','金币精选店铺']);
    assert.deepEqual(frame.ocrObservation?.excludedLineIndexes,[1]);
    assert.equal(frame.observationError, undefined);
    assert.equal(frame.width, 1); assert.equal(frame.height, 1); assert.equal(frame.capturedAt, 123);
    assert.equal(frame.package, 'test.app'); assert.equal(frame.userId, 999);
    assert.deepEqual(await readFile(frame.path), png);
    assert.deepEqual(JSON.parse(await readFile(join(dir, frame.id + '.json'), 'utf8')), frame);
    assert.equal(await readFile(join(dir, frame.id + '.ocr.json'), 'utf8'), rawOcr);
    await assert.rejects(device.act({ type: 'tap', x: 0, y: 0 }, { ...frame, id: 'forged' }), /frame/i);
    await device.act({ type: 'tap', x: 0, y: 0 }, frame);
    assert.deepEqual(calls.at(-1)!.args, ['-s', 'offline', 'shell', 'input', 'tap', '0', '0']);
    await assert.rejects(device.act({ type: 'tap', x: 0, y: 0 }, frame), /frame/i);
  });
});

test('visual fallback covers OCR process, JSON and schema failures while strict mode still rejects each failure', async () => {
  const { AdbOcrDevice } = await load();
  const failures = [
    { name: 'process', output: undefined, error: 'Foreground OCR binary unavailable' },
    { name: 'malformed JSON', output: '{invalid', error: undefined },
    { name: 'missing pages', output: '{}', error: undefined },
    { name: 'null document', output: 'null', error: undefined },
    { name: 'null line', output: 'null-line', error: undefined },
    { name: 'mismatched dimensions', output: 'mismatch', error: undefined },
    { name: 'historical boundary', output: 'boundary', error: undefined },
  ];
  for (const failure of failures) {
    await fixture(async (dir, exec, calls) => {
      let rawOcr: string | undefined;
      const failingExec = async (file: string, args: string[]) => {
        if (file !== 'offline-ocr') return exec(file, args);
        if (failure.error) throw Error(failure.error);
        rawOcr = failure.output === 'null-line'
          ? JSON.stringify({ pages: [{ file: args[1], width: 1, height: 1, lines: [null] }] })
          : failure.output === 'mismatch'
            ? JSON.stringify({ pages: [{ file: args[1], width: 2, height: 1, lines: [] }] })
            : failure.output === 'boundary'
              ? JSON.stringify({ pages: [{ file: args[1], width: 1, height: 1, lines: [{ text: 'edge', bounds: [-0.28778930410577175, 0, 1, 1] }] }] })
              : failure.output!;
        await writeFile(args[0], rawOcr);
        return { stdout: '' };
      };
      for (const allowVisualFallback of [undefined, false]) {
        const strict = new AdbOcrDevice({ serial: 'offline', evidenceDir: dir, ocrBinary: 'offline-ocr', allowVisualFallback, exec: failingExec });
        if(['null line','historical boundary'].includes(failure.name)){
          const captured=await strict.capture();assert.deepEqual(captured.lines,[]);assert.equal(captured.observationError,undefined);assert.deepEqual(captured.ocrObservation?.excludedLineIndexes,[0]);
        }else await assert.rejects(strict.capture(), failure.name);
      }
      const device = new AdbOcrDevice({ serial: 'offline', evidenceDir: dir, ocrBinary: 'offline-ocr', allowVisualFallback: true, exec: failingExec });
      const frame = await device.capture();
      assert.deepEqual(frame.lines, [], failure.name);
      if(['null line','historical boundary'].includes(failure.name))assert.equal(frame.observationError,undefined);
      else assert.match(frame.observationError!, /^OCR capture failed: .+/, failure.name);
      if (failure.error) assert.ok(frame.observationError!.includes(failure.error));
      assert.deepEqual(await readFile(frame.path), png);
      assert.deepEqual(JSON.parse(await readFile(join(dir, frame.id + '.json'), 'utf8')), frame);
      if (rawOcr !== undefined) assert.equal(await readFile(join(dir, frame.id + '.ocr.json'), 'utf8'), rawOcr);
      await device.act({ type: 'tap', x: 0, y: 0 }, frame);
      assert.deepEqual(calls.at(-1)!.args.slice(2), ['shell', 'input', 'tap', '0', '0']);
    });
  }
});

test('visual fallback never authorizes captures with invalid PNG or changed, ambiguous or unreadable foreground', async () => {
  const { AdbOcrDevice } = await load();
  for (const failure of ['PNG', 'package', 'user', 'ambiguous', 'read failure']) {
    await fixture(async (dir, exec, calls) => {
      let fail = false, reads = 0, ocrRuns = 0;
      const device = new AdbOcrDevice({ serial: 'offline', evidenceDir: dir, ocrBinary: 'offline-ocr', allowVisualFallback: true, now: () => 123, exec: async (file, args) => {
        if (file === 'offline-ocr') ocrRuns++;
        if (fail && args.includes('screencap') && failure === 'PNG') return { stdout: Buffer.from('broken PNG') };
        if (fail && args.includes('activities') && ++reads === 2) {
          if (failure === 'read failure') throw Error('dumpsys unavailable');
          if (failure === 'package') return { stdout: foreground.replace('test.app', 'other.app') };
          if (failure === 'user') return { stdout: foreground.replace('u999', 'u0') };
          if (failure === 'ambiguous') return { stdout: 'topResumedActivity=null' };
        }
        return exec(file, args);
      } });
      const previous = await device.capture();
      fail = true;
      await assert.rejects(device.capture(), failure === 'PNG' ? /PNG/ : failure === 'read failure' ? /dumpsys/ : /Foreground/);
      assert.equal(ocrRuns, 1, 'unsafe capture must stop before OCR');
      const metadata = (await readdir(dir)).filter(name => name.endsWith('.json') && !name.endsWith('.ocr.json') && name !== previous.id + '.json');
      if (failure === 'PNG') assert.deepEqual(metadata, []);
      else {
        assert.equal(metadata.length, 1);
        const saved = JSON.parse(await readFile(join(dir, metadata[0]), 'utf8'));
        assert.equal(saved.observationError, 'Foreground changed during capture');
        assert.deepEqual(await readFile(saved.path), png);
      }
      await assert.rejects(device.act({ type: 'tap', x: 0, y: 0 }, previous), /frame/i);
      assert.ok(!calls.some(call => call.args.includes('tap')));
    });
  }
});

test('degraded frame authority still rejects foreground changes and expiration before dispatch', async () => {
  const { AdbOcrDevice } = await load();
  for (const failure of ['package', 'user', 'expired', 'expired during check']) {
    await fixture(async (dir, exec, calls) => {
      let now = 123, fail = false;
      const device = new AdbOcrDevice({ serial: 'offline', evidenceDir: dir, ocrBinary: 'offline-ocr', allowVisualFallback: true, now: () => now, exec: async (file, args) => {
        if (file === 'offline-ocr') throw Error('OCR unavailable');
        if (fail && args.includes('activities')) {
          if (failure === 'package') return { stdout: foreground.replace('test.app', 'other.app') };
          if (failure === 'user') return { stdout: foreground.replace('u999', 'u0') };
          if (failure === 'expired during check') now += 5001;
        }
        return exec(file, args);
      } });
      const frame = await device.capture();
      fail = true;
      if (failure === 'expired') now += 5001;
      await assert.rejects(device.act({ type: 'tap', x: 0, y: 0 }, frame), /foreground|expired/i);
      assert.ok(!calls.some(call => call.args.includes('tap')));
    });
  }
});

test('act requires a current owned frame and pixel bounds, dispatches once, then consumes frame even on input failure', async () => {
  const { AdbOcrDevice } = await load();
  await fixture(async (dir, exec, calls) => {
    const device = new AdbOcrDevice({ serial: 'offline', evidenceDir: dir, ocrBinary: 'offline-ocr', exec, now: () => 123 });
    const frame = await device.capture();
    for (const action of [{ type: 'tap', x: 0, y: 0 }, { type: 'tap', x: 1, y: 0 }, { type: 'tap', x: NaN, y: 0 }, { type: 'tap', x: 0.5, y: 0 }, { type: 'swipe', fromX: 0, fromY: 0, toX: 0, toY: 2, ms: 100 }, { type: 'wait', ms: 5001 }, { type: 'wait', ms: -1 }, { type: 'launch', package: 'test.app' }, { type: 'launch', package: 'test.app;id', userId: 0 }, { type: 'unknown' }]) {
      if (action.type === 'tap' && action.x === 0) await assert.rejects(device.act(action as any), /frame/i);
      else await assert.rejects(device.act(action as any, frame));
    }
    await assert.rejects(device.act({ type: 'tap', x: 0, y: 0 }, { ...frame, width: 999 }), /frame/i);
    await device.act({ type: 'tap', x: 0, y: 0 }, frame);
    assert.deepEqual(calls.at(-1)!.args, ['-s', 'offline', 'shell', 'input', 'tap', '0', '0']);
    await assert.rejects(device.act({ type: 'tap', x: 0, y: 0 }, frame), /frame/i);
    const errors = new AdbOcrDevice({ serial: 'offline', evidenceDir: dir, ocrBinary: 'offline-ocr', exec: async (f, a) => {
      if (a.includes('tap')) throw Error('input failed'); return exec(f, a);
    } });
    const f = await errors.capture();
    await assert.rejects(errors.act({ type: 'tap', x: 0, y: 0 }, f));
    await assert.rejects(errors.act({ type: 'tap', x: 0, y: 0 }, f), /frame/i);
  });
});

test('act rejects concurrent dispatch, stale frames and foreground changes; swipe/back/wait have explicit bounded arguments', async () => {
  const { AdbOcrDevice } = await load();
  await fixture(async (dir, exec, calls) => {
    let now = 123;
    const device = new AdbOcrDevice({ serial: 'offline', evidenceDir: dir, ocrBinary: 'offline-ocr', exec, now: () => now });
    const frame = await device.capture(); now += 5001;
    await assert.rejects(device.act({ type: 'tap', x: 0, y: 0 }, frame), /frame/i);
    now = 123;
    const fresh = await device.capture();
    await device.act({ type: 'swipe', fromX: 0, fromY: 0, toX: 0, toY: 0, ms: 100 }, fresh);
    assert.deepEqual(calls.at(-1)!.args.slice(2), ['shell', 'input', 'swipe', '0', '0', '0', '0', '100']);
    await device.act({ type: 'back' });
    assert.deepEqual(calls.at(-1)!.args.slice(2), ['shell', 'input', 'keyevent', 'KEYCODE_BACK']);
    const waiting = device.act({ type: 'wait', ms: 15 });
    await assert.rejects(device.act({ type: 'back' }), /busy|concurrent/i);
    await assert.rejects(device.capture(), /busy|concurrent/i);
    await waiting;
    let changed = false;
    const switched = new AdbOcrDevice({ serial: 'offline', evidenceDir: dir, ocrBinary: 'offline-ocr', exec: async (f, a) => a.includes('activities') && changed ? { stdout: 'topResumedActivity=ActivityRecord{x u0 other.app/.Main t1}' } : exec(f, a) });
    const previous = await switched.capture(); changed = true;
    await assert.rejects(switched.act({ type: 'tap', x: 0, y: 0 }, previous), /foreground/i);
  });
});

test('launch resolves explicit package for the specified user instead of guessing an activity', async () => {
  const { AdbOcrDevice } = await load();
  await fixture(async (dir, exec, calls) => {
    const device = new AdbOcrDevice({ serial: 'offline', evidenceDir: dir, exec: async (f, a) => {
      if (a.includes('resolve-activity')) { calls.push({ file: f, args: a }); return { stdout: 'test.app/.Launcher\n' }; }
      return exec(f, a);
    } });
    await device.act({ type: 'launch', package: 'test.app', userId: 999 });
    assert.ok(calls.some(c => c.args.includes('resolve-activity') && c.args.includes('999')));
    assert.deepEqual(calls.at(-1)!.args.slice(2), ['shell', 'am', 'start', '--user', '999', '-n', 'test.app/.Launcher']);
  });
});

test('prepare saves stay-on and wakes; cleanup restores, sleeps and reads exact power/forward state', async () => {
  const { AdbOcrDevice } = await load();
  await fixture(async (dir, exec, calls) => {
    let stay = '2';
    const device = new AdbOcrDevice({ serial: 'offline', evidenceDir: dir, exec: async (f, a) => {
      if (a.includes('settings')) {
        calls.push({ file: f, args: a });
        if (a.includes('put')) { stay = a.at(-1)!; return { stdout: '' }; }
        return { stdout: stay + '\n' };
      }
      if (a.includes('power')) { calls.push({ file: f, args: a }); return { stdout: 'mWakefulness' + '=Asleep\n' }; }
      if (a.includes('--list')) { calls.push({ file: f, args: a }); return { stdout: 'other-device tcp:1 tcp:2\n' }; }
      return exec(f, a);
    } });
    await device.prepare();
    assert.equal(stay, '15');
    assert.ok(calls.some(c => c.args.includes('KEYCODE_WAKEUP')));
    assert.ok(calls.some(c => c.args.includes('dismiss-keyguard')));
    const result = await device.cleanup();
    assert.equal(stay, '2');
    assert.equal(result.stayOn, '2'); assert.equal(result.power, 'mWakefulness' + '=Asleep\n');
    assert.equal(result.forwards, 'other-device tcp:1 tcp:2\n');
    assert.ok(calls.some(c => c.args.includes('KEYCODE_SLEEP')));
    assert.deepEqual(JSON.parse(await readFile(join(dir, 'cleanup.json'), 'utf8')), result);
  });
});

test('cleanup still attempts sleep and readbacks after restore failure and partial prepare keeps original setting', async () => {
  const { AdbOcrDevice } = await load();
  await fixture(async (dir, exec, calls) => {
    let failRestore = false;
    const device = new AdbOcrDevice({ serial: 'offline', evidenceDir: dir, exec: async (f, a) => {
      if (a.includes('get') && a.includes('settings')) return { stdout: 'null\n' };
      if (a.includes('KEYCODE_WAKEUP')) throw Error('wake failed');
      if (a.includes('delete') && failRestore) throw Error('restore failed');
      return exec(f, a);
    } });
    await assert.rejects(device.prepare()); failRestore = true;
    await assert.rejects(device.cleanup(), /cleanup/i);
    assert.ok(calls.some(c => c.args.includes('KEYCODE_SLEEP')));
    assert.ok(calls.some(c => c.args.includes('power')));
    assert.ok(calls.some(c => c.args.includes('--list')));
    const report = JSON.parse(await readFile(join(dir, 'cleanup.json'), 'utf8'));
    assert.ok(report.errors.length);
  });
});
test('coordinate authority expires during asynchronous foreground check and shell denial is a failure', async () => {
  const { AdbOcrDevice } = await load();
  await fixture(async (dir, exec) => {
    let now = 123, expire = false, denied = false;
    const device = new AdbOcrDevice({ serial: 'offline', evidenceDir: dir, ocrBinary: 'offline-ocr', now: () => now, exec: async (f, a) => {
      if (a.includes('activities') && expire) now += 5001;
      if (a.includes('KEYCODE_BACK') && denied) return { stdout: 'java.lang.SecurityException: INJECT_EVENTS' };
      return exec(f, a);
    } });
    const frame = await device.capture(); expire = true;
    await assert.rejects(device.act({ type: 'tap', x: 0, y: 0 }, frame), /expired/i);
    expire = false; denied = true;
    await assert.rejects(device.act({ type: 'back' }), /failed/i);
  });
});

test('cleanup rejects an Awake readback rather than treating KEYCODE_SLEEP acknowledgement as sleep proof', async () => {
  const { AdbOcrDevice } = await load();
  await fixture(async (dir, exec) => {
    const device = new AdbOcrDevice({ serial: 'offline', evidenceDir: dir, exec: async (f, a) => a.includes('power') ? { stdout: 'mWakefulness=Awake' } : exec(f, a) });
    await assert.rejects(device.cleanup(), /cleanup/i);
    const report = JSON.parse(await readFile(join(dir, 'cleanup.json'), 'utf8'));
    assert.ok(report.errors.some((s: string) => /sleep/i.test(s)));
  });
});

test('capture preserves subpixel boundary text without manufacturing clamped action coordinates', async () => {
  const {AdbOcrDevice}=await load();
  await fixture(async(dir,exec)=>{
    const device=new AdbOcrDevice({serial:'offline',evidenceDir:dir,ocrBinary:'offline-ocr',exec:async(f,a)=>{
      if(f==='offline-ocr'){await writeFile(a[0],JSON.stringify({pages:[{file:a[1],width:1,height:1,lines:[{text:'edge',bounds:[-0.000007,0,1.000007,1]}]}]}));return {stdout:''};}return exec(f,a);
    }});
    const frame=await device.capture();assert.deepEqual(frame.lines,[]);assert.deepEqual(frame.ocrObservation?.texts,['edge']);assert.deepEqual(frame.ocrObservation?.excludedLineIndexes,[0]);
  });
});

async function fixture(fn: (dir: string, exec: any, calls: { file: string; args: string[] }[]) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), 'staged-device-'));
  const calls: { file: string; args: string[] }[] = [];
  const exec = async (file: string, args: string[]) => {
    calls.push({ file, args });
    if (file === 'offline-ocr') {
      await writeFile(args[0], JSON.stringify({ pages: [{ file: args[1], width: 1, height: 1, lines: [{ text: '任务', bounds: [0, 0, 1, 1] }] }] }));
      return { stdout: '' };
    }
    assert.equal(file, 'adb'); assert.deepEqual(args.slice(0, 2), ['-s', 'offline']);
    if (args.includes('screencap')) return { stdout: png };
    if (args.includes('activities')) return { stdout: foreground };
    return { stdout: '' };
  };
  try { await fn(dir, exec, calls); } finally { await rm(dir, { recursive: true, force: true }); }
}

test('capture preserves original PNG, derives dimensions and binds OCR plus unique HyperOS package/user to saved frame', async () => {
  const { AdbOcrDevice } = await load();
  await fixture(async (dir, exec, calls) => {
    const device = new AdbOcrDevice({ serial: 'offline', evidenceDir: dir, ocrBinary: 'offline-ocr', exec, now: () => 123 });
    const frame = await device.capture();
    assert.equal(frame.width, 1); assert.equal(frame.height, 1); assert.equal(frame.capturedAt, 123);
    assert.equal(frame.package, 'test.app'); assert.equal(frame.userId, 999);
    assert.deepEqual(frame.lines, [{ text: '任务', bounds: [0, 0, 1, 1] }]);
    assert.deepEqual(await readFile(frame.path), png);
    const saved = JSON.parse(await readFile(join(dir, frame.id + '.json'), 'utf8'));
    assert.deepEqual(saved, frame);
    const capture = calls.find(c => c.args.includes('screencap'))!;
    assert.deepEqual(capture.args, ['-s', 'offline', 'exec-out', 'screencap', '-p']);
    const ocr = calls.find(c => c.file === 'offline-ocr')!;
    assert.equal(ocr.args[1], frame.path);
  });
});
