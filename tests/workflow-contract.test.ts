import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';

test('offline CLI prints validation JSON and exits nonzero for invalid YAML', async () => {
  for (const [source, status] of [
    ['cases:\n  - name: cli\n    steps:\n      - tapRow: { text: 当前任务 }\n', 0],
    ['cases:\n  - name: cli\n    steps:\n      - tapRow: { index: 1 }\n', 1],
  ] as const) {
    const result = await withYaml(source, (file) => spawnSync(process.execPath, ['--import', 'tsx', 'runner/workflow.ts', '--validate', file], { encoding: 'utf8' }));
    assert.equal(result.status, status, result.stderr);
    assert.equal(JSON.parse(result.stdout).ok, status === 0);
  }
});
import * as workflow from '../runner/workflow';
import * as generator from '../runner/workflow-gen';
import { parse } from 'yaml';

test('generator accepts current observed task text without inventing missing coordinates', async () => {
  const yaml = generator.generateTaskYaml({ account: 'offline', activity: 'fixture', taskName: '当前任务', kind: 'browse' });
  assert.match(yaml, /坐标：未采集/);
  assert.doesNotMatch(yaml, /像素 \(540, 1200\)/);
  assert.equal((await withYaml(yaml, workflow.validateWorkflowFile)).ok, true);
});

test('generator preserves special task text and every task kind passes offline schemas', async () => {
  assert.equal(typeof generator.generateTaskYaml, 'function', 'pure generator must be exported');
  const taskName = '当前: "任务" # & [动态]';
  for (const kind of ['browse', 'miniapp', 'search', 'camera', 'crossapp', 'unknown'] as const) {
    const yaml = generator.generateTaskYaml({ account: 'offline', activity: 'fixture', taskName, kind, at: [0.9, 0.5], keyword: '衣服: #蓝色' });
    const parsed = parse(yaml);
    assert.equal(parsed.cases[0].steps[0].tapRow.text, taskName);
    assert.equal(parsed.cases[0].name, `完成「${taskName}」`);
    const result = await withYaml(yaml, workflow.validateWorkflowFile);
    assert.equal(result.ok, true, `${kind}: ${result.error}`);
  }
});
import config from '../midscene.config';
import { CaseRunner, defineNode, z, type CaseRunResult } from '@midscene/test';

test('CLI and workflow use the same registered node definitions', () => {
  const expected = workflow.buildNodes();
  assert.deepEqual(config.nodes!.map((n) => n.name), expected.map((n) => n.name));
  assert.equal(config.nodes!.find((n) => n.name === 'tapRow'), expected.find((n) => n.name === 'tapRow'));
});

test('official CaseRunner output is checked for overall status, empty steps and orchestration errors', async () => {
  assert.equal(typeof workflow.workflowResultFromCaseRun, 'function', 'typed result adapter must be exported');
  const runner = new CaseRunner({ nodes: [defineNode({ name: 'offline', inputSchema: z.strictObject({}), execute: () => ({ summary: 'offline success' }) })] });
  const actual = await runner.run({ name: 'offline', steps: [{ offline: {} }] });
  assert.equal(actual.status, 'success');
  assert.equal(workflow.workflowResultFromCaseRun(actual, 1).ok, true);
  assert.equal(workflow.workflowResultFromCaseRun({ ...actual, status: 'failed' }, 1).ok, false);
  assert.equal(workflow.workflowResultFromCaseRun({ ...actual, steps: [] }, 1).ok, false);
  assert.equal(workflow.workflowResultFromCaseRun(actual, 2).ok, false);
  assert.equal(workflow.workflowResultFromCaseRun({ ...actual, executionStatus: 'not-run' }, 1).ok, false);
  assert.equal(workflow.workflowResultFromCaseRun({ ...actual, teardownErrors: [new Error('cleanup failed')] } as CaseRunResult, 1).ok, false);
  assert.equal(workflow.workflowResultFromCaseRun({ ...actual, beforeEach: [{ ...actual.steps[0], status: 'failed', error: new Error('setup failed') }] } as CaseRunResult, 1).ok, false);
});

test('workflow runner applies offline validation before executing a case', async () => {
  const agent = { aiBoolean: () => { throw new Error('agent must never be called'); } } as any;
  const ctx = { serial: 'offline-no-device', screen: { w: 1080, h: 2400 } };
  const multi = 'cases:\n  - name: first\n    steps:\n      - wait: { duration: 1, unit: ms }\n  - name: second\n    steps:\n      - wait: { duration: 1, unit: ms }\n';
  const result = await withYaml(multi, (file) => workflow.runWorkflowFile(file, agent, ctx));
  assert.equal(result.ok, false, 'must reject extra cases instead of ignoring them');
  assert.match(result.error, /只能包含一个 case/);
  const valid = await withYaml('cases:\n  - name: offline wait\n    steps:\n      - wait: { duration: 1, unit: ms }\n', (file) => workflow.runWorkflowFile(file, agent, ctx));
  assert.equal(valid.ok, true, JSON.stringify(valid));
  assert.equal(valid.steps.length, 1);
});

async function withYaml(source: string, fn: (file: string) => any) {
  const dir = fs.mkdtempSync(path.join(process.env.TMPDIR ?? os.tmpdir(), 'workflow-contract-'));
  try {
    const file = path.join(dir, 'case.yaml');
    fs.writeFileSync(file, source);
    return await fn(file);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

test('offline validation rejects empty cases, unknown nodes and unsupported lifecycle hooks', async () => {
  for (const yaml of [
    'cases: []',
    'cases:\n  - name: empty\n    steps: []',
    'cases:\n  - name: unknown\n    steps:\n      - unregisteredNode: {}',
    'beforeEach:\n  - wait: { duration: 1, unit: ms }\ncases:\n  - name: lifecycle\n    steps:\n      - wait: { duration: 1, unit: ms }',
  ]) assert.equal((await withYaml(yaml, workflow.validateWorkflowFile)).ok, false, yaml);
});

test('offline validator resolves shared tapRow and validates its input without running nodes', async () => {
  assert.equal(typeof workflow.validateWorkflowFile, 'function', 'offline validator must be exported');
  const valid = await withYaml('cases:\n  - name: 当前任务\n    steps:\n      - tapRow: { text: 当前任务 }\n', workflow.validateWorkflowFile);
  assert.equal(valid.ok, true, JSON.stringify(valid));
  const invalid = await withYaml('cases:\n  - name: 当前任务\n    steps:\n      - tapRow: { index: 1 }\n', workflow.validateWorkflowFile);
  assert.equal(invalid.ok, false);
  assert.match(invalid.error, /tapRow/);
});
import * as row from '../runner/nodes/tap-row';
const { tapRow } = row;

function node(text: string, bounds: string, clickable = false, children = '') {
  return `<node text="" content-desc="${text}" bounds="${bounds}" clickable="${clickable}">${children}</node>`;
}
const panel = (extra = '') => `<hierarchy>${
  node('已做任务(1/1)', '[30,80][600,120]') + node('已完成', '[800,70][1000,130]', true) +
  node('当前任务(0/5)', '[30,180][600,220]') + node('去完成', '[800,170][1000,230]', true) +
  node('当前任务加长版(0/1)', '[30,280][600,320]') + node('去逛逛', '[800,270][1000,330]', true) + extra
}</hierarchy>`;

test('current exact task text binds its button after a completed row remains visible', () => {
  assert.equal(typeof row.selectTaskRowButton, 'function', 'pure XML selector must be exported');
  const result = row.selectTaskRowButton(panel(), { text: '当前任务' });
  assert.equal(result.label.text, '当前任务(0/5)');
  assert.deepEqual([result.button.cx, result.button.cy], [900, 200]);
});

test('tapRow accepts the task text observed for this run', () => {
  assert.equal(tapRow.inputSchema.safeParse({ text: '当前任务「好物」' }).success, true);
});

test('legacy index requires exact expectText and cannot coexist with text', () => {
  for (const input of [{}, { index: 1 }, { text: '当前任务', index: 1, expectText: '当前任务' }, { text: '当前任务', expectText: '其他' }]) {
    assert.equal(tapRow.inputSchema.safeParse(input).success, false, JSON.stringify(input));
  }
  assert.equal(tapRow.inputSchema.safeParse({ index: 1, expectText: '当前任务' }).success, true);
  assert.throws(() => row.selectTaskRowButton(panel(), { index: 1, expectText: '当前' }), /不符/);
  assert.throws(() => row.selectTaskRowButton(panel(), { index: 0, expectText: '当前任务' }), /不符/);
  assert.equal(row.selectTaskRowButton(panel(), { index: 1, expectText: '当前任务' }).button.cy, 200);
});

test('exact selection rejects missing, duplicate and completed task names', () => {
  assert.throws(() => row.selectTaskRowButton(panel(), { text: '当前' }), /匹配 0 行/);
  assert.throws(() => row.selectTaskRowButton(panel(node('当前任务(1/5)', '[30,380][600,420]')), { text: '当前任务' }), /匹配 2 行/);
  assert.throws(() => row.selectTaskRowButton(panel(), { text: '已做任务' }), /已完成/);
});

test('same-row binding refuses adjacent-row buttons and ambiguous controls', () => {
  const noOwnButton = panel().replace(node('去完成', '[800,170][1000,230]', true), '');
  assert.throws(() => row.selectTaskRowButton(noOwnButton, { text: '当前任务' }), /匹配 0 个/);
  const twoButtons = panel(node('去使用', '[650,170][750,230]', true));
  assert.throws(() => row.selectTaskRowButton(twoButtons, { text: '当前任务' }), /匹配 2 个/);
});

test('XML entities, fullwidth progress, and nonclickable child labels are supported', () => {
  const xml = `<hierarchy>${node('A&amp;B（0/5）', '[30,180][600,220]') +
    node('', '[800,170][1000,230]', true, node('去完成', '[830,180][970,220]'))}</hierarchy>`;
  assert.equal(row.selectTaskRowButton(xml, { text: 'A&B' }).button.cx, 900);
});
