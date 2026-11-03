import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import Database from 'better-sqlite3';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const root = path.resolve(import.meta.dirname, '..');
const names = ['get_activity_context', 'list_recipes', 'begin_execution', 'observe', 'execute_recipe', 'submit_decision', 'act', 'recover', 'cancel_execution', 'get_run_state', 'finish_activity', 'review_execution'].sort();

test('both packaged launchers expose the actual MCP schemas with device access disabled', async () => {
  const workspace = fs.mkdtempSync(path.join(process.env.TMPDIR ?? os.tmpdir(), 'checkin-mcp-client-'));
  try {
    fs.mkdirSync(path.join(workspace, 'data'));
    new Database(path.join(workspace, 'data/checkin.db')).close();
    fs.writeFileSync(path.join(workspace, 'package.json'), JSON.stringify({ name: 'checkin-platform', type: 'module' }));
    fs.mkdirSync(path.join(workspace, 'runner/mcp'), { recursive: true });
    fs.copyFileSync(path.join(root, 'runner/mcp/server.ts'), path.join(workspace, 'runner/mcp/server.ts'));
    fs.symlinkSync(path.join(root, 'runner/mcp/service.ts'), path.join(workspace, 'runner/mcp/service.ts'));
    fs.symlinkSync(path.join(root, 'node_modules'), path.join(workspace, 'node_modules'), 'dir');
    const dir = path.join(workspace, 'evidence/offline-review');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ id: 'offline-review', scope: { activityId: 'offline' }, tasks: [] }));
    fs.writeFileSync(path.join(dir, 'summary.json'), JSON.stringify({ status: 'stopped', tasks: [], gainCoins: null }));
    for (const host of ['claude', 'codex']) {
      const transport = new StdioClientTransport({ command: path.join(root, 'plugins', host, 'checkin/bin/start-mcp'), env: { PATH: process.env.PATH!, CHECKIN_WORKSPACE: workspace, CHECKIN_ALLOW_DEVICE: '0', CHECKIN_ALLOW_RESTART: '0' }, stderr: 'pipe' });
      const client = new Client({ name: 'checkin-packaging-contract', version: '0.1.0' });
      let diagnostics = '';
      transport.stderr?.on('data', (chunk) => { diagnostics += chunk.toString(); });
      try {
        try { await client.connect(transport); } catch (error) { throw new Error(`${String(error)}\n${diagnostics}`); }
        const inventory = await client.listTools();
        assert.deepEqual(inventory.tools.map((t) => t.name).sort(), names);
        assert.deepEqual(inventory.tools.find((t) => t.name === 'review_execution')!.inputSchema.properties!.scope.enum, ['activity', 'task']);
        assert.ok(inventory.tools.find((t) => t.name === 'begin_execution')!.inputSchema.required!.includes('live'));
        const recipes = await client.callTool({ name: 'list_recipes', arguments: {} });
        assert.equal(recipes.isError, undefined);
        assert.equal(recipes.structuredContent, undefined);
        assert.equal(recipes.content[0].type, 'text');
        const review = await client.callTool({ name: 'review_execution', arguments: { executionId: 'offline-review', scope: 'activity' } });
        assert.equal(review.isError, undefined);
        const payload = JSON.parse((review.content[0] as { text: string }).text);
        assert.equal(payload.readOnly, true);
        assert.equal(payload.executionId, 'offline-review');
        assert.equal(payload.summary.gainCoins, null, 'unknown benefits stay unknown');
        assert.equal(fs.existsSync(path.join(workspace, 'data/backups')), false, 'review must not begin an execution');
        const missingAttempt = await client.callTool({ name: 'review_execution', arguments: { executionId: 'offline-review', scope: 'task' } });
        assert.equal(missingAttempt.isError, true);
        assert.match((missingAttempt.content[0] as { text: string }).text, /attempt|identifier/i);
        const begin = await client.callTool({ name: 'begin_execution', arguments: { configFile: 'not-a-config.json', live: true } });
        assert.equal(begin.isError, true);
        assert.match((begin.content[0] as { text: string }).text, /Device access not enabled/);
        const observe = await client.callTool({ name: 'observe', arguments: {} });
        assert.equal(observe.isError, true);
        assert.match((observe.content[0] as { text: string }).text, /No active execution/);
      } finally { await client.close(); }
    }
    assert.equal(fs.existsSync(path.join(root, 'plugins/codex/checkin/data/checkin.db')), false);
    assert.equal(fs.existsSync(path.join(root, 'plugins/claude/checkin/data/checkin.db')), false);
  } finally { fs.rmSync(workspace, { recursive: true, force: true }); }
});
