import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(root, 'plugin-source');
const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--output-root')) throw new Error('Usage: build-plugins.ts [--output-root DIRECTORY]');
const outputRoot = args.length ? path.resolve(args[1]) : root;
const skillNames = ['explore-and-review', 'run-activity'];
const actual = fs.readdirSync(path.join(source, 'skills')).sort();
if (JSON.stringify(actual) !== JSON.stringify(skillNames)) throw new Error('Expected exactly explore-and-review and run-activity in shared skill source');
for (const host of ['claude', 'codex'] as const) {
  const output = path.join(outputRoot, 'plugins', host, 'checkin');
  fs.rmSync(output, { recursive: true, force: true });
  fs.mkdirSync(path.join(output, `.${host}-plugin`), { recursive: true });
  const manifest = { name: 'checkin', version: '0.1.0', author: { name: 'checkin-platform' }, description: 'Evidence-based check-in activity execution and scoped draft review.', skills: './skills/', mcpServers: './.mcp.json' };
  const server = host === 'claude'
    ? { type: 'stdio', command: '${CLAUDE_PLUGIN_ROOT}/bin/start-mcp', args: [], env: { CHECKIN_WORKSPACE: '${CHECKIN_WORKSPACE}' } }
    : { type: 'stdio', command: './bin/start-mcp', args: [], cwd: '.', env_vars: ['CHECKIN_WORKSPACE', 'CHECKIN_ALLOW_DEVICE', 'CHECKIN_ALLOW_RESTART'] };
  const mcp = { mcpServers: { checkin: server } };
  fs.writeFileSync(path.join(output, `.${host}-plugin/plugin.json`), JSON.stringify(manifest, null, 2) + '\n');
  fs.writeFileSync(path.join(output, '.mcp.json'), JSON.stringify(mcp, null, 2) + '\n');
  fs.cpSync(path.join(source, 'skills'), path.join(output, 'skills'), { recursive: true });
  fs.copyFileSync(path.join(source, 'README.md'), path.join(output, 'README.md'));
  fs.cpSync(path.join(source, 'references'), path.join(output, 'references'), { recursive: true });
  fs.mkdirSync(path.join(output, 'bin'));
  fs.copyFileSync(path.join(source, 'bin/start-mcp'), path.join(output, 'bin/start-mcp'));
  fs.chmodSync(path.join(output, 'bin/start-mcp'), 0o755);
  const marketplaceDir = path.join(outputRoot, 'plugins', host, '.claude-plugin');
  if (host === 'claude') {
    fs.mkdirSync(marketplaceDir, { recursive: true });
    fs.writeFileSync(path.join(marketplaceDir, 'marketplace.json'), JSON.stringify({ name: 'checkin-local', owner: { name: 'checkin-platform' }, plugins: [{ name: 'checkin', source: './checkin', description: manifest.description, version: manifest.version }] }, null, 2) + '\n');
  }
}
const marketplaceDir = path.join(outputRoot, '.agents/plugins');
fs.mkdirSync(marketplaceDir, { recursive: true });
fs.writeFileSync(path.join(marketplaceDir, 'marketplace.json'), JSON.stringify({ name: 'checkin-local', plugins: [{ name: 'checkin', source: { source: 'local', path: './plugins/codex/checkin' }, policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' } }] }, null, 2) + '\n');
console.log('Built plugins/claude/checkin and plugins/codex/checkin from two shared skills.');
