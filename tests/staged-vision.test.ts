import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
const load = () => import('../runner/staged/vision-client.ts');

test('vision configuration errors do not echo credentials in malformed endpoint URLs', async () => {
  const { VisionClient } = await load();
  assert.throws(() => new VisionClient({ baseUrl: 'invalid secret-endpoint', apiKey: 'secret', model: 'vision' }), error => {
    assert.doesNotMatch(String(error), /secret/);
    assert.doesNotMatch(JSON.stringify(error), /secret/);
    return true;
  });
});

test('vision bounds response-body reading and records missing provider usage as unknown', async () => {
  const { VisionClient } = await load();
  const stalled = new VisionClient({ baseUrl: 'https://offline.invalid/v1', apiKey: 'secret', model: 'vision', fetch: async () => ({ ok: true, json: () => new Promise(() => {}) }) as Response });
  await assert.rejects(stalled.query({ prompt: 'Read', maxMs: 10 }), /timeout/i);
  const client = new VisionClient({ baseUrl: 'https://offline.invalid/v1', apiKey: 'secret', model: 'vision', fetch: async () => new Response(JSON.stringify({ choices: [{ message: { content: '{"known":null}' } }] })) });
  assert.deepEqual(await client.query({ prompt: 'Read' }), { known: null });
  assert.equal(client.usage[0].tokens, null);
  assert.equal(client.usage[0].promptTokens, null);
  assert.equal(client.usage[0].completionTokens, null);
});

test('vision rejects unreadable or mismatched images before issuing any HTTP request', async () => {
  const { VisionClient } = await load();
  await withFrame(async frame => {
    let requests = 0;
    const client = new VisionClient({ baseUrl: 'https://offline.invalid/v1', apiKey: 'secret', model: 'vision', fetch: async () => { requests++; throw Error('must not send'); } });
    for (const invalid of [{ ...frame, width: 2 }, { ...frame, height: 0 }, { ...frame, path: frame.path + '-missing' }]) {
      await assert.rejects(client.query({ prompt: 'Read', frame: invalid }));
    }
    await writeFile(frame.path, 'not an image');
    await assert.rejects(client.query({ prompt: 'Read', frame }));
    assert.equal(requests, 0);
    assert.ok(client.usage.every(u => u.calls === 0 && u.tokens === null));
  });
});

test('vision honors remaining time even when injected fetch ignores its AbortSignal', async () => {
  const { VisionClient } = await load();
  let calls = 0;
  const client = new VisionClient({ baseUrl: 'https://offline.invalid/v1', apiKey: 'secret', model: 'vision', timeoutMs: 1000, fetch: async () => { calls++; return new Promise(() => {}); } });
  const started = Date.now();
  await assert.rejects(client.query({ prompt: 'Read', maxMs: 15 }), /timeout|budget/i);
  assert.ok(Date.now() - started < 500);
  assert.equal(calls, 1);
  assert.equal(client.usage[0].tokens, null);
});

test('vision rejects an exhausted budget or aborted caller before sending and supports in-flight cancellation', async () => {
  const { VisionClient } = await load();
  let calls = 0;
  const client = new VisionClient({ baseUrl: 'https://offline.invalid/v1', apiKey: 'secret', model: 'vision', fetch: async () => { calls++; return new Promise(() => {}); } });
  await assert.rejects(client.query({ prompt: 'Read', maxMs: 0 }), /budget/i);
  const already = new AbortController(); already.abort('private reason');
  await assert.rejects(client.query({ prompt: 'Read', signal: already.signal }), /abort/i);
  assert.equal(calls, 0);
  const controller = new AbortController();
  const pending = client.query({ prompt: 'Read', signal: controller.signal });
  setTimeout(() => controller.abort('secret'), 5);
  await assert.rejects(pending, /abort/i);
  assert.equal(calls, 1);
});

 test('vision fails strictly, never retries or leaks provider content, and retains unknown tokens as null', async () => {
  const { VisionClient } = await load();
  for (const response of [new Response('secret data:image/png;base64,private', { status: 500 }), ...[
    'prefix {"ok":true}', '```json\n{"ok":true}\n``` extra', 'null', '[]', '{broken',
  ].map(content => new Response(JSON.stringify({ choices: [{ message: { content } }] })))]) {
    let calls = 0;
    const client = new VisionClient({ baseUrl: 'https://offline.invalid/v1', apiKey: 'secret', model: 'vision', fetch: async () => { calls++; return response; } });
    await assert.rejects(client.query({ prompt: 'Read' }), error => {
      assert.doesNotMatch(String(error), /secret|base64|private|broken/); return true;
    });
    assert.equal(calls, 1);
    assert.equal(client.usage[0].tokens, null);
    assert.ok(client.usage[0].error);
  }
});
async function withFrame(fn: (frame: any) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), 'staged-vision-'));
  try {
    const path = join(dir, 'frame.png');
    await writeFile(path, png);
    await fn({ id: 'frame-1', path, width: 1, height: 1, capturedAt: 123 });
  } finally { await rm(dir, { recursive: true, force: true }); }
}

test('vision sends exact image bytes to OpenAI chat endpoint and parses fenced JSON with measured usage', async () => {
  const { VisionClient } = await load();
  await withFrame(async frame => {
    let calls = 0;
    const client = new VisionClient({ baseUrl: 'https://offline.invalid/v1/', apiKey: 'secret', model: 'vision', fetch: async (url, init) => {
      calls++;
      assert.equal(String(url), 'https://offline.invalid/v1/chat/completions');
      assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer secret');
      const body = JSON.parse(String(init?.body));
      assert.equal(body.model, 'vision');
      assert.match(body.messages[0].content, /JSON/);
      assert.deepEqual(body.response_format, { type: 'json_object' });
      assert.equal(body.messages[1].content[1].image_url.url, 'data:image/png;base64,' + png.toString('base64'));
      assert.match(body.messages[1].content[0].text, /frame-1/);
      assert.match(body.messages[1].content[0].text, /checkpoint/);
      return new Response(JSON.stringify({ choices: [{ message: { content: '```json\n{"page":"list"}\n```' } }], usage: { prompt_tokens: 14, completion_tokens: 3, total_tokens: 17 } }));
    } });
    assert.deepEqual(await client.query({ prompt: 'Read page', frame, context: { checkpoint: 'entry' } }), { page: 'list' });
    assert.equal(calls, 1);
    assert.equal(client.usage.length, 1);
    assert.equal(client.usage[0].calls, 1);
    assert.equal(client.usage[0].tokens, 17);
    assert.equal(client.usage[0].promptTokens, 14);
    assert.equal(client.usage[0].completionTokens, 3);
    assert.equal(client.usage[0].error, null);
    assert.ok(client.usage[0].ms! >= 0);
  });
});
