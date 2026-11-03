import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer, type RequestListener } from 'node:http';
import { once } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { acquireDeviceLock } from '../runner/device-lock.ts';

async function serve(fn: RequestListener) {
  const server = createServer(fn);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const addr = server.address() as { port: number };
  return { baseUrl: `http://127.0.0.1:${addr.port}`, close: () => new Promise<void>((resolve) => {
    server.close(() => resolve()); server.closeAllConnections();
  }) };
}
const portal: any = await import('../runner/portal-client.ts').catch((e) => {
  if (e.code === 'ERR_MODULE_NOT_FOUND') return {};
  throw e;
});

test('parses ContentProvider rows and JSON encoded results with explicit status', () => {
  assert.equal(typeof portal.parsePortalEnvelope, 'function');
  const state = { a11y_tree: { children: [] }, phone_state: { width: 1080 } };
  const raw = 'Row: 0 result=' + JSON.stringify({ status: 'success', result: JSON.stringify(state) });
  assert.deepEqual(portal.parsePortalEnvelope(raw), { status: 'success', result: state });
  assert.deepEqual(portal.parsePortalEnvelope({ status: 'success', result: 'token-value' }),
    { status: 'success', result: 'token-value' });
  assert.deepEqual(portal.parsePortalEnvelope({ status: 'error', error: 'secret-token' }),
    { status: 'error', error: 'Portal reported an error' });
  for (const raw of [null, 'secret-token', {}, { result: 1 }, { status: 'success' }]) {
    assert.throws(() => portal.parsePortalEnvelope(raw), /^PortalError: Invalid Portal envelope$/);
  }
});

test('readState uses authenticated full unfiltered state and preserves snapshot metadata', async () => {
  assert.equal(typeof portal.PortalHttpClient, 'function');
  const state = { a11y_tree: { children: [] }, phone_state: { width: 1080 },
    degraded: true, degradedReason: 'a11y_timeout', snapshotAgeMs: 48642 };
  const server = await serve((req, res) => {
    assert.equal(req.url, '/state_full?filter=false');
    assert.equal(req.method, 'GET');
    assert.equal(req.headers.authorization, 'Bearer test-token');
    res.end(JSON.stringify({ status: 'success', result: JSON.stringify(state) }));
  });
  try {
    const client = new portal.PortalHttpClient({ baseUrl: server.baseUrl, token: 'test-token' });
    assert.deepEqual(await client.readState(), state);
  } finally { await server.close(); }
});

test('tap and swipe send exactly one form POST and report dispatch separately from business success', async () => {
  const calls: { path: string; body: string }[] = [];
  const server = await serve(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    assert.equal(req.method, 'POST');
    assert.equal(req.headers['content-type'], 'application/x-www-form-urlencoded');
    assert.equal(req.headers.authorization, 'Bearer test-token');
    calls.push({ path: req.url!, body });
    res.end(JSON.stringify({ status: 'success', result: 'Gesture dispatched' }));
  });
  try {
    const client = new portal.PortalHttpClient({ baseUrl: server.baseUrl, token: 'test-token' });
    assert.deepEqual(await client.tap(12, 34), { dispatch: 'responded', portalStatus: 'success', businessSuccess: 'unverified' });
    assert.deepEqual(await client.swipe({ startX: 1, startY: 2, endX: 3, endY: 4, duration: 250 }),
      { dispatch: 'responded', portalStatus: 'success', businessSuccess: 'unverified' });
    assert.deepEqual(calls, [{ path: '/tap', body: 'x=12&y=34' },
      { path: '/swipe', body: 'startX=1&startY=2&endX=3&endY=4&duration=250' }]);
  } finally { await server.close(); }
});

test('POST timeout and transport ambiguity never retry and never expose upstream secrets', async () => {
  for (const mode of ['timeout', 'reject']) {
    let calls = 0;
    const fetchImpl = async (_url: unknown, init: RequestInit) => {
      calls++;
      assert.equal(init.redirect, 'error');
      if (mode === 'reject') throw new Error('test-token body=private-screen');
      return await new Promise<Response>(() => {});
    };
    const client = new portal.PortalHttpClient({ baseUrl: 'http://127.0.0.1:12345',
      token: 'test-token', fetchImpl, timeoutMs: 10 });
    await assert.rejects(client.tap(1, 2), (error: any) => {
      assert.equal(error.dispatch, 'unknown');
      assert.equal(error.code, mode === 'timeout' ? 'TIMEOUT' : 'TRANSPORT');
      assert.doesNotMatch(JSON.stringify(error) + error.stack, /test-token|private-screen/);
      assert.equal(error.cause, undefined);
      return true;
    });
    assert.equal(calls, 1);
  }
});

const lockRoot = fs.mkdtempSync(path.join(process.env.TMPDIR!, 'portal-offline-'));
test.after(() => fs.rmSync(lockRoot, { recursive: true, force: true }));
function sessionHarness(serial: string) {
  const calls: string[][] = [];
  const opts = { serial, lockRoot, exec: async (file: string, args: string[]) => {
    assert.equal(file, 'adb');
    assert.deepEqual(args.slice(0, 2), ['-s', serial]);
    await assert.rejects(acquireDeviceLock({ serial, lockRoot }), /locked/);
    const command = args.slice(2); calls.push(command);
    if (command[0] === 'forward') return { stdout: command[1] === '--remove' ? '' : '43210\n' };
    return { stdout: 'Row: 0 result=' + JSON.stringify({ status: 'success',
      result: command.includes('content://com.mobilerun.portal/auth_token') ? 'test-token' : 'ok' }) };
  } };
  return { opts, calls };
}

test('local session preserves a running server and holds the real device lock through cleanup', async () => {
  assert.equal(typeof portal.withLocalPortalSession, 'function');
  const h = sessionHarness('running-offline');
  const urls: string[] = [];
  const result = await portal.withLocalPortalSession(async (client: any) => {
    await assert.rejects(acquireDeviceLock(h.opts), /locked/);
    return await client.readState();
  }, { ...h.opts, startServer: true, fetchImpl: async (url: URL, init: RequestInit) => {
    urls.push(url.href);
    if (url.pathname === '/ping') return new Response(JSON.stringify({ status: 'success', result: 'pong' }));
    assert.equal(new Headers(init.headers).get('Authorization'), 'Bearer test-token');
    return new Response(JSON.stringify({ status: 'success', result: { a11y_tree: {}, phone_state: {} } }));
  } });
  assert.deepEqual(result, { a11y_tree: {}, phone_state: {} });
  assert.deepEqual(urls, ['http://127.0.0.1:43210/ping', 'http://127.0.0.1:43210/state_full?filter=false']);
  assert.deepEqual(h.calls, [['forward', 'tcp:0', 'tcp:8080'],
    ['shell', 'content', 'query', '--uri', 'content://com.mobilerun.portal/auth_token'],
    ['forward', '--remove', 'tcp:43210']]);
  const released = await acquireDeviceLock(h.opts); released.release();
});

test('explicitly opted in session starts only an unavailable server and stops its own server', async () => {
  const h = sessionHarness('temporary-offline');
  let pings = 0;
  assert.equal(await portal.withLocalPortalSession(async () => 'done', { ...h.opts, startServer: true,
    fetchImpl: async (url: URL) => {
      assert.equal(url.pathname, '/ping');
      if (++pings === 1) throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
      return new Response(JSON.stringify({ status: 'success', result: 'pong' }));
    } }), 'done');
  assert.equal(pings, 2);
  assert.deepEqual(h.calls, [['forward', 'tcp:0', 'tcp:8080'],
    ['shell', 'content', 'insert', '--uri', 'content://com.mobilerun.portal/toggle_socket_server', '--bind', 'enabled:b:true'],
    ['shell', 'content', 'query', '--uri', 'content://com.mobilerun.portal/auth_token'],
    ['shell', 'content', 'insert', '--uri', 'content://com.mobilerun.portal/toggle_socket_server', '--bind', 'enabled:b:false'],
    ['forward', '--remove', 'tcp:43210']]);
});

test('cleanup attempts every owned resource and retains the primary setup error', async () => {
  const h = sessionHarness('setup-failure-offline');
  let pings = 0;
  const opts = { ...h.opts, startServer: true,
    exec: async (file: string, args: string[]) => {
      const result = await h.opts.exec(file, args);
      if (args.includes('content://com.mobilerun.portal/auth_token')) return { stdout: 'secret-token invalid envelope' };
      if (args.includes('enabled:b:false') || args.includes('--remove')) throw new Error('secret-token cleanup failure');
      return result;
    },
    fetchImpl: async () => {
      if (++pings === 1) throw Object.assign(new Error('secret-token'), { code: 'ECONNREFUSED' });
      return new Response(JSON.stringify({ status: 'success', result: 'pong' }));
    } };
  await assert.rejects(portal.withLocalPortalSession(async () => assert.fail('must not run'), opts), (error: any) => {
    assert.equal(error.code, 'INVALID_ENVELOPE');
    assert.doesNotMatch(String(error) + JSON.stringify(error), /secret-token/);
    return true;
  });
  assert.deepEqual(h.calls.slice(-2).map((args) => args.join(' ')), [
    'shell content insert --uri content://com.mobilerun.portal/toggle_socket_server --bind enabled:b:false',
    'forward --remove tcp:43210']);
  const released = await acquireDeviceLock(h.opts); released.release();
});

test('invalid coordinates fail before dispatch', async () => {
  let calls = 0;
  const client = new portal.PortalHttpClient({ baseUrl: 'http://127.0.0.1:1', token: 'test-token',
    fetchImpl: async () => { calls++; return new Response('{}'); } });
  for (const action of [() => client.tap(NaN, 1), () => client.tap(-1, 2),
    () => client.swipe({ startX: 1, startY: 2, endX: 3, endY: Infinity, duration: 5 }),
    () => client.swipe({ startX: 1, startY: 2, endX: 3, endY: 4, duration: -1 })]) {
    await assert.rejects(async () => action(), (error: any) => {
      assert.equal(error.code, 'INVALID_ACTION'); assert.equal(error.dispatch, 'not-dispatched'); return true;
    });
  }
  assert.equal(calls, 0);
});

test('server startup accepts ContentProvider insert CLI acknowledgements and verifies HTTP ping', async () => {
  const h = sessionHarness('insert-cli-offline');
  let pings = 0;
  await portal.withLocalPortalSession(async () => undefined, { ...h.opts, startServer: true,
    exec: async (file: string, args: string[]) => {
      const result = await h.opts.exec(file, args);
      return args.includes('insert') ? { stdout: 'Inserted content://com.mobilerun.portal/toggle_socket_server' } : result;
    }, fetchImpl: async () => {
      if (++pings === 1) throw Object.assign(new Error('unavailable'), { code: 'ECONNREFUSED' });
      return new Response(JSON.stringify({ status: 'success', result: 'pong' }));
    } });
  assert.equal(pings, 2);
  assert.equal(h.calls.at(-2)?.at(-1), 'enabled:b:false');
});

test('HTTP failures and malformed state stay sanitized', async () => {
  for (const [response, code] of [
    [() => new Response('secret-token private-screen', { status: 401 }), 'HTTP'],
    [() => new Response('secret-token private-screen'), 'INVALID_ENVELOPE'],
    [() => new Response(JSON.stringify({ status: 'error', error: 'secret-token private-screen' })), 'REMOTE'],
    [() => new Response(JSON.stringify({ status: 'success', result: { a11y_tree: null, phone_state: {} } })), 'INVALID_STATE'],
    [() => new Response(JSON.stringify({ status: 'success', result: { a11y_tree: {}, phone_state: [] } })), 'INVALID_STATE'],
  ] as const) {
    const client = new portal.PortalHttpClient({ baseUrl: 'http://127.0.0.1:1', token: 'test-token', fetchImpl: async () => response() });
    await assert.rejects(client.readState(), (error: any) => {
      assert.equal(error.code, code); assert.equal(error.dispatch, 'responded');
      assert.doesNotMatch(error.stack + JSON.stringify(error), /secret-token|private-screen/);
      return true;
    });
  }
});

test('Portal rejection of a POST is a response, without business success', async () => {
  let calls = 0;
  const client = new portal.PortalHttpClient({ baseUrl: 'http://127.0.0.1:1', token: 'test-token', fetchImpl: async () => {
    calls++; return new Response(JSON.stringify({ status: 'error', error: 'test-token' }));
  } });
  assert.deepEqual(await client.tap(1, 2), { dispatch: 'responded', portalStatus: 'error', businessSuccess: 'unverified' });
  assert.equal(calls, 1);
});

test('auth refusal, HTTP errors and invalid ping never start a server', async () => {
  const responses = [
    async () => new Response('secret-token', { status: 401 }),
    async () => new Response('secret-token', { status: 500 }),
    async () => new Response(JSON.stringify({ status: 'error', error: 'secret-token' })),
    async () => new Response(JSON.stringify({ status: 'success', result: 'not-pong' })),
    async () => await new Promise<Response>(() => {}),
  ];
  for (const [index, fetchImpl] of responses.entries()) {
    const h = sessionHarness(`ping-error-offline-${index}`);
    await assert.rejects(portal.withLocalPortalSession(async () => assert.fail('must not run'),
      { ...h.opts, startServer: true, fetchImpl, requestTimeoutMs: 5 }), (error: any) => {
      assert.doesNotMatch(error.stack + JSON.stringify(error), /secret-token/); return true;
    });
    assert.deepEqual(h.calls, [['forward', 'tcp:0', 'tcp:8080'], ['forward', '--remove', 'tcp:43210']]);
  }
});

test('unavailable server is left alone without explicit startup opt in', async () => {
  const h = sessionHarness('no-start-offline');
  await assert.rejects(portal.withLocalPortalSession(async () => assert.fail('must not run'), { ...h.opts,
    fetchImpl: async () => { throw Object.assign(new Error('secret-token'), { code: 'ECONNREFUSED' }); } }),
    (error: any) => error.code === 'UNAVAILABLE');
  assert.deepEqual(h.calls, [['forward', 'tcp:0', 'tcp:8080'], ['forward', '--remove', 'tcp:43210']]);
});

test('callback failure is preserved and own temporary server is cleaned up', async () => {
  const h = sessionHarness('callback-failure-offline');
  const primary = new Error('callback failed');
  let pings = 0;
  await assert.rejects(portal.withLocalPortalSession(async () => { throw primary; }, { ...h.opts, startServer: true,
    fetchImpl: async () => {
      if (++pings === 1) throw Object.assign(new Error('unavailable'), { code: 'ECONNREFUSED' });
      return new Response(JSON.stringify({ status: 'success', result: 'pong' }));
    } }), (error: any) => error === primary);
  assert.equal(h.calls.at(-2)?.at(-1), 'enabled:b:false');
  assert.deepEqual(h.calls.at(-1), ['forward', '--remove', 'tcp:43210']);
});

test('cleanup failures after callback success are surfaced without upstream details', async () => {
  const h = sessionHarness('cleanup-failure-offline');
  await assert.rejects(portal.withLocalPortalSession(async () => 'done', { ...h.opts,
    exec: async (file: string, args: string[]) => {
      const result = await h.opts.exec(file, args);
      if (args.includes('--remove')) throw new Error('secret-token');
      return result;
    }, fetchImpl: async () => new Response(JSON.stringify({ status: 'success', result: 'pong' })) }),
    (error: any) => { assert.equal(error.code, 'CLEANUP'); assert.doesNotMatch(error.stack, /secret-token/); return true; });
  const released = await acquireDeviceLock(h.opts); released.release();
});

const tcpHeader = '  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt uid timeout inode\n';
function tcpRow(ipv6: boolean, port = '1F90', state = '0A') {
  const address = '0'.repeat(ipv6 ? 32 : 8);
  return `  0: ${address}:${port} ${address}:0000 ${state} 00000000:00000000 00:00000000 00000000 1000 0 123 1 0000000000000000 100 0 0 10 0\n`;
}

test('ambiguous forwarded connection starts only after both device tables prove listener absent', async () => {
  for (const code of [undefined, 'ECONNRESET', 'UND_ERR_SOCKET']) {
    const h = sessionHarness(`absent-listener-${code}`);
    let pings = 0;
    await portal.withLocalPortalSession(async () => 'done', { ...h.opts, startServer: true,
      exec: async (file: string, args: string[]) => {
        const result = await h.opts.exec(file, args);
        if (args.includes('cat')) return { stdout: tcpHeader + tcpRow(args.at(-1)!.endsWith('tcp6'), '1F90', '01') };
        return result;
      }, fetchImpl: async () => {
        if (++pings === 1) throw Object.assign(new TypeError('fetch failed private-screen'), { cause: { code } });
        return new Response(JSON.stringify({ status: 'success', result: 'pong' }));
      } });
    assert.equal(pings, 2);
    assert.deepEqual(h.calls.slice(1, 3), [['shell', 'cat', '/proc/net/tcp'], ['shell', 'cat', '/proc/net/tcp6']]);
    assert.equal(h.calls.at(-2)?.at(-1), 'enabled:b:false');
  }
});

test('real device TCP tables accept padded header whitespace before automatic startup',async()=>{
 const h=sessionHarness('real-table-offline');let pings=0;
 await portal.withLocalPortalSession(async()=>undefined,{...h.opts,startServer:true,
  exec:async(file:string,args:string[])=>{const r=await h.opts.exec(file,args);
   if(args.includes('cat'))return {stdout:fs.readFileSync(new URL('../evidence/portal-collection-preflight/'+args.at(-1)!.split('/').at(-1)+'.txt',import.meta.url),'utf8')};
   return args.includes('insert')?{stdout:''}:r;
  },fetchImpl:async()=>{if(++pings===1)throw Object.assign(new Error('closed'),{code:'ECONNRESET'});return new Response(JSON.stringify({status:'success',result:'pong'}));}
 });assert.equal(pings,2);
});

test('known non-close transport faults never trigger listener inspection or startup', async () => {
  for (const code of ['ENOTFOUND', 'EACCES', 'ETIMEDOUT', 'ERR_INVALID_URL', 'UND_ERR_CONNECT_TIMEOUT']) {
    const h = sessionHarness(`non-close-${code}`);
    await assert.rejects(portal.withLocalPortalSession(async () => assert.fail('must not run'), {
      ...h.opts, startServer: true, fetchImpl: async () => {
        throw Object.assign(new TypeError('private-screen'), { cause: { code } });
      },
    }), (error: any) => error.code === 'TRANSPORT');
    assert.deepEqual(h.calls, [['forward', 'tcp:0', 'tcp:8080'], ['forward', '--remove', 'tcp:43210']]);
  }
});

test('occupied or unknown device listeners preserve the server and original transport error', async () => {
  const cases: [string | Error, string | Error][] = [
    [tcpHeader + tcpRow(false), tcpHeader], [tcpHeader, tcpHeader + tcpRow(true)],
    ['', tcpHeader], [tcpHeader, 'permission denied secret-token'],
    [tcpHeader + 'bad row\n', tcpHeader], [tcpHeader, tcpHeader + tcpRow(false)],
    [tcpHeader + tcpRow(false).replace('1000 0 123', 'garbage 0 123'), tcpHeader],
    [new Error('secret-token denied'), tcpHeader], [tcpHeader, new Error('secret-token denied')],
    [tcpHeader + tcpRow(false).replace('0A', 'ZZ'), tcpHeader],
  ];
  for (const [index, tables] of cases.entries()) {
    const h = sessionHarness(`preserve-listener-${index}`);
    await assert.rejects(portal.withLocalPortalSession(async () => assert.fail('must not run'), {
      ...h.opts, startServer: true, exec: async (file: string, args: string[]) => {
        const result = await h.opts.exec(file, args);
        if (!args.includes('cat')) return result;
        const output = tables[args.at(-1)!.endsWith('tcp6') ? 1 : 0];
        if (output instanceof Error) throw output;
        return { stdout: output };
      }, fetchImpl: async () => { throw Object.assign(new Error('secret-token'), { code: 'ECONNRESET' }); },
    }), (error: any) => {
      assert.equal(error.code, 'TRANSPORT'); assert.doesNotMatch(error.stack, /secret-token/); return true;
    });
    assert.equal(h.calls.some(args => args.includes('insert')), false);
    assert.deepEqual(h.calls.at(-1), ['forward', '--remove', 'tcp:43210']);
    const released = await acquireDeviceLock(h.opts); released.release();
  }
});

test('empty toggle acknowledgement remains pending until HTTP ping confirms startup', async () => {
  for (const ready of [true, false]) {
    const h = sessionHarness(`empty-toggle-${ready}`);
    let pings = 0, ran = false;
    const pending = portal.withLocalPortalSession(async () => { ran = true; }, { ...h.opts, startServer: true,
      exec: async (file: string, args: string[]) => {
        const result = await h.opts.exec(file, args);
        return args.includes('insert') ? { stdout: ' \n' } : result;
      }, fetchImpl: async () => {
        if (++pings === 1) throw Object.assign(new Error('absent'), { code: 'ECONNREFUSED' });
        return new Response(JSON.stringify({ status: 'success', result: ready ? 'pong' : 'not-pong' }));
      } });
    if (ready) await pending;
    else await assert.rejects(pending, (error: any) => error.code === 'PING');
    assert.equal(pings, 2); assert.equal(ran, ready);
    assert.equal(h.calls.at(-2)?.at(-1), 'enabled:b:false');
    assert.deepEqual(h.calls.at(-1), ['forward', '--remove', 'tcp:43210']);
  }
});

test('uncertain startup acknowledgement still cleans owned resources and preserves its primary error', async () => {
  for (const mode of ['malformed', 'remote-error', 'exec-error']) {
    const h = sessionHarness(`uncertain-toggle-${mode}`);
    let pings = 0;
    await assert.rejects(portal.withLocalPortalSession(async () => assert.fail('must not run'), {
      ...h.opts, startServer: true, exec: async (file: string, args: string[]) => {
        const result = await h.opts.exec(file, args);
        if (args.includes('enabled:b:true')) {
          if (mode === 'exec-error') throw new Error('secret-token');
          return { stdout: mode === 'malformed' ? 'secret-token' : JSON.stringify({ status: 'error', error: 'secret-token' }) };
        }
        if (args.includes('enabled:b:false') || args.includes('--remove')) throw new Error('secret-token cleanup');
        return result;
      }, fetchImpl: async () => {
        pings++; throw Object.assign(new Error('absent'), { code: 'ECONNREFUSED' });
      },
    }), (error: any) => {
      assert.equal(error.code, mode === 'malformed' ? 'INVALID_ENVELOPE' : mode === 'exec-error' ? 'ADB' : 'SERVER');
      assert.doesNotMatch(error.stack + JSON.stringify(error), /secret-token/); return true;
    });
    assert.equal(pings, 1);
    assert.equal(h.calls.at(-2)?.at(-1), 'enabled:b:false');
    assert.deepEqual(h.calls.at(-1), ['forward', '--remove', 'tcp:43210']);
    const released = await acquireDeviceLock(h.opts); released.release();
  }
});

const pngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ1cAAAAASUVORK5CYII=';
test('screenshot reads an authenticated base64 PNG envelope as a data URL', async () => {
  for (const result of [pngBase64, `data:image/png;base64,${pngBase64}`]) {
    let calls = 0;
    const client = new portal.PortalHttpClient({ baseUrl: 'http://127.0.0.1:1', token: 'test-token',
      fetchImpl: async (url: URL, init: RequestInit) => {
        calls++; assert.equal(url.pathname, '/screenshot'); assert.equal(init.method, 'GET');
        assert.equal(new Headers(init.headers).get('Authorization'), 'Bearer test-token');
        return new Response(JSON.stringify({ status: 'success', result }));
      } });
    assert.equal(await client.screenshot(), `data:image/png;base64,${pngBase64}`);
    assert.equal(calls, 1);
  }
});

test('screenshot rejects malformed base64 or non-PNG payloads without exposing data', async () => {
  for (const result of [null, {}, '', 'private-screen', pngBase64 + '!', pngBase64.slice(0, -4),
    `data:image/jpeg;base64,${pngBase64}`, Buffer.from('private-screen').toString('base64'),
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).toString('base64')]) {
    const client = new portal.PortalHttpClient({ baseUrl: 'http://127.0.0.1:1', token: 'test-token',
      fetchImpl: async () => new Response(JSON.stringify({ status: 'success', result })) });
    await assert.rejects(client.screenshot(), (error: any) => {
      assert.equal(error.code, 'INVALID_SCREENSHOT'); assert.equal(error.dispatch, 'responded');
      assert.doesNotMatch(error.stack + JSON.stringify(error), /private-screen|test-token/); return true;
    });
  }
  const client = new portal.PortalHttpClient({ baseUrl: 'http://127.0.0.1:1', token: '', fetchImpl: async () =>
    new Response(JSON.stringify({ status: 'error', error: 'private-screen' })) });
  await assert.rejects(client.screenshot(), (error: any) => error.code === 'REMOTE');
});

test('back posts global action 1 exactly once with an unverified receipt', async () => {
  for (const mode of ['success', 'error', 'reset', 'timeout']) {
    let calls = 0;
    const client = new portal.PortalHttpClient({ baseUrl: 'http://127.0.0.1:1', token: 'test-token', timeoutMs: 5,
      fetchImpl: async (url: URL, init: RequestInit) => {
        calls++; assert.equal(url.pathname, '/global'); assert.equal(init.method, 'POST'); assert.equal(init.body, 'action=1');
        assert.equal(new Headers(init.headers).get('Authorization'), 'Bearer test-token');
        assert.equal(new Headers(init.headers).get('Content-Type'), 'application/x-www-form-urlencoded');
        if (mode === 'reset') throw Object.assign(new Error('private-screen'), { code: 'ECONNRESET' });
        if (mode === 'timeout') return await new Promise<Response>(() => {});
        return new Response(JSON.stringify({ status: mode, result: 'ok', error: 'private-screen' }));
      } });
    if (mode === 'success' || mode === 'error') assert.deepEqual(await client.back(),
      { dispatch: 'responded', portalStatus: mode, businessSuccess: 'unverified' });
    else await assert.rejects(client.back(), (error: any) => {
      assert.equal(error.dispatch, 'unknown'); assert.equal(error.code, mode === 'reset' ? 'TRANSPORT' : 'TIMEOUT');
      assert.doesNotMatch(error.stack + JSON.stringify(error), /private-screen|test-token/); return true;
    });
    assert.equal(calls, 1);
  }
});

test('a server that responded before its body failed is never replaced', async () => {
  for (const code of ['ECONNREFUSED', 'ECONNRESET']) {
    const h = sessionHarness(`responded-body-${code}`);
    await assert.rejects(portal.withLocalPortalSession(async () => assert.fail('must not run'), {
      ...h.opts, startServer: true, fetchImpl: async () => ({ ok: true, text: async () => {
        throw Object.assign(new Error('secret-token'), { code });
      } }),
    }), (error: any) => {
      assert.equal(error.code, 'TRANSPORT'); assert.equal(error.dispatch, 'responded'); return true;
    });
    assert.deepEqual(h.calls, [['forward', 'tcp:0', 'tcp:8080'], ['forward', '--remove', 'tcp:43210']]);
  }
});

test('upstream transport cannot smuggle secrets through a PortalError', async () => {
  const client = new portal.PortalHttpClient({ baseUrl: 'http://127.0.0.1:1', token: 'test-token',
    fetchImpl: async () => { throw new portal.PortalError('secret-token private-screen', 'HTTP'); } });
  await assert.rejects(client.readState(), (error: any) => {
    assert.doesNotMatch(error.stack + JSON.stringify(error), /secret-token|private-screen/);
    return true;
  });
});
