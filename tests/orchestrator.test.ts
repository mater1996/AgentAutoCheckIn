import assert from 'node:assert/strict';
import fs from 'node:fs';
import test, { mock } from 'node:test';
import { z } from 'zod';

type PlatformTool = {
  name: string;
  description: string;
  schema: Record<string, z.ZodType>;
  handler: (args: any) => Promise<any>;
};
let invoke: { name: string; args: any };
let registeredTools: PlatformTool[] = [];

// Replace the SDK before importing the orchestrator: no CLI process or model can run.
mock.module('@anthropic-ai/claude-agent-sdk', {
  exports: {
    tool: (name: string, description: string, schema: PlatformTool['schema'], handler: PlatformTool['handler']) =>
      ({ name, description, schema, handler }),
    createSdkMcpServer: ({ tools }: { tools: PlatformTool[] }) => {
      registeredTools = tools;
      return { tools };
    },
    query: async function* () {
      const tool = registeredTools.find((tool) => tool.name === invoke.name)!;
      const result = await tool.handler(z.object(tool.schema).parse(invoke.args));
      yield { type: 'result', result: result.content[0].text, num_turns: 1 };
    },
  },
});
mock.module(new URL('../runner/agent-config.ts', import.meta.url).href, {
  exports: {
    loadAgentCfg: () => ({
      enabled: true,
      platform_api: 'http://offline.invalid',
      log_dir: '/unused-offline-logs',
      system_prompt_file: '/unused-offline-prompt.md',
      auth_token_env: 'ORCHESTRATOR_TEST_UNUSED_TOKEN',
    }),
    applyAgentEnv: () => ({ tokenSet: true }),
  },
});
const { orchestrate } = await import('../runner/orchestrator');

function fixture(t: any, name: string, postResponse: any, args = { activity: 'fixture', account: 'fixture-account' }) {
  invoke = { name, args };
  const requests: { url: string; method: string; body: any }[] = [];
  // Suppress session files as well as all HTTP: the only code exercised is local.
  t.mock.method(fs, 'mkdirSync', () => undefined);
  t.mock.method(fs, 'createWriteStream', () => ({ write() {}, end() {} }));
  t.mock.method(globalThis, 'fetch', async (input: any, init: any) => {
    const request = { url: String(input), method: init.method, body: init.body ? JSON.parse(init.body) : null };
    requests.push(request);
    return {
      ok: true,
      json: async () => init.method === 'POST' ? postResponse : {
        job_id: 41, run_id: 907, status: 'completed', result: { message: 'fixture finished' },
      },
    };
  });
  return requests;
}

test('run_activity polls job_id when the POST run_id is null', async (t) => {
  const requests = fixture(t, 'run_activity', { job_id: 41, run_id: null, status: 'queued' });
  const result = await orchestrate('offline fixture');
  assert.equal(result.ok, true, result.error);
  assert.deepEqual(requests, [
    { url: 'http://offline.invalid/api/run', method: 'POST', body: { activity: 'fixture', account: 'fixture-account' } },
    { url: 'http://offline.invalid/api/run/41', method: 'GET', body: null },
  ]);
  assert.deepEqual(JSON.parse(result.text), {
    job_id: 41, run_id: 907, status: 'completed', result: { message: 'fixture finished' },
  });
});

for (const [name, endpoint] of [['collect_inventory', '/api/plan'], ['run_activity', '/api/run']] as const) {
  test(`${name} uses job_id rather than differing plan_id or run_id`, async (t) => {
    const requests = fixture(t, name, { job_id: 41, plan_id: 612, run_id: 907 });
    const result = await orchestrate('offline fixture');
    assert.equal(result.ok, true, result.error);
    assert.deepEqual(requests.map(({ method, url }) => [method, url]), [
      ['POST', `http://offline.invalid${endpoint}`],
      ['GET', 'http://offline.invalid/api/run/41'],
    ]);
    assert.equal(JSON.parse(result.text).run_id, 907);
  });
}

const invalidIds = [undefined, null, 0, -1, 1.5, '41', '', '41/steps', NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, {}, []];
for (const name of ['collect_inventory', 'run_activity']) {
  for (const [index, job_id] of invalidIds.entries()) {
    test(`${name} rejects invalid POST job_id case ${index} before polling`, async (t) => {
      const requests = fixture(t, name, { job_id, plan_id: 612, run_id: 907 });
      const result = await orchestrate('offline fixture');
      assert.equal(result.ok, false);
      assert.match(result.error!, /job_id.*positive safe integer/i);
      assert.equal(requests.length, 1);
      assert.equal(requests[0].method, 'POST');
    });
  }
}

for (const [index, id] of invalidIds.entries()) {
  test(`read_run rejects invalid job ID case ${index} before HTTP`, async (t) => {
    const requests = fixture(t, 'read_run', null, { id } as any);
    const result = await orchestrate('offline fixture');
    assert.equal(result.ok, false);
    assert.deepEqual(requests, []);
  });
}

test('read_run accepts a queue job ID and describes its distinct meaning', async (t) => {
  const requests = fixture(t, 'read_run', null, { id: 41 } as any);
  const result = await orchestrate('offline fixture');
  assert.equal(result.ok, true, result.error);
  assert.deepEqual(requests, [{ url: 'http://offline.invalid/api/run/41', method: 'GET', body: null }]);
  for (const name of ['read_run', 'collect_inventory', 'run_activity']) {
    const tool = registeredTools.find((tool) => tool.name === name)!;
    assert.match(tool.description, /job_id/);
  }
  const read = registeredTools.find((tool) => tool.name === 'read_run')!;
  assert.match(read.schema.id.description!, /job_id/);
  assert.match(read.description, /run_id/);
});
