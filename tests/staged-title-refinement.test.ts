import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { AdbOcrDevice, type DeviceExec } from '../runner/staged/device.ts';
import { readPanel } from '../runner/staged/observations.ts';

const root = new URL('../evidence/staged-2026-11-01T10-00-35-084Z/', import.meta.url);
const original = JSON.parse(await readFile(new URL('0c71b6ad-2a02-4586-89d0-f7e5c153dfc0.json', root), 'utf8'));
const png = await readFile(new URL('0c71b6ad-2a02-4586-89d0-f7e5c153dfc0.png', root));
const hash = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');
const binary = '/Users/mater/.hermes/cache/scratch/checkin-apple-ocr';
const run = promisify(execFile);

async function replay(fn: (d: AdbOcrDevice, dir: string, calls: string[][]) => Promise<void>, options: { lines?: any[]; roi?: (args: string[], limits?: { timeoutMs: number }) => Promise<void>; now?: () => number; afterFull?: () => void } = {}) {
  const dir = await mkdtemp('/Users/mater/.hermes/cache/scratch/title-refinement-');
  const calls: string[][] = [];
  const exec: DeviceExec = async (file, args, limits) => {
    if (file === 'adb') {
      assert.ok(args.includes('activities') || args.includes('screencap'), 'offline test forbids device writes');
      return { stdout: args.includes('screencap') ? png : 'topResumedActivity=ActivityRecord{x u0 com.taobao.taobao/.Main}' };
    }
    assert.equal(file, binary);
    calls.push(args);
    if (calls.length === 1) {
      await writeFile(args[0], JSON.stringify({ pages: [{ file: args[1], width: 1080, height: 2400, lines: options.lines ?? original.lines }] }));
      options.afterFull?.();
    } else if (options.roi) await options.roi(args, limits);
    else await run(binary, args);
    return { stdout: '' };
  };
  try { await fn(new AdbOcrDevice({ serial: 'offline', evidenceDir: dir, exec, now: options.now ?? (() => 123) }), dir, calls); }
  finally { await rm(dir, { recursive: true, force: true }); }
}

test('run176 same PNG ROI recovers full current title without rewriting raw OCR or historical evidence', async () => {
  await replay(async (d, dir, calls) => {
    const f = await d.capture();
    assert.ok(readPanel(f).tasks.some(t => t.name === '拍立淘逛感兴趣的宝贝' && t.done === 2 && t.total === 5));
    assert.equal(calls.length, 2, 'one full OCR plus one bounded batch');
    assert.ok(calls[1].length > 1 && calls[1].length <= 11);
    const raw = await readFile(join(dir, f.id + '.ocr.json'));
    assert.ok(raw.includes(Buffer.from('拍立淘逛感兴趣宝贝')));
    assert.ok(!raw.includes(Buffer.from('拍立淘逛感兴趣的宝贝')));
    const provenance = (f as any).titleRefinement;
    assert.equal(provenance.sourceFrame.id, f.id);
    assert.equal(provenance.sourceFrame.sha256, hash(png));
    assert.equal(provenance.raw.sha256, hash(raw));
    assert.ok(provenance.crops.some((c: any) => c.accepted && c.result.text.includes('拍立淘逛感兴趣的宝贝')));
    const sharp = (await import('sharp')).default;
    for (const crop of provenance.crops) {
      const bytes = await readFile(crop.path), metadata = await sharp(bytes).metadata();
      assert.equal(hash(bytes), crop.sha256);
      assert.equal(crop.scale, 3);
      assert.equal(metadata.width, (crop.bounds[2] - crop.bounds[0]) * 3);
      assert.equal(metadata.height, (crop.bounds[3] - crop.bounds[1]) * 3);
      assert.ok(crop.bounds[0] <= crop.original.bounds[0] - 20);
      assert.ok(crop.bounds[1] <= crop.original.bounds[1] - 20);
      assert.ok(crop.bounds[2] >= crop.original.bounds[2] + 20);
      assert.ok(crop.bounds[3] >= crop.original.bounds[3] + 20);
      assert.ok(!original.lines.some((l: any) => /^(去完成|去逛逛|逛一逛|领取奖励|已完成)$/.test(l.text)
        && l.bounds[0] < crop.bounds[2] && l.bounds[2] > crop.bounds[0] && l.bounds[1] < crop.bounds[3] && l.bounds[3] > crop.bounds[1]));
    }
    assert.equal(hash(await readFile(provenance.results.path)), provenance.results.sha256);
    assert.deepEqual(JSON.parse(await readFile(join(dir, f.id + '.json'), 'utf8')), f);
    assert.equal(hash(await readFile(f.path)), hash(png));
    assert.equal(f.capturedAt, 123);
  });
  assert.deepEqual(JSON.parse(await readFile(new URL('0c71b6ad-2a02-4586-89d0-f7e5c153dfc0.json', root), 'utf8')), original);
});

test('non-panel, duplicate marker and excessive title count never invoke ROI OCR', async () => {
  for (const lines of [original.lines.filter((l: any) => l.text !== '赚金币抵钱'), [...original.lines, original.lines.find((l: any) => l.text === '赚金币抵钱')], [...original.lines, ...Array.from({ length: 4 }, (_, i) => ({ text: `额外标题${i}（0/1）`, bounds: [240, 800 + i * 100, 700, 840 + i * 100] }))]]) {
    await replay(async (d, _dir, calls) => { const f = await d.capture(); assert.equal(calls.length, 1); assert.deepEqual(f.lines, lines); }, { lines });
  }
});

test('expired full OCR never starts refinement and retains its original capture timestamp', async () => {
  let now = 123;
  await replay(async (d, _dir, calls) => {
    const f = await d.capture(); assert.equal(calls.length, 1); assert.deepEqual(f.lines, original.lines);
    assert.equal(f.titleRefinement?.status, 'expired');
    await assert.rejects(d.act({ type: 'tap', x: 900, y: 1240 }, f), /expired/);
  }, { now: () => now, afterFull: () => { now += 5001; } });
});

test('quota mismatch, extra lines, false titles, invalid bounds and misaligned local text preserve original', async () => {
  const old = original.lines.find((l: any) => l.text.startsWith('拍立淘'));
  for (const mode of ['quota', 'multiple', 'empty', 'false', 'misaligned', 'outside', 'wrong-file', 'wrong-size', 'malformed', 'null']) {
    await replay(async d => { const f = await d.capture(); assert.deepEqual(f.lines, original.lines, mode); }, { roi: async args => {
      if (mode === 'malformed') { await writeFile(args[0], '{broken'); return; }
      const sharp = (await import('sharp')).default;
      const pages = await Promise.all(args.slice(1).map(async file => {
        const m = await sharp(file).metadata();
        const index = Number(file.match(/title-(\d+)\.png$/)![1]);
        const b = original.lines[index].bounds;
        const left = Math.floor(b[0] - 20), top = Math.floor(b[1] - 20);
        const bounds = b.map((v: number, i: number) => (v - (i % 2 ? top : left)) * 3);
        const local = { text: old.text.replace('宝贝', '的宝贝'), bounds };
        if (mode === 'quota') local.text = local.text.replace('2/5', '3/5');
        if (mode === 'false') local.text = '没有次数的伪标题';
        if (mode === 'misaligned') { bounds[1] -= 61; bounds[3] -= 61; }
        if (mode === 'outside') bounds[0] = -1;
        return { file: mode === 'wrong-file' ? file + '-wrong' : file, width: mode === 'wrong-size' ? 1 : m.width, height: m.height,
          lines: mode === 'empty' ? [] : mode === 'multiple' ? [local, local] : mode === 'null' ? [null] : [local] };
      }));
      await writeFile(args[0], JSON.stringify({ pages }));
    } });
  }
});

test('occluding OCR and title too close to its button cannot be cropped into a replacement', async () => {
  const i = original.lines.findIndex((l: any) => l.text.startsWith('拍立淘'));
  for (const mode of ['occluded', 'button', 'false-title']) {
    const lines = structuredClone(original.lines);
    if (mode === 'occluded') lines.push({ text: '遮挡内容', bounds: [260, 1200, 750, 1230] });
    if (mode === 'button') lines[i].bounds[2] = 875;
    if (mode === 'false-title') lines[i].text = '没有配额';
    let cropped = false;
    await replay(async d => { const f = await d.capture(); assert.ok(!cropped); assert.deepEqual(f.lines, lines); }, { lines, roi: async args => {
      cropped = args.slice(1).some(p => p.endsWith(`title-${i}.png`));
      await writeFile(args[0], JSON.stringify({ pages: args.slice(1).map(file => ({ file, width: 1, height: 1, lines: [] })) }));
    } });
  }
});

test('batch arriving after deadline discards all local corrections without renewing authority', async () => {
  let now = 123;
  await replay(async d => { const f = await d.capture(); assert.equal(f.titleRefinement?.status, 'expired'); assert.deepEqual(f.lines, original.lines);
    await assert.rejects(d.act({ type: 'tap', x: 900, y: 1240 }, f), /expired/);
  }, { now: () => now, roi: async args => { await run(binary, args); now += 5001; } });
});

test('local OCR process gets the remaining original frame deadline and cannot renew expired authority', async () => {
  let now = 123, timeoutMs: number | undefined;
  await replay(async d => {
    const f = await d.capture();
    assert.ok(timeoutMs && timeoutMs > 0 && timeoutMs <= 5000, 'ROI process must be killed at original deadline');
    assert.equal(f.titleRefinement?.status, 'failed');
    assert.deepEqual(f.lines, original.lines);
    assert.equal(f.capturedAt, 123);
    await assert.rejects(d.act({ type: 'tap', x: 900, y: 1240 }, f), /expired/);
  }, { now: () => now, roi: async (_args, limits) => {
    now = 6000;
    timeoutMs = limits?.timeoutMs;
    throw Error('deadline reached');
  } });
});
