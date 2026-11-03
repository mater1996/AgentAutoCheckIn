import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';

const source = path.resolve(import.meta.dirname, '../plugin-source/skills');
const read = (name: string) => fs.readFileSync(path.join(source, name, 'SKILL.md'), 'utf8');

test('shared skills have discoverable metadata and enforce the retained attempt and authentication boundaries', () => {
  assert.deepEqual(fs.readdirSync(source).sort(), ['explore-and-review', 'run-activity']);
  for (const name of fs.readdirSync(source)) {
    const text = read(name);
    const match = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]+)$/);
    assert.ok(match, `${name} frontmatter`);
    const data = parse(match[1]);
    assert.equal(data.name, name);
    assert.ok(data.description.length <= 60);
    assert.match(text, /at most one attempt/);
    assert.match(text, /restart.*never resets|restarting never resets/i);
    for (const gate of ['login', 'CAPTCHA', 'real-name verification', 'credentials', 'verification codes']) assert.ok(text.includes(gate), `${name}: ${gate}`);
    assert.match(text, /invitation, spending and game tasks/i);
    for (const term of ['purchase', 'add to cart', 'withdraw', 'switch accounts', 'cross-app']) assert.ok(text.includes(term), `${name}: ${term}`);
    assert.ok(text.includes('structuredContent'));
  }
});

test('runtime only writes execution records; review defaults to device-free draft delivery', () => {
  const run = read('run-activity');
  assert.match(run, /do not modify plugin files, Skills, scripts, configuration, or long-term knowledge/i);
  assert.match(run, /finish_activity/);
  assert.match(run, /issues, recoveries and benefits/);
  const review = read('explore-and-review');
  assert.match(review, /default mode is `review`/);
  assert.match(review, /scope: activity \| task/);
  assert.match(review, /mode: review \| explore \| review-and-explore/);
  assert.match(review, /require explicit authorization/);
  assert.match(review, /Do not call `begin_execution`, `observe`, `execute_recipe`, `submit_decision`, `act` or `recover`/);
  assert.match(review, /status: draft/);
  assert.match(review, /do not edit\/publish plugin, Skill, script, config or long-term knowledge/);
  for (const text of [run, review]) assert.match(text, /references\/mcp-contract\.md/);
  const contract = fs.readFileSync(path.resolve(source, '../references/mcp-contract.md'), 'utf8');
  for (const term of ['find-next-task', 'decisionId', 'configFile', 'frameId', 'execute-task', 'hostSessionId']) assert.ok(contract.includes(term));
});
