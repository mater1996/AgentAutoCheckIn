/**
 * 任务 YAML 生成器：调用方显式提供任务类型，生成任务文本绑定的执行单元。
 *
 * 模板由本文件的 TEMPLATES 常量定义；writeTemplates 导出供人工参考，
 * 生成器当前不读取磁盘模板。任务名只用于身份精确匹配，不用于推断类型。
 * 坐标是可选的本次观测记录；点击时重新读取无障碍树并定位同行按钮。
 */
import fs from 'node:fs';
import path from 'node:path';

import type { TaskKind } from './planner';

const SCREEN = { w: 1080, h: 2400 };
const BOOK_ROOT = path.resolve('data/playbooks');

/** 坐标归一化 → 像素 */
function px(p: [number, number]): [number, number] {
  return [Math.round(p[0] * SCREEN.w), Math.round(p[1] * SCREEN.h)];
}

/** 类型模板常量；具体类型必须由调用方提供，不根据任务名猜测。 */
const TEMPLATES: Record<TaskKind, { dwell: number; search?: boolean; swipe?: boolean; note: string }> = {
  browse: { dwell: 12, swipe: true, note: '浏览类：停留 ≥12 秒，下滑一次模拟真实浏览' },
  miniapp: { dwell: 15, note: '小程序类：进入后停留 ≥15 秒再返回' },
  search: { dwell: 8, search: true, note: '搜索类：必须真的输入关键词并点搜索，只停留不算完成' },
  camera: { dwell: 10, note: '相机类：需要拍照搜图，风险较高' },
  crossapp: { dwell: 15, note: '跨 App：会跳到其他应用，prep 起始状态可能被破坏' },
  unknown: { dwell: 12, swipe: true, note: '未知类型：按浏览类保守处理' },
};

export interface GenInput {
  account: string;
  activity: string;
  taskName: string;
  kind: TaskKind;
  /** 可选的本次按钮观测坐标，仅作记录；tapRow 根据文本动态绑定同行按钮。 */
  at?: [number, number];
  /** 搜索类用的关键词 */
  keyword?: string;
}

export function generateTaskYaml(inp: GenInput): string {
  const tpl = TEMPLATES[inp.kind] ?? TEMPLATES.unknown;
  const observedButton = inp.at ? px(inp.at) : undefined;
  const [sx, sy] = px([0.463, 0.135]);
  const [bx, by] = px([0.896, 0.135]);

  const lines: string[] = [
    `# ${inp.taskName}`,
    '#',
    '# 这是资产，不是临时文件。agent 每次执行后可以改写它。',
    `# 类型：${inp.kind} —— ${tpl.note}`,
    `# 生成：${new Date().toISOString().slice(0, 10)} 来自 workflow-gen.ts 内置 ${inp.kind} 模板常量`,
    inp.at && observedButton
      ? `# 坐标：任务按钮 (${inp.at[0]}, ${inp.at[1]}) → 像素 (${observedButton[0]}, ${observedButton[1]})（仅作观测记录）`
      : '# 坐标：未采集；tapRow 按本次任务文本动态定位同行按钮',
    '#',
    '# 失败模式记录：',
    '#   - 点开后立刻返回 → 不计数',
    '#   - 停留不足规定秒数 → 不计数',
    '',
    'cases:',
    `  - name: ${JSON.stringify(`完成「${inp.taskName}」`)}`,
    '    steps:',
    '      # 按任务名找按钮点击：不依赖坐标。',
    '      # 面板第 1 行「任务到访得金币」完成后仍占位，导致按行号索引整体错位一格，',
    '      # 实测点「发现精选」会点到「拍立淘」。按名字查无障碍树不受顺序影响。',
    '      - tapRow:',
    `          text: ${JSON.stringify(inp.taskName)}`,
    '      - wait: { duration: 3, unit: s }',
  ];

  if (tpl.search) {
    const kw = inp.keyword ?? '女装';
    // 搜索类任务：实测点开后可能直接跳商品详情页，没有搜索框。
    // Midscene YAML 没有变量传递（issue #2215 至今 open），aiBoolean 的结果没法喂给后续步骤，
    // 所以这里用「先试着点搜索框，失败不报错」的容错写法：
    //   · 真有搜索框 → 点中 → 输入 → 点搜索 → 计数
    //   · 没有搜索框（商品页）→ 点击落空但 continueOnError 不中断 → 后续停留+返回也算浏览
    //
    // 代价：搜索框坐标点空会白点一次（0 成本，纯 adb），但不会让整轮失败。
    lines.push(
      '',
      '      # 搜索类：试着点搜索框。没有搜索框时点空但不中断（continueOnError）',
      '      - runAdbShell:',
      `          command: input tap ${sx} ${sy}`,
      '          $: { continue-on-error: true }',
      '      - wait: { duration: 1.5, unit: s }',
      '      - aiInput:',
      `          prompt: 顶部的搜索输入框`,
      `          value: ${JSON.stringify(kw)}`,
      '          $: { continue-on-error: true }',
      '      - wait: { duration: 1, unit: s }',
      '      - runAdbShell:',
      `          command: input tap ${bx} ${by}`,
      '          $: { continue-on-error: true }',
    );
  }

  lines.push(
    '',
    `      # 停留 ${tpl.dwell} 秒`,
    `      - wait: { duration: ${tpl.dwell}, unit: s }`,
  );

  if (tpl.swipe) {
    lines.push(
      '',
      '      # 下滑一次，模拟真实浏览',
      '      - runAdbShell:',
      '          command: input swipe 540 1680 540 720 400',
      '      - wait: { duration: 1, unit: s }',
    );
  }

  lines.push(
    '',
    '      # 回到任务面板：只按一次 back。',
    '      #',
    '      # 实测规律（2026-10-30）：',
    '      #   · 浏览类任务点进详情页后，back 一次 → 回到「任务面板」（不是游戏页）',
    '      #   · 再按一次 back 才会关掉面板回到双11游戏页',
    '      # 所以只能按一次。之前写成 back + tap「去赚金币」，',
    '      # 那个坐标在游戏页是空白处，拉不起面板，反而让探测读到 0/0（run #27）。',
    '      - back: {}',
    '      - wait: { duration: 2.5, unit: s }',
    '',
  );

  return lines.join('\n');
}

/** 任务 YAML 所在目录 */
export function taskDir(account: string, activity: string): string {
  return path.join(BOOK_ROOT, `${account}_${activity}`);
}

/** 找已存在的任务 YAML（按任务名） */
export function findTaskYaml(account: string, activity: string, taskName: string): string | null {
  const dir = taskDir(account, activity);
  for (const ext of ['.yaml', '.yml']) {
    const p = path.join(dir, `${taskName}${ext}`);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

/** 确保任务有 YAML：有就用，没有就从模板生成。返回路径。 */
export function ensureTaskYaml(inp: GenInput): string | null {
  const existing = findTaskYaml(inp.account, inp.activity, inp.taskName);
  if (existing) return existing;

  const dir = taskDir(inp.account, inp.activity);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${inp.taskName}.yaml`);
  try {
    fs.writeFileSync(file, generateTaskYaml(inp), 'utf8');
    return file;
  } catch {
    return null;
  }
}

/** 写类型模板文件（供人工 review 和 agent 归纳用） */
export function writeTemplates(account: string, activity: string): string[] {
  const dir = path.join(taskDir(account, activity), 'templates');
  fs.mkdirSync(dir, { recursive: true });
  const written: string[] = [];
  for (const [kind, tpl] of Object.entries(TEMPLATES)) {
    const f = path.join(dir, `${kind}.yaml`);
    const body = [
      `# 类型模板：${kind}`,
      `# ${tpl.note}`,
      '#',
      '# 这是「一类任务怎么做」的归纳。任务实例由它 + 坐标生成。',
      '# agent 从多次成功执行中归纳出更优做法时，改这里。',
      '',
      'cases:',
      `  - name: ${kind} 类任务`,
      '    steps:',
      '      - aiAssert:',
      '          prompt: 页面显示「完成进度」和任务列表',
      '      - ensureNoPopup: {}',
      '      - runAdbShell:',
      '          command: input tap {{TAP_X}} {{TAP_Y}}',
      '      - wait: { duration: 3, unit: s }',
      '      - ensureNoPopup: {}',
      ...(tpl.search
        ? [
            '      - aiAssert:',
            '          prompt: 已进入搜索页面',
            '      - aiInput:',
            '          value: {{KEYWORD}}',
            '      - wait: { duration: 1, unit: s }',
          ]
        : []),
      `      - wait: { duration: ${tpl.dwell}, unit: s }`,
      ...(tpl.swipe
        ? ['      - runAdbShell:', '          command: input swipe 540 1680 540 720 400', '      - wait: { duration: 1, unit: s }']
        : []),
      '      - back: {}',
      '      - wait: { duration: 2.5, unit: s }',
      '',
    ].join('\n');
    fs.writeFileSync(f, body, 'utf8');
    written.push(f);
  }
  return written;
}