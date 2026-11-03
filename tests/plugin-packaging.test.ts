import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = fs.mkdtempSync(path.join(process.env.TMPDIR ?? os.tmpdir(), 'checkin-plugin-build-'));
test.after(() => fs.rmSync(output, { recursive: true, force: true }));
const skills = ['explore-and-review', 'run-activity'];
const build = () => spawnSync(process.execPath, ['--import', 'tsx', 'scripts/build-plugins.ts', '--output-root', output], { cwd: root, encoding: 'utf8' });

test('build emits installable Claude/Codex packages from exactly two shared skills', () => {
  const result = build();
  assert.equal(result.status, 0, result.stderr);
  for (const host of ['claude', 'codex']) {
    const dir = path.join(output, 'plugins', host, 'checkin');
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, `.${host}-plugin/plugin.json`), 'utf8'));
    assert.equal(manifest.name, 'checkin');
    assert.equal(manifest.skills, './skills/');
    assert.equal(manifest.mcpServers, './.mcp.json');
    assert.deepEqual(fs.readdirSync(path.join(dir, 'skills')).sort(), skills);
    for (const skill of skills) assert.equal(fs.readFileSync(path.join(dir, 'skills', skill, 'SKILL.md'), 'utf8'), fs.readFileSync(path.join(root, 'plugin-source/skills', skill, 'SKILL.md'), 'utf8'));
    assert.equal(fs.existsSync(path.join(dir, 'plugin.json')), false, 'do not mix portable and compatible manifests');
    assert.equal(fs.existsSync(path.join(dir, 'mcp.json')), false);
    assert.ok(fs.statSync(path.join(dir, 'bin/start-mcp')).mode & 0o111);
    const config = JSON.parse(fs.readFileSync(path.join(dir, '.mcp.json'), 'utf8'));
    assert.deepEqual(Object.keys(config.mcpServers), ['checkin']);
    const server = config.mcpServers.checkin;
    assert.equal(server.command, host === 'claude' ? '${CLAUDE_PLUGIN_ROOT}/bin/start-mcp' : './bin/start-mcp');
    assert.deepEqual(server.args, []);
    assert.equal(server.type, 'stdio');
    if (host === 'claude') assert.deepEqual(server.env, { CHECKIN_WORKSPACE: '${CHECKIN_WORKSPACE}' });
    else {
      assert.equal(server.cwd, '.');
      assert.deepEqual(server.env_vars, ['CHECKIN_WORKSPACE', 'CHECKIN_ALLOW_DEVICE', 'CHECKIN_ALLOW_RESTART']);
      assert.equal(server.env, undefined, 'legacy Codex does not expand arbitrary env placeholders');
    }
    assert.equal(fs.existsSync(path.join(dir, 'README.md')), true, 'package setup and limitations ship with the plugin');
    assert.deepEqual(manifest.author, { name: 'checkin-platform' });
    assert.equal(fs.readFileSync(path.join(dir, 'references/mcp-contract.md'), 'utf8'), fs.readFileSync(path.join(root, 'plugin-source/references/mcp-contract.md'), 'utf8'));
    assert.equal(fs.existsSync(path.join(dir, 'verification')), false);
    assert.equal(fs.existsSync(path.join(dir, 'data')), false);
  }
});

test('rebuild cleans obsolete skills and keeps package bytes repeatable', () => {
  const obsolete = path.join(output, 'plugins/codex/checkin/skills/obsolete/SKILL.md');
  fs.mkdirSync(path.dirname(obsolete), { recursive: true });
  fs.writeFileSync(obsolete, 'obsolete');
  assert.equal(build().status, 0);
  assert.equal(fs.existsSync(obsolete), false);
  const snapshot = () => fs.readdirSync(path.join(output, 'plugins'), { recursive: true }).map(String).filter((entry) => fs.statSync(path.join(output, 'plugins', entry)).isFile()).sort().map((entry) => [entry, fs.readFileSync(path.join(output, 'plugins', entry), 'utf8')]);
  const previous = snapshot();
  assert.equal(build().status, 0);
  assert.deepEqual(snapshot(), previous);
});
