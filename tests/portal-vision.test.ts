import assert from 'node:assert/strict';
import test from 'node:test';
import type { MidsceneUsageMetrics } from '@midscene/core';
import type { AbstractInterface } from '@midscene/core/device';

import { PortalVision, type PortalVisionFrame } from '../runner/portal-vision';
import * as vision from '../runner/portal-vision';
const frame = () => ({ id: 'frame-1', dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', width: 1, height: 1, capturedAt: 1000 });
const metrics = (): MidsceneUsageMetrics => ({ totalPromptTokens: 10, totalCompletionTokens: 2,
  totalTokens: 12, totalCachedInput: 3, totalTimeCostMs: 15, calls: 1,
  byIntent: { query: { promptTokens: 10, completionTokens: 2, totalTokens: 12, calls: 1 } },
  byModel: { test: { promptTokens: 10, completionTokens: 2, totalTokens: 12, calls: 1 } } });

test('query reads the supplied static screenshot with an empty action space and releases its agent', async () => {
  assert.equal(typeof vision.PortalVision, 'function', 'PortalVision adapter must exist');
  let destroyed = 0;
  const supplied = frame();
  const adapter = new vision.PortalVision((device: AbstractInterface) => ({
    metrics: metrics(),
    async aiQuery(prompt: string) {
      assert.equal(prompt, '{label: string}, visible label');
      assert.equal(await device.screenshotBase64(), supplied.dataUrl);
      assert.equal(await device.screenshotBase64(), supplied.dataUrl);
      assert.deepEqual(await device.size(), { width: 1, height: 1 });
      assert.deepEqual(device.actionSpace(), []);
      assert.equal('inputPrimitives' in device, false);
      return { label: 'test label' };
    },
    async destroy() { destroyed++; },
  }));
  assert.deepEqual(await adapter.query(supplied, '{label: string}, visible label'), { label: 'test label' });
  assert.equal(destroyed, 1);
});

test('each concurrent query pins an immutable copy of its own exact frame', async () => {
  const devices: AbstractInterface[] = [];
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const adapter = new vision.PortalVision(device => {
    devices.push(device);
    return { metrics: metrics(), async destroy() {}, async aiQuery() {
      await gate;
      return device.screenshotBase64();
    } };
  });
  const first = frame();
  const second = { ...frame(), id: 'frame-2', dataUrl: frame().dataUrl.replace('P8/x8', 'P8/z8') };
  const expected = [first.dataUrl, second.dataUrl];
  const results = [adapter.query(first, 'read first'), adapter.query(second, 'read second')];
  first.dataUrl = second.dataUrl;
  first.width = 99;
  release();
  assert.deepEqual(await Promise.all(results), expected);
  assert.deepEqual(await devices[0].size(), { width: 1, height: 1 });
});

test('invalid frame metadata or image fails closed before agent creation', async () => {
  let created = 0;
  const adapter = new PortalVision(() => {
    created++;
    return { metrics: metrics(), async aiQuery() {}, async destroy() {} };
  });
  const invalid = [null, undefined, {}, ...[
    { id: '' }, { id: ' ' }, { dataUrl: '' }, { dataUrl: 'https://example.invalid/screen.png' },
    { dataUrl: 'file:///screen.png' }, { dataUrl: 'data:image/png;base64,AAAA' },
    { dataUrl: 'data:image/png;base64,%%%' }, { width: 0 }, { width: 1.5 },
    { width: 2 }, { height: -1 }, { height: Infinity },
    { capturedAt: NaN }, { capturedAt: -1 }, { capturedAt: '1000' },
  ].map(change => ({ ...frame(), ...change }))];
  for (const bad of invalid) {
    await assert.rejects(adapter.query(bad as PortalVisionFrame, 'read'), /Invalid static frame/);
  }
  assert.equal(created, 0);
});

test('usage retains all metric fields before cleanup and aggregates success and failed queries', async () => {
  let destroyed = 0;
  const adapter = new PortalVision(() => {
    const usage = metrics();
    return { metrics: usage, async aiQuery(prompt) {
      if (prompt === 'fail') throw new Error('provider payload');
      return 'read';
    }, async destroy() { destroyed++; usage.totalTokens = 0; usage.byIntent = {}; } };
  });
  assert.equal(adapter.usage, null, 'unmeasured usage is unknown');
  await adapter.query(frame(), 'success');
  const saved = adapter.usage!;
  assert.deepEqual(saved, metrics());
  saved.byModel.test.totalTokens = 999;
  assert.equal(adapter.usage!.byModel.test.totalTokens, 12, 'usage snapshots are detached');
  await assert.rejects(adapter.query(frame(), 'fail'));
  const total = metrics();
  for (const key of ['totalPromptTokens', 'totalCompletionTokens', 'totalTokens', 'totalCachedInput', 'totalTimeCostMs', 'calls'] as const) total[key] *= 2;
  for (const groups of [total.byIntent, total.byModel]) {
    for (const bucket of Object.values(groups)) {
      for (const key of ['promptTokens', 'completionTokens', 'totalTokens', 'calls'] as const) bucket[key] *= 2;
    }
  }
  assert.deepEqual(adapter.usage, total);
  assert.equal(destroyed, 2);
});

test('adapter exposes only query, usage and destroy and closes without discarding usage', async () => {
  const adapter = new PortalVision(() => ({ metrics: metrics(), async aiQuery() { return 'ok'; }, async destroy() {} }));
  assert.deepEqual(Object.getOwnPropertyNames(Object.getPrototypeOf(adapter)).sort(),
    ['constructor', 'destroy', 'query', 'usage']);
  assert.deepEqual(Object.keys(adapter), []);
  await adapter.query(frame(), 'read');
  await adapter.destroy();
  await adapter.destroy();
  assert.deepEqual(adapter.usage, metrics());
  await assert.rejects(adapter.query(frame(), 'read'), /destroyed/);
});

test('default factory creates the real public core Agent using only the static screenshot interface', async t => {
  // Importing this module above must configure the existing model before core loads.
  const { Agent } = await import('@midscene/core');
  let queried = 0;
  let destroyed = 0;
  const originalDestroy = Agent.prototype.destroy;
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('Network forbidden in offline test'); });
  t.mock.method(Agent.prototype, 'aiQuery', async function(this: InstanceType<typeof Agent>, prompt: string) {
    queried++;
    assert.ok(this instanceof Agent);
    assert.equal(prompt, 'read offline');
    assert.equal(await this.interface.screenshotBase64(), frame().dataUrl);
    assert.deepEqual(await this.interface.size(), { width: 1, height: 1 });
    assert.deepEqual(this.interface.actionSpace(), []);
    assert.equal('inputPrimitives' in this.interface, false);
    assert.equal(this.opts.generateReport, false);
    assert.equal(this.opts.persistExecutionDump, false);
    assert.equal(this.opts.autoPrintReportMsg, false);
    assert.equal(this.opts.cache, false);
    // Core adds its own Sleep action; no input capability is added.
    assert.deepEqual((await this.getActionSpace()).map(action => action.name), ['Sleep']);
    return { label: 'offline interface' };
  });
  t.mock.method(Agent.prototype, 'destroy', async function(this: InstanceType<typeof Agent>) {
    destroyed++;
    await originalDestroy.call(this);
  });
  const adapter = new PortalVision();
  assert.deepEqual(await adapter.query(frame(), 'read offline'), { label: 'offline interface' });
  await adapter.destroy();
  assert.equal(queried, 1);
  assert.equal(destroyed, 1);
  assert.equal(adapter.usage!.calls, 0);
});

test('query and cleanup failures release the agent and expose no provider payload', async () => {
  let destroyed = 0;
  const adapter = new PortalVision(() => ({
    metrics: metrics(), async aiQuery() { throw new Error('SECRET provider response'); },
    async destroy() { destroyed++; throw new Error('SECRET cleanup response'); },
  }));
  await assert.rejects(adapter.query(frame(), 'read'), error => {
    assert.equal((error as Error).message, 'Static vision query failed');
    assert.equal((error as Error).cause, undefined);
    return true;
  });
  assert.equal(destroyed, 1);
  assert.deepEqual(adapter.usage, metrics());
});

test('destroy waits for in-flight query cleanup and blocks new queries immediately', async () => {
  let queryStarted!: () => void;
  const started = new Promise<void>(resolve => { queryStarted = resolve; });
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let cleaned = false;
  const adapter = new PortalVision(() => ({ metrics: metrics(), async aiQuery() {
    queryStarted(); await gate; return 'read';
  }, async destroy() { cleaned = true; } }));
  const pending = adapter.query(frame(), 'read');
  await started;
  let closed = false;
  const closing = adapter.destroy().then(() => { closed = true; });
  await Promise.resolve();
  assert.equal(closed, false, 'destroy must await query cleanup');
  await assert.rejects(adapter.query(frame(), 'read'), /destroyed/);
  release();
  assert.equal(await pending, 'read');
  await closing;
  assert.equal(cleaned, true);
});
