import test from 'node:test';
import assert from 'node:assert/strict';
import {planRoundInventory, ROUND_PLANNER_PROMPT} from '../runner/staged/round-planner.ts';
import {taskIdentity, type RoundInventory} from '../runner/staged/round.ts';
const task = (name: string, instruction = '浏览商品5秒', done = 0, total = 2) => ({name, instruction, done, total, reward: 20, context: {visible: 'exact current row'}});
const inv = (tasks = [task('游戏频道普通浏览')]): RoundInventory => ({complete: true, pages: [{frameId: 'synthetic-only', top: true, bottom: true}], tasks});
const choice = (t = task('游戏频道普通浏览'), extra = {}) => ({name: t.name, instruction: t.instruction, decision: 'do', times: 2, reason: '完整说明为普通浏览，已有路线', actionType: 'browse', category: 'ordinary-in-app', routeSupported: true, stopConditions: ['unknown input', 'login or authorization', 'return unverified'], ...extra});
const browseCfg = {learnedBrowse: {enabled: true, version: 'continuous-browse-candidate-v1', sourceRunId: 153}, aiTaskRecovery: true, aiPanelReader: true, scriptValidationMode: false};

test('prompt gives concrete executable action types and local route ownership rules', () => {
  assert.ok(ROUND_PLANNER_PROMPT.includes('browse|dwell-browse|continuous-browse|panel-claim|shop-browse|search-browse|quiz|home-revisit|none'));
  assert.match(ROUND_PLANNER_PROMPT, /immersive-browse/);
  assert.match(ROUND_PLANNER_PROMPT, /exactSkips/);
});

test('ordinary browse aliases remain executable through the actual learned recovery configuration', async () => {
  for (const actionType of ['browse', 'ordinary-browse', 'dwell-browse', 'continuous-browse', 'Ordinary_Browse', 'CONTINUOUS BROWSE']) {
    const result = await planRoundInventory({inventory: inv(), cfg: browseCfg,
      model: {query: async () => ({items: [choice(undefined, {actionType})]})}});
    assert.equal(result.items[0].decision, 'do', actionType);
    assert.equal(result.items[0].routeSupported, true);
    assert.equal(result.items[0].actionType, actionType);
  }
});

test('prior explicit skips match exact identity and ordinary prior skip decisions do not block new work', async () => {
  const t = task('仍可浏览');
  const result = await planRoundInventory({inventory: inv([t]), cfg: {...browseCfg, round: {exactSkips: [t.name + '扩展', {name: t.name, instruction: '另一说明'}]}},
    priorPlans: [{path: 'old.json', plan: {items: [{...t, decision: 'skip', times: 0}, {...t, instruction: '旧说明', userSkip: true}]}}],
    policy: {userSkips: [{name: t.name + '扩展', instruction: t.instruction}]},
    model: {query: async () => ({items: [choice(t)]})}});
  assert.equal(result.items[0].decision, 'do');
});

const routeTask = task('已配置任务');
const exactRoutes = [
  ...['search-browse', 'quiz', 'home-revisit'].map(type => ({actionType: type, cfg: {interactionRoutes: [{type, task: routeTask}]}})),
  ...['panel-claim', 'shop-browse'].map(family => ({actionType: family, cfg: {controllerCandidates: [{family, task: routeTask}]}})),
  {actionType: 'dwell-browse', cfg: {dwellBrowse: {version: 'dwell-browse-candidate-v1', contracts: [{task: routeTask, dwellMs: 5000}]}}},
  {actionType: 'immersive-browse', cfg: {immersiveBrowse: {enabled: true, version: 'immersive-browse-candidate-v2', sourceRunId: 145, task: routeTask}}},
];
for (const {actionType, cfg} of exactRoutes) test(`configured ${actionType} supports only its exact task and action type`, async () => {
  for (const [t, action, expected] of [
    [routeTask, actionType, 'do'],
    [task('未配置任务'), actionType, 'pending'],
    [task(routeTask.name, '同名不同说明'), actionType, 'pending'],
    [routeTask, 'invented-route', 'pending'],
    [routeTask, actionType === 'dwell-browse' ? 'quiz' : 'dwell-browse', 'pending'],
  ] as const) {
    const result = await planRoundInventory({inventory: inv([t]), cfg,
      model: {query: async () => ({items: [choice(t, {actionType: action})]})}});
    assert.equal(result.items[0].decision, expected, JSON.stringify({t, action}));
    assert.equal(result.items[0].routeSupported, expected === 'do');
    assert.equal(result.items[0].times, expected === 'do' ? 2 : 0);
  }
});

test('exact route ownership prevents generic browse from overriding the configured executor', async () => {
  for (const {actionType, cfg} of exactRoutes) {
    const result = await planRoundInventory({inventory: inv([routeTask]), cfg: {...browseCfg, ...cfg},
      model: {query: async () => ({items: [choice(routeTask, {actionType: 'browse'})]})}});
    assert.equal(result.items[0].decision, 'pending', actionType);
    assert.equal(result.items[0].routeSupported, false);
  }
});

test('model routeSupported cannot authorize a missing route or an arbitrary action type', async () => {
  const t = task('全新任务');
  const cases = [
    {cfg: {}, actionType: 'browse'},
    {cfg: browseCfg, actionType: 'search-browse'},
    {cfg: browseCfg, actionType: 'quiz'},
    {cfg: browseCfg, actionType: 'invented-browse'},
    {cfg: browseCfg, actionType: 'arbitrary'},
    {cfg: {...browseCfg, aiTaskRecovery: false}, actionType: 'browse'},
    {cfg: {...browseCfg, aiPanelReader: false}, actionType: 'browse'},
    {cfg: {...browseCfg, scriptValidationMode: true}, actionType: 'browse'},
    {cfg: {...browseCfg, learnedBrowse: {...browseCfg.learnedBrowse, sourceRunId: 999}}, actionType: 'browse'},
    {cfg: {...browseCfg, learnedBrowse: {...browseCfg.learnedBrowse, enabled: false}}, actionType: 'browse'},
    {cfg: {interactionRoutes: [{type: 'invented-route', task: t}]}, actionType: 'invented-route'},
    {cfg: {controllerCandidates: [{family: 'invented-controller', task: t}]}, actionType: 'invented-controller'},
    {cfg: {immersiveBrowse: {enabled: false, version: 'immersive-browse-candidate-v2', sourceRunId: 145, task: t}}, actionType: 'immersive-browse'},
    {cfg: {interactionRoutes: [{type: 'quiz', task: t}, {type: 'search-browse', task: t}]}, actionType: 'quiz'},
    {cfg: browseCfg, actionType: 'none'},
  ];
  for (const {cfg, actionType} of cases) {
    const response = {items: [choice(t, {actionType})]};
    const result = await planRoundInventory({inventory: inv([t]), cfg, model: {query: async () => response}});
    assert.equal(result.items[0].decision, 'pending', JSON.stringify({cfg, actionType}));
    assert.equal(result.items[0].times, 0);
    assert.equal(result.items[0].routeSupported, false);
    assert.deepEqual(result.modelResponse, response);
  }
});

test('explicit user skips from config, prior plan files and policy override model authorization', async () => {
  const t = task('用户排除的普通任务');
  const sources = [
    {cfg: {round: {exactSkips: [t.name]}}},
    {cfg: {round: {exactSkips: [{name: t.name}]}}},
    {cfg: {round: {exactSkips: [{name: t.name, instruction: t.instruction}]}}},
    {priorPlans: [{path: 'prior.json', plan: {items: [{...t, userSkip: true, decision: 'skip'}]}}]},
    {priorPlans: [{path: 'prior.json', plan: {tasks: [{...t, userSkip: true}]}}]},
    {policy: {userSkips: [{name: t.name, instruction: t.instruction}]}},
  ];
  for (const source of sources) {
    const response = {items: [choice(t, {userSkip: false})]};
    const result = await planRoundInventory({inventory: inv([t]), ...source, cfg: {...browseCfg, ...source.cfg},
      model: {query: async () => response}});
    assert.equal(result.items[0].decision, 'skip', JSON.stringify(source));
    assert.equal(result.items[0].times, 0);
    assert.equal(result.items[0].userSkip, true);
    assert.match(result.items[0].reason, /explicit user skip/);
    assert.deepEqual(result.modelResponse, response);
  }
});

test('planner queries full evidence and routes/history, covers every row, and orders by inventory', async () => {
  const tasks = [task('游戏频道普通浏览'), task('另一行')], inventory = inv(tasks);
  let request: any;
  const cfg = browseCfg, priorPlans = [{items: [], do: 0}], knowledge = [{runId: 8}], policy = {scope: 'same-app'};
  const result = await planRoundInventory({inventory, cfg, priorPlans, knowledge, attempts: [], policy,
    model: {query: async r => {request = r; return {items: tasks.toReversed().map(t => choice(t))};}},
  });
  assert.deepEqual(request.context.inventory, inventory);
  assert.deepEqual(request.context.cfg, cfg);
  assert.deepEqual(request.context.priorPlans, priorPlans);
  assert.deepEqual(request.context.knowledge, knowledge);
  assert.deepEqual(request.context.policy, policy);
  assert.match(request.prompt, /完整|full/);
  assert.deepEqual(result.items.map(t => t.name), tasks.map(t => t.name));
  assert.equal(result.items[0].decision, 'do', 'the game word in a title is not game behavior');
  assert.equal(result.items[0].times, 2);
  assert.deepEqual(result.items[0].stopConditions, choice().stopConditions);
});

test('exact exclusions and model-assessed actual restricted behavior cannot authorize execution', async () => {
  const names = ['玩消消乐领金币', '养小羊免费赚话费', '普通标题一', '普通标题二', '普通标题三', '普通标题四', '普通标题五', '普通标题六', '普通标题七', '普通标题八'];
  const categories = ['ordinary-in-app', 'ordinary-in-app', 'invite', 'spending', 'game', 'cross-app', 'auth', 'install', 'phone', 'camera'];
  const tasks = names.map(name => task(name));
  const result = await planRoundInventory({inventory: inv(tasks), cfg: {}, model: {query: async () => ({items: tasks.map((t, i) => choice(t, {category: categories[i]}))})}});
  assert.deepEqual(result.items.map(t => t.decision), names.map(() => 'skip'));
  assert.ok(result.items.every(t => t.times === 0));
});

for (const [label, response] of [
  ['missing row', {items: []}],
  ['duplicate row', {items: [choice(), choice()]}],
  ['extra identity', {items: [choice(), choice(task('invented'))]}],
  ['unknown decision', {items: [choice(undefined, {decision: 'maybe'})]}],
  ['fractional times', {items: [choice(undefined, {times: 1.5})]}],
  ['missing stop conditions', {items: [choice(undefined, {stopConditions: undefined})]}],
] as const) test(`invalid model plan rejects before authorization: ${label}`, async () => {
  await assert.rejects(() => planRoundInventory({inventory: inv(), cfg: {}, model: {query: async () => response}}));
});

test('unsupported routes and unknown business requirements remain pending', async () => {
  const tasks = [task('unsupported'), task('unknown')];
  const result = await planRoundInventory({inventory: inv(tasks), cfg: {}, model: {query: async () => ({items: [choice(tasks[0], {routeSupported: false}), choice(tasks[1], {category: 'unknown'})]})}});
  assert.deepEqual(result.items.map(t => [t.decision, t.times]), [['pending', 0], ['pending', 0]]);
});

test('planner binds current quotas and preserves raw response for persisted revision evidence', async () => {
  const t = task('quota', '浏览5秒', 1, 2), response = {items: [choice(t, {times: 50, done: 0, total: 99})]};
  const result = await planRoundInventory({inventory: inv([t]), cfg: browseCfg, model: {query: async () => response}});
  assert.equal(result.items[0].times, 1);
  assert.equal(result.items[0].done, 1);
  assert.equal(result.items[0].total, 2);
  assert.deepEqual(result.modelResponse, response);
});

test('planner refuses incomplete inventory before calling the model', async () => {
  let calls = 0;
  await assert.rejects(() => planRoundInventory({inventory: {...inv(), complete: false}, cfg: {}, model: {query: async () => {calls++; return {items: [choice()]};}}}));
  assert.equal(calls, 0);
});

test('existing consumed and reserved identities cannot be reauthorized even with changed quota', async () => {
  const tasks = [task('consumed'), task('reserved'), task('new')];
  const attempts = tasks.slice(0, 2).map((t, i) => ({name: t.name, instruction: t.instruction, identity: taskIdentity(t), reservationId: String(i), status: i ? 'reserved' as const : 'consumed' as const, evidenceKey: 'prior'}));
  const result = await planRoundInventory({inventory: inv(tasks), cfg: browseCfg, priorPlans: [{do: 0}], attempts, model: {query: async () => ({items: tasks.map(t => choice(t))})}});
  assert.deepEqual(result.items.map(t => t.decision), ['skip', 'pending', 'do']);
});
