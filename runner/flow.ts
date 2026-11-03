/**
 * 步骤解释器：入口导航、领奖、结算等"非任务"步骤用。
 *
 * 任务执行已经交给 Midscene Test 的 YAML 执行单元（workflow.ts），
 * 这里只保留 YAML 表达不了的：if 分支、repeat 循环、本地文本点击。
 *
 * 为什么还留着：Midscene YAML 没有 if/loop（issue #2215 仍 open），
 * 而入口导航必须能按当前页面状态分支。
 */
import { hasAnyText, shell, sleep } from './adb';
import type { Step } from './config';
import { stepBegin } from './step';
import { readBalance } from './probe';

const W = 1080;
const H = 2400;

export type ExecCtx = {
  agent: any;
  /** 有 runId 时记录步骤级明细 */
  runId?: number | null;
  seq: number;
  stage: string;
  balanceBefore: number | null;
  balanceAfter: number | null;
  stepsDone: number;
  failed: string[];
  overBudget: () => boolean;
  log: (s: string) => void;
};

export async function execStep(ctx: ExecCtx, step: Step, depth = 0): Promise<void> {
  const label = step.do === 'ai' ? `ai: ${step.say?.slice(0, 30)}` : step.do;
  if (ctx.overBudget()) throw new Error('超预算');

  const endStep = ctx.runId
    ? stepBegin({
        runId: ctx.runId,
        seq: ++ctx.seq,
        stage: ctx.stage,
        action: step.do,
        detail: step.say?.slice(0, 60),
      })
    : null;
  const finish = (ok = true, err?: string) => {
    try {
      endStep?.(ok, undefined, undefined, err);
    } catch {}
  };
  try {
    await execStepInner(ctx, step, depth, finish);
  } catch (e: any) {
    finish(false, String(e?.message ?? e).slice(0, 120));
    throw e;
  }
}

async function execStepInner(
  ctx: ExecCtx,
  step: Step,
  depth: number,
  finish: (ok?: boolean, err?: string) => void,
): Promise<void> {
  const label = step.do === 'ai' ? `ai: ${step.say?.slice(0, 30)}` : step.do;

  switch (step.do) {
    case 'ai': {
      try {
        await ctx.agent.aiAct(step.say!);
        ctx.stepsDone++;
      } catch (e: any) {
        ctx.failed.push(`${label} → ${String(e?.message ?? e).slice(0, 140)}`);
      }
      if (step.wait) await sleep(step.wait * 1000);
      finish();
      return;
    }
    case 'read': {
      const v = await readBalance(ctx, step.say);
      if (step.as === 'after') ctx.balanceAfter = v;
      else ctx.balanceBefore = v ?? ctx.balanceBefore;
      ctx.stepsDone++;
      finish();
      return;
    }
    case 'shell': {
      // 任意 adb shell 命令，0 调用。用于强制归位（am start）等。
      const cmd = step.text ?? step.say ?? '';
      if (!cmd) {
        ctx.failed.push('shell 步骤缺少命令');
        finish(false, 'shell 缺命令');
        return;
      }
      shell(cmd, step.timeout_ms ?? 20000);
      ctx.log(`  ↳ shell: ${cmd.slice(0, 60)}`);
      ctx.stepsDone++;
      if (step.wait) await sleep(step.wait * 1000);
      finish();
      return;
    }
    case 'tap': {
      // 归一化坐标点击，0 调用。用于已验证的固定路径。
      const nx = step.x ?? 0.5;
      const ny = step.y ?? 0.5;
      if (nx < 0 || nx > 1 || ny < 0 || ny > 1) {
        ctx.failed.push(`tap 坐标越界：(${nx}, ${ny})`);
        finish(false, 'tap 坐标越界');
        return;
      }
      const px = Math.round(nx * W);
      const py = Math.round(ny * H);
      shell(`input tap ${px} ${py}`);
      ctx.log(`  ↳ 坐标点击 (${nx}, ${ny}) → (${px}, ${py}) → 0 调用`);
      ctx.stepsDone++;
      if (step.wait) await sleep(step.wait * 1000);
      finish();
      return;
    }
    case 'ai_tap': {
      // 只 locate 不 planning：单步定位比 aiAct 便宜一半以上
      // 失败不抛错（entry 里常需要"不在这个页面就跳过"的语义）
      try {
        await ctx.agent.aiTap(step.say!);
        ctx.stepsDone++;
      } catch (e: any) {
        const msg = String(e?.message ?? e).slice(0, 120);
        if (step.optional) ctx.log(`  ↳ ai_tap 跳过（${msg.slice(0, 50)}）`);
        else ctx.failed.push(`${label} → ${msg}`);
      }
      if (step.wait) await sleep(step.wait * 1000);
      finish();
      return;
    }
    case 'ai_input': {
      try {
        await ctx.agent.aiInput(step.say!, { value: step.text ?? '' });
        ctx.stepsDone++;
      } catch (e: any) {
        const msg = String(e?.message ?? e).slice(0, 120);
        if (step.optional) ctx.log(`  ↳ ai_input 跳过（${msg.slice(0, 50)}）`);
        else ctx.failed.push(`${label} → ${msg}`);
      }
      if (step.wait) await sleep(step.wait * 1000);
      finish();
      return;
    }
    case 'dwell': {
      await sleep((step.seconds ?? 10) * 1000);
      ctx.stepsDone++;
      finish();
      return;
    }
    case 'back': {
      shell('input keyevent KEYCODE_BACK');
      await sleep((step.wait ?? 2) * 1000);
      ctx.stepsDone++;
      finish();
      return;
    }
    case 'swipe': {
      const n = step.times ?? 1;
      for (let i = 0; i < n; i++) {
        const from = step.direction === 'down' ? 800 : 1800;
        const to = step.direction === 'down' ? 1800 : 800;
        shell(`input swipe ${W / 2} ${from} ${W / 2} ${to} 400`);
        await sleep(1200);
      }
      ctx.stepsDone++;
      finish();
      return;
    }
    case 'tap_text': {
      // 优先点 clickable 节点：淘宝首页同一个入口常有 3 个同名节点，
      // 外层/文字节点不可点，点上去没反应。
      const adbMod = await import('./adb');
      // 内置重试：冷启动后页面渲染要几秒，第一次 dump 常常拿不到节点。
      // 但也不能等太久——淘宝首页约 10 秒会自己跳到活动页。
      // 所以「找到就点」，找不到每 1.5 秒重试一次，最多 4 次。
      let hit = adbMod.findNode(step.text!);
      for (let i = 0; !hit && i < 3; i++) {
        ctx.log(`  ↳ 暂未找到「${step.text}」，等 1.5s 重试 ${i + 1}/3`);
        await sleep(1500);
        hit = adbMod.findNode(step.text!);
      }
      if (hit) {
        shell(`input tap ${hit.cx} ${hit.cy}`);
        ctx.log(
          `  ↳ 本地点击「${hit.text}」(${hit.cx},${hit.cy}) clickable=${hit.clickable} → 0 调用`,
        );
        ctx.stepsDone++;
        if (step.wait) await sleep(step.wait * 1000);
      } else if (step.optional) {
        ctx.log(`  ↳ 本地未找到「${step.text}」，跳过`);
        ctx.stepsDone++;
      } else {
        ctx.failed.push(`tap_text 未找到「${step.text}」`);
        ctx.stepsDone++;
      }
      finish();
      return;
    }
    case 'assert_text': {
      const want = step.any ?? [];
      const texts = (await import('./adb')).screenTexts();
      const hit = want.find((w) => texts.includes(w));
      if (!hit) {
        throw new Error(`页面断言失败：屏幕上找不到「${want.join(' / ')}」（当前页面可能不对）`);
      }
      ctx.log(`  ↳ 断言通过：「${hit}」`);
      ctx.stepsDone++;
      finish();
      return;
    }
    case 'wait_for': {
      const deadline = Date.now() + (step.timeout_ms ?? 20000);
      while (Date.now() < deadline) {
        if (hasAnyText([step.text ?? step.say ?? ''])) {
          ctx.stepsDone++;
          return;
        }
        await sleep(1000);
      }
      ctx.failed.push(`wait_for 超时：${step.text ?? step.say}`);
      finish(false, 'wait_for 超时');
      return;
    }
    case 'repeat': {
      const max = step.max ?? 1;
      for (let i = 0; i < max; i++) {
        if (ctx.overBudget() || depth > 2) break;
        if (step.stop_when) {
          try {
            if (await ctx.agent.aiBoolean(step.stop_when)) break;
          } catch {}
        }
        for (const s of step.each ?? []) await execStep(ctx, s, depth + 1);
      }
      ctx.stepsDone++;
      finish();
      return;
    }
    case 'if': {
      let cond = false;
      let how = 'text';
      if (step.cond_text?.length) {
        cond = hasAnyText(step.cond_text) !== null;
      } else if (step.cond_ai) {
        how = 'ai';
        try {
          cond = await ctx.agent.aiBoolean(step.cond_ai);
        } catch {
          cond = false;
        }
      }
      const branch = cond ? step.then : step.else;
      ctx.log(`  ↳ if(${how}) = ${cond ? '真' : '假'}，执行 ${cond ? 'then' : 'else'} 分支 ${branch?.length ?? 0} 步`);
      for (const s of branch ?? []) await execStep(ctx, s, depth + 1);
      ctx.stepsDone++;
      finish();
      return;
    }
    default:
      ctx.failed.push(`未知步骤类型 ${(step as any).do}`);
  }
}

export async function execSteps(ctx: ExecCtx, steps: Step[]): Promise<void> {
  for (const s of steps) {
    if (ctx.overBudget()) {
      ctx.failed.push('超预算，跳过剩余步骤');
      break;
    }
    await execStep(ctx, s);
  }
}