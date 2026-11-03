import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
const load = () => import('../runner/staged/raw-capture.ts').catch(() => null);
const owner = { package: 'com.taobao.taobao', userId: 0, taskAttemptId: 'attempt-1' };
async function harness(exec?: any, executionPolicy?: 'development-unbounded-v1') {
  const dir = await mkdtemp('/Users/mater/.hermes/cache/scratch/raw-capture-');
  const png = await sharp({ create: { width: 2, height: 3, channels: 3, background: 'white' } }).png().toBuffer();
  let time = 10000;
  const calls: any[] = [];
  const api = await load();
  assert.ok(api?.RawCapture, 'missing independent bounded raw capture');
  const device = new api.RawCapture({ executionPolicy, serial: 'offline-serial', evidenceDir: dir,
    clock: { now: () => time, monotonic: () => time, sleep: async (ms: number) => { time += ms; } },
    exec: async (file: string, args: string[], limits: any) => {
      calls.push({ file, args, limits });
      time += 10;
      if (exec) return exec(file, args, limits, png, () => time, (n: number) => { time += n; });
      return { stdout: args.includes('screencap') ? png : Buffer.from('topResumedActivity=ActivityRecord{ x u0 com.taobao.taobao/.Main }') };
    } });
  return { device, dir, png, calls, now: () => time, advance: (ms: number) => { time += ms; } };
}
test('development raw capture preserves all requested frames and slow OCR without total deadline or age veto',async()=>{
 const h=await harness(async(_file:any,args:string[],limits:any,png:Buffer,_now:any,advance:any)=>{advance(3000);assert.ok(limits.timeoutMs>0&&Number.isFinite(limits.timeoutMs));return {stdout:args.includes('screencap')?png:'topResumedActivity=ActivityRecord{ u0 com.taobao.taobao/.Main }'};},'development-unbounded-v1');
 try{const batch=await h.device.captureBurst(owner,{frames:9,intervalMs:500,budgetMs:1});assert.equal(batch.status,'complete',batch.error);assert.equal(batch.frames.length,9);
  const frames=await h.device.deriveFrames(batch,async raw=>{h.advance(6000);return {pages:raw.map(f=>({file:f.path,width:2,height:3,lines:[{text:'actual offline parser fixture',bounds:[0,0,2,3]}]}))};},{budgetMs:1});assert.equal(frames.length,9);assert.equal(frames[0].capturedAt,batch.frames[0].capturedAt);
 }finally{await rm(h.dir,{recursive:true,force:true});}
});
test('offline batch OCR derives real lines only after burst, preserves provenance and rejects late results', async () => {
  const h = await harness();
  try {
    const batch = await h.device.captureBurst(owner, { frames: 2, intervalMs: 250 });
    const original = await readFile(batch.frames[0].sidecarPath, 'utf8');
    let calls = 0;
    const parser = async (frames: any[], limits: any) => {
      calls++;
      assert.equal(frames.length, 2);
      assert.ok(limits.timeoutMs <= 1000);
      return { pages: frames.map(f => ({ file: f.path, width: 2, height: 3, lines: [{ text: '真实解析接口测试', bounds: [0, 0, 2, 3] }] })) };
    };
    const derived = await h.device.deriveFrames(batch, parser, { budgetMs: 1000 });
    assert.equal(calls, 1);
    assert.equal(derived[0].capturedAt, batch.frames[0].capturedAt);
    assert.equal(derived[0].lines[0].text, '真实解析接口测试');
    assert.equal((derived[0].page as any).rawCapture.pngSha256, batch.frames[0].pngSha256);
    assert.equal(await readFile(batch.frames[0].sidecarPath, 'utf8'), original);
    await assert.rejects(h.device.deriveFrames(batch, async (f: any[], l: any) => { h.advance(5001); return parser(f, l); }, { budgetMs: 1000 }), /deadline|expired/i);
    await assert.rejects(h.device.deriveFrames(batch, parser, { budgetMs: 1000 }), /expired/i);
  } finally { await rm(h.dir, { recursive: true, force: true }); }
});

test('slow capture stops within deadline and retains busy until uncancellable injected exec settles', async () => {
  let release!: (value: any) => void;
  const h = await harness(async (_f: any, args: string[], limits: any, png: Buffer) => {
    if (args.includes('screencap')) return new Promise(r => { release = r; });
    return { stdout: 'topResumedActivity=ActivityRecord{ u0 com.taobao.taobao/.Main }' };
  });
  try {
    const promise = h.device.captureBurst(owner, { frames: 1, intervalMs: 0, budgetMs: 40 });
    const result = await promise;
    assert.equal(result.status, 'timeout');
    assert.equal(result.frames.length, 0);
    await assert.rejects(h.device.captureBurst(owner, { frames: 1, intervalMs: 0 }), /busy/i);
    release({ stdout: h.png });
    await new Promise(r => setImmediate(r));
  } finally { await rm(h.dir, { recursive: true, force: true }); }
});

test('foreground user switch rejects screenshot instead of minting a fresh frame', async () => {
  let reads = 0;
  const h = await harness(async (_f: any, args: string[], _l: any, png: Buffer) => ({ stdout: args.includes('screencap') ? png : `topResumedActivity=ActivityRecord{ u${reads++ ? 999 : 0} com.taobao.taobao/.Main }` }));
  try {
    const batch = await h.device.captureBurst(owner, { frames: 8, intervalMs: 250 });
    assert.equal(batch.status, 'failed');
    assert.equal(batch.frames.length, 0);
    assert.match(batch.error!, /identity/);
  } finally { await rm(h.dir, { recursive: true, force: true }); }
});

test('derivation rejects empty OCR and detects modified raw evidence', async () => {
  const h = await harness();
  try {
    const batch = await h.device.captureBurst(owner, { frames: 1, intervalMs: 0 });
    await assert.rejects(h.device.deriveFrames(batch, async () => ({ pages: [{ file: batch.frames[0].path, width: 2, height: 3, lines: [] }] }), { budgetMs: 1000 }), /empty OCR/i);
    const { writeFile } = await import('node:fs/promises');
    await writeFile(batch.frames[0].path, Buffer.from('tampered'));
    let parsed = false;
    await assert.rejects(h.device.deriveFrames(batch, async () => { parsed = true; return {}; }, { budgetMs: 1000 }), /hash/i);
    assert.equal(parsed, false);
  } finally { await rm(h.dir, { recursive: true, force: true }); }
});

test('production OCR binary protocol runs once for saved PNGs after capture', async () => {
  const h = await harness(async (file: string, args: string[], _limits: any, png: Buffer) => {
    if (file === 'offline-ocr') {
      const { writeFile } = await import('node:fs/promises');
      await writeFile(args[0], JSON.stringify({ pages: args.slice(1).map(path => ({ file: path, width: 2, height: 3, lines: [{ text: 'protocol fixture', bounds: [0, 0, 2, 3] }] })) }));
      return { stdout: Buffer.alloc(0) };
    }
    return { stdout: args.includes('screencap') ? png : 'mResumedActivity: ActivityRecord{ u0 com.taobao.taobao/.Main }' };
  });
  try {
    const batch = await h.device.captureBurst(owner, { frames: 2, intervalMs: 250 });
    assert.equal(h.calls.some(c => c.file === 'offline-ocr'), false);
    const result = await h.device.deriveFrames(batch, { ocrBinary: 'offline-ocr' }, { budgetMs: 1000 });
    assert.equal(h.calls.filter(c => c.file === 'offline-ocr').length, 1);
    assert.equal(result.length, 2);
    assert.equal(result[0].capturedAt, batch.frames[0].capturedAt);
  } finally { await rm(h.dir, { recursive: true, force: true }); }
});

test('serial raw burst saves PNG and immutable owner/time/hash sidecars without OCR or action authority', async () => {
  const h = await harness();
  try {
    const batch = await h.device.captureBurst(owner, { frames: 8, intervalMs: 250, budgetMs: 2000 });
    assert.equal(batch.status, 'complete');
    assert.equal(batch.frames.length, 8);
    assert.ok(h.now() <= 12000);
    for (const frame of batch.frames) {
      assert.deepEqual(await readFile(frame.path), h.png);
      assert.deepEqual(JSON.parse(await readFile(frame.sidecarPath, 'utf8')), frame);
      assert.equal(frame.pngSha256, createHash('sha256').update(h.png).digest('hex'));
      assert.equal(frame.owner.taskAttemptId, owner.taskAttemptId);
      assert.equal(frame.batchId, batch.id);
      assert.equal('lines' in frame, false);
      assert.equal('authority' in frame, false);
      assert.equal(Object.isFrozen(frame.owner), true);
    }
    assert.equal((h.device as any).act, undefined);
    assert.equal(h.calls.length, 24);
    assert.ok(h.calls.every(c => c.file === 'adb' && c.args[0] === '-s' && c.args[1] === 'offline-serial'));
    assert.ok(h.calls.every(c => !c.args.includes('input') && c.limits.timeoutMs > 0 && c.limits.timeoutMs <= 2000));
  } finally { await rm(h.dir, { recursive: true, force: true }); }
});
