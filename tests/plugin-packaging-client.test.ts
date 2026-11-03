import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');

test('packaged launchers reject absent, relative, nonexistent and plugin cache workspaces', () => {
  for (const host of ['claude', 'codex']) {
    const launcher = path.join(root, 'plugins', host, 'checkin/bin/start-mcp');
    for (const workspace of ['', '.', path.join(root, 'plugins', host, 'checkin'), path.join(root, 'does-not-exist')]) {
      const result = spawnSync(launcher, { cwd: root, env: { PATH: process.env.PATH, CHECKIN_WORKSPACE: workspace }, encoding: 'utf8' });
      assert.equal(result.status, 64, JSON.stringify(result));
      assert.equal(result.stdout, '', 'diagnostics must not corrupt JSON-RPC stdout');
      assert.match(result.stderr, /CHECKIN_WORKSPACE/);
    }
  }
});

test('launcher refuses another project even if it has tsx and a server-shaped file', () => {
  const workspace = fs.mkdtempSync(path.join(process.env.TMPDIR ?? os.tmpdir(), 'checkin-contract-'));
  try {
    fs.mkdirSync(path.join(workspace, 'runner/mcp'), { recursive: true });
    fs.mkdirSync(path.join(workspace, 'node_modules/.bin'), { recursive: true });
    fs.writeFileSync(path.join(workspace, 'package.json'), JSON.stringify({ name: 'unrelated-project' }));
    fs.writeFileSync(path.join(workspace, 'runner/mcp/server.ts'), 'throw new Error("must not run");');
    fs.writeFileSync(path.join(workspace, 'node_modules/.bin/tsx'), '#!/bin/sh\nprintf wrongly-started');
    fs.chmodSync(path.join(workspace, 'node_modules/.bin/tsx'), 0o755);
    const result = spawnSync(path.join(root, 'plugins/codex/checkin/bin/start-mcp'), { env: { ...process.env, CHECKIN_WORKSPACE: workspace }, encoding: 'utf8' });
    assert.equal(result.status, 64);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /checkin-platform/);
  } finally { fs.rmSync(workspace, { recursive: true, force: true }); }
});
