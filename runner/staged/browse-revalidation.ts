import { readFile } from 'node:fs/promises';
import { inspectSelectedContinuousContract, type ContinuousContract } from './continuous-contract.ts';
export type CurrentBrowseRevalidation = { policy: 'current-components-v1'; selectedContract: ContinuousContract };

/** Prerequisite: the Agent has reviewed the complete old PNG and proposed a
 * swipe, and open_task has confirmed independent ordinary browsing. This only
 * revalidates that candidate against a fresh frame; navigation provenance, age,
 * single consumption and the continuous-scroll budget remain the caller's gates. */
export async function revalidateBrowseSwipe(
  oldFrame: any, freshFrame: any, action: any, owner: { package: string; userId: number },
  options?: CurrentBrowseRevalidation,
): Promise<{ action: any; reason: string } | null> {
  try {
    if (options !== undefined) {
      if (options.policy !== 'current-components-v1' || !options.selectedContract
        || action?.type !== 'swipe' || oldFrame?.id === freshFrame?.id
        || !(freshFrame?.capturedAt > oldFrame?.capturedAt)
        || !['fromX', 'fromY', 'toX', 'toY', 'ms'].every(k => Number.isSafeInteger(action[k]))
        || action.ms < 200 || action.ms > 1500 || action.fromX !== action.toX
        || action.fromX < 0 || action.fromX >= 1080 || action.toY < 0 || action.fromY >= 2400
        || action.fromY <= action.toY) return null;
      const old = await inspectSelectedContinuousContract(oldFrame, owner, options.selectedContract, options);
      const fresh = await inspectSelectedContinuousContract(freshFrame, owner, options.selectedContract, options);
      if (old.inspection?.state !== 'browsing' || fresh.inspection?.state !== 'browsing' || !fresh.inspection.action) return null;
      return { action: fresh.inspection.action, reason: 'current-components-v1: selected contract, owner and complete current requirement revalidated; fresh swipe regenerated' };
    }
    if (action?.type !== 'swipe' || !owner || owner.package !== 'com.taobao.taobao'
      || !Number.isSafeInteger(owner.userId) || owner.userId < 0) return null;
    const frames = [oldFrame, freshFrame];
    if (frames.some(f => !f || f.package !== owner.package || f.userId !== owner.userId
      || f.width !== 1080 || f.height !== 2400 || f.observationError
      || typeof f.id !== 'string' || !f.id || typeof f.path !== 'string'
      || !Number.isSafeInteger(f.capturedAt) || !Array.isArray(f.lines) || !f.lines.length)) return null;
    if (oldFrame.id === freshFrame.id || freshFrame.capturedAt <= oldFrame.capturedAt) return null;
    if (!['fromX', 'fromY', 'toX', 'toY', 'ms'].every(k => Number.isSafeInteger(action[k]))
      || action.ms < 200 || action.ms > 1500 || action.fromX !== action.toX
      || action.fromX < 0 || action.fromX >= oldFrame.width || action.toY < 0
      || action.fromY >= oldFrame.height || action.fromY <= action.toY) return null;

    const locate = (frame: any) => {
      if (frame.lines.some((l: any) => typeof l?.text !== 'string' || !Array.isArray(l.bounds) || l.bounds.length !== 4
        || l.bounds.some((v: any) => typeof v !== 'number' || !Number.isFinite(v))
        || l.bounds[0] < 0 || l.bounds[1] < 0 || l.bounds[2] > frame.width || l.bounds[3] > frame.height
        || l.bounds[0] >= l.bounds[2] || l.bounds[1] >= l.bounds[3])) return null;
      const text = (l: any) => l.text.normalize('NFKC').replace(/\s/g, '');
      if (frame.lines.some((l: any) => /已得|已完成|任务完成|登录|登陆|验证|授权|允许|同意|立即领取|去完成|赚金币抵钱|继续浏览|温馨提示|确认|取消/.test(text(l)))) return null;
      const requirements = frame.lines.filter((l: any) => /^浏览(?:10|[1-9])秒可领币50[~～]?$/.test(text(l)));
      const secondary = frame.lines.filter((l: any) => text(l) === '任意下单最高另得500淘金币');
      if (requirements.length !== 1 || secondary.length !== 1) return null;
      const r = requirements[0].bounds, s = secondary[0].bounds;
      // The complete learned reward component must stay above the product grid.
      if (r[0] < 540 || r[0] > 570 || r[1] < 130 || r[1] > 150 || r[2] < 1000 || r[3] > 198
        || s[0] < 540 || s[0] > 570 || s[1] < 195 || s[1] > 210 || s[2] < 940 || s[3] > 240) return null;
      const top = Math.ceil(s[3] + 32);
      const columns = [frame.lines.filter((l: any) => text(l) === '金币热卖价' && l.bounds[0] < 540),
        frame.lines.filter((l: any) => text(l) === '金币热卖价' && l.bounds[0] > 800)];
      if (columns.some(column => column.length < 2 || column.some((l: any) => l.bounds[1] <= top || l.bounds[3] >= 2250))) return null;
      // Both columns must also expose product descriptions, rather than reward
      // text over an otherwise unrelated page. No task-name classification.
      if ([0, 540].some(left => frame.lines.filter((l: any) => l.bounds[0] >= left && l.bounds[0] < left + 540
        && l.bounds[1] > top && /正品保证|七天退换/.test(text(l))).length < 2)) return null;
      const rows = columns.map(column => column.map((l: any) => l.bounds).sort((a: number[], b: number[]) => a[1] - b[1]));
      const first = Math.max(rows[0][0][3], rows[1][0][3]);
      const last = Math.min(rows[0][1][1], rows[1][1][1]);
      if (last - first < 350) return null;
      const content = frame.lines.filter((l: any) => l.bounds[1] > top && l.bounds[3] < 2250);
      const leftEdge = Math.max(...content.filter((l: any) => l.bounds[2] < 540).map((l: any) => l.bounds[2]));
      const rightEdge = Math.min(...content.filter((l: any) => l.bounds[0] > 540).map((l: any) => l.bounds[0]));
      if (!Number.isFinite(leftEdge) || !Number.isFinite(rightEdge) || rightEdge - leftEdge < 12) return null;
      return { top, rows, fromY: Math.floor(last - 64), toY: Math.ceil(first + 64), x: Math.round((leftEdge + rightEdge) / 2) };
    };
    const old = locate(oldFrame), fresh = locate(freshFrame);
    if (!old || !fresh) return null;
    if (Math.abs(old.top - fresh.top) > 3 || old.rows.some((column, i) => column.length !== fresh.rows[i].length
      || column.some((b: number[], j: number) => b.some((v, k) => Math.abs(v - fresh.rows[i][j][k]) > 3)))) return null;

    // sharp is already installed transitively. Import/decode/read failures reject;
    // there is deliberately no text-only fallback and no image rewriting.
    const sharp = (await import('sharp')).default;
    const decode = async (path: string) => {
      const bytes = await readFile(path);
      const image = sharp(bytes, { failOn: 'warning', limitInputPixels: 1080 * 2400 });
      const meta = await image.metadata();
      if (meta.format !== 'png' || meta.width !== 1080 || meta.height !== 2400 || (meta.pages ?? 1) !== 1) throw Error('Unsupported image');
      return image.removeAlpha().toColourspace('srgb').raw().toBuffer();
    };
    const [oldPixels, newPixels, learned] = await Promise.all([
      decode(oldFrame.path), decode(freshFrame.path),
      decode(new URL('../../evidence/continuous-supervised-2026-11-01T05-18-43-216Z/bfbc7cc8-510d-4133-82f7-1a432fa97af7.png', import.meta.url).pathname),
    ]);
    const consistent = (a: Buffer, b: Buffer, top: number, bottom: number, countdown: boolean) => {
      // Local tiles prevent a small dialog from disappearing in a global average.
      for (let y = top; y < bottom; y += 32) for (let x = 0; x < 1080; x += 32) {
        let changed = 0, count = 0;
        for (let yy = y; yy < Math.min(y + 32, bottom); yy++) for (let xx = x; xx < Math.min(x + 32, 1080); xx++) {
          // Ignore only the countdown digits, never the rest of the requirement.
          if (countdown && xx >= 650 && xx <= 705 && yy >= 137 && yy <= 195) continue;
          const i = (yy * 1080 + xx) * 3;
          if (Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2])) > 20) changed++;
          count++;
        }
        if (count && changed / count > 0.025) return false;
      }
      return true;
    };
    // Only the reward header is a learned template. Product authority comes
    // from the caller's full old-image review; fresh products must match old
    // products tile by tile, without being pinned to the learned merchandise.
    if (!consistent(learned, oldPixels, 102, 260, true) || !consistent(learned, newPixels, 102, 260, true)
      || !consistent(oldPixels, newPixels, 102, 260, true) || !consistent(oldPixels, newPixels, 260, 2280, false)) return null;
    return { action: { type: 'swipe', fromX: fresh.x, fromY: fresh.fromY, toX: fresh.x, toY: fresh.toY, ms: 900 },
      reason: '153 learned reward header verified in both PNGs; reviewed two-column products unchanged between old and fresh; swipe regenerated from fresh OCR anchors' };
  } catch {
    return null;
  }
}
