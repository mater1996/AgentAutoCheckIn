#!/usr/bin/env python3
"""Offline host plugin load validation. No prompt, turn/start or device opt-in."""
import json
import os
from pathlib import Path
import selectors
import shutil
import subprocess
import time

ROOT = Path(__file__).resolve().parent
PROJECT = ROOT.parent.parent
CODEX = ROOT / 'tools/codex/package/vendor/aarch64-apple-darwin/bin/codex'
CLAUDE = ROOT / 'tools/claude/package/claude'
RESULTS = []
for directory in ['home', 'codex-home', 'claude-home', 'offline-workspace/data', 'offline-workspace/runner/mcp']:
    (ROOT / directory).mkdir(parents=True, exist_ok=True)
WORKSPACE = ROOT / 'offline-workspace'
(WORKSPACE / 'package.json').write_text(json.dumps({'name': 'checkin-platform', 'type': 'module'}))
shutil.copyfile(PROJECT / 'runner/mcp/server.ts', WORKSPACE / 'runner/mcp/server.ts')
for name, target in [('node_modules', PROJECT / 'node_modules'), ('runner/mcp/service.ts', PROJECT / 'runner/mcp/service.ts')]:
    link = WORKSPACE / name
    if not link.exists():
        link.symlink_to(target)
subprocess.run(['node', '-e', 'const D=require("better-sqlite3");new D(process.argv[1]).close()', str(WORKSPACE / 'data/checkin.db')], cwd=PROJECT, check=True)
ENV = {key: value for key, value in os.environ.items() if key in ['PATH', 'TMPDIR', 'LANG']}
ENV.update(HOME=str(ROOT / 'home'), CODEX_HOME=str(ROOT / 'codex-home'), CLAUDE_CONFIG_DIR=str(ROOT / 'claude-home'), CHECKIN_WORKSPACE=str(WORKSPACE), CHECKIN_ALLOW_DEVICE='0', CHECKIN_ALLOW_RESTART='0', DISABLE_TELEMETRY='1', DISABLE_ERROR_REPORTING='1')


def cli(host, args):
    result = subprocess.run([str(CODEX if host == 'codex' else CLAUDE), *args], cwd=PROJECT, env=ENV, text=True, capture_output=True, timeout=25)
    entry = dict(host=host, args=args, status=result.returncode, stdout=result.stdout, stderr=result.stderr)
    RESULTS.append(entry)
    assert result.returncode == 0, entry
    return result.stdout


try:
    for host in ['codex', 'claude']:
        cli(host, ['--version'])
    cli('codex', ['plugin', 'marketplace', 'add', '.', '--json'])
    prior = json.loads(cli('codex', ['plugin', 'list', '--marketplace', 'checkin-local', '--json']))
    if any(item.get('pluginId') == 'checkin@checkin-local' for item in prior['installed']):
        cli('codex', ['plugin', 'remove', 'checkin@checkin-local'])
    cli('codex', ['plugin', 'add', 'checkin@checkin-local'])
    installed = json.loads(cli('codex', ['plugin', 'list', '--marketplace', 'checkin-local', '--json']))
    assert installed['installed'][0]['enabled']
    cli('claude', ['plugin', 'validate', 'plugins/claude/checkin', '--strict', '--json'])
    cli('claude', ['plugin', 'marketplace', 'add', str(PROJECT / 'plugins/claude'), '--json'])
    cli('claude', ['plugin', 'install', 'checkin@checkin-local'])
    assert json.loads(cli('claude', ['plugin', 'list', '--json']))[0]['enabled']
    details = cli('claude', ['plugin', 'details', 'checkin@checkin-local'])
    assert 'Skills (2)' in details and 'MCP servers (1)' in details
    assert 'Connected' in cli('claude', ['mcp', 'list'])
    process = subprocess.Popen([str(CODEX), 'app-server', '--stdio'], cwd=PROJECT, env=ENV, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    selector = selectors.DefaultSelector()
    selector.register(process.stdout, selectors.EVENT_READ)
    buffer = b''

    def request(identifier, method, params):
        global buffer
        process.stdin.write((json.dumps(dict(id=identifier, method=method, params=params)) + '\n').encode())
        process.stdin.flush()
        deadline = time.monotonic() + 25
        while time.monotonic() < deadline:
            if b'\n' not in buffer:
                if not selector.select(timeout=1):
                    continue
                chunk = os.read(process.stdout.fileno(), 65536)
                assert chunk, 'app-server closed stdout'
                buffer += chunk
            while b'\n' in buffer:
                line, buffer = buffer.split(b'\n', 1)
                value = json.loads(line)
                RESULTS.append(dict(host='codex-app-server', message=value))
                if value.get('id') == identifier:
                    assert 'error' not in value, value
                    return value['result']
        raise TimeoutError(method)

    try:
        request(1, 'initialize', {'clientInfo': {'name': 'checkin-plugin-validation', 'version': '0.1.0'}, 'capabilities': {'experimentalApi': True}})
        process.stdin.write(b'{"method":"initialized"}\n')
        process.stdin.flush()
        skills = request(2, 'skills/list', {'cwds': [str(PROJECT)], 'forceReload': True})
        names = sorted(item['name'] for group in skills['data'] for item in group['skills'] if item.get('pluginId') == 'checkin@checkin-local')
        assert names == ['checkin:explore-and-review', 'checkin:run-activity'], names
        plugin = request(3, 'plugin/read', {'marketplacePath': str(PROJECT / '.agents/plugins/marketplace.json'), 'pluginName': 'checkin'})
        assert plugin['plugin']['mcpServers'] == ['checkin']
        status = request(4, 'mcpServerStatus/list', {})
        server = next(item for item in status['data'] if item.get('pluginId') == 'checkin@checkin-local')
        assert server['toolsError'] is None and len(server['tools']) == 12, server
    finally:
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
        RESULTS.append(dict(host='codex-app-server', stderr=process.stderr.read().decode()))
    print('PASS: Claude/Codex install, two skills, MCP connection, 12 tools; no model or device calls.')
finally:
    (ROOT / 'host-validation.json').write_text(json.dumps(RESULTS, indent=2) + '\n')
