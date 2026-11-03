import { readFile } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';
import type { DeviceAction, DeviceFrame } from './device.ts';

const VERSION = 'learned-browse-153-155-v1';
type Owner = { package: string; userId: number };
type Box = number[];
type Line = DeviceFrame['lines'][number];
export type LearnedBrowseOptions = { rewardCoins: 20 | 50; requiredMs?: never }
  | { rewardCoins: 50; requiredMs: 25000 };
type Inspection = { state: 'browsing' | 'completed'; action?: DeviceAction; quote?: string; version: string;
  rewardCoins?: 20 | 50; requiredMs?: 25000; observedRemainingMs?: number };
const text = (line: Line) => line.text.normalize('NFKC').replace(/\s/g, '');
const reference = new URL('../../evidence/continuous-supervised-2026-11-01T05-18-43-216Z/', import.meta.url);
// Original 171 destination, not a modified 50 header or a completed receipt.
const reference20 = new URL('../../evidence/staged-2026-11-01T08-46-52-728Z/84707f78-82f4-414c-9664-d72f8e681624.png', import.meta.url);
// Original 194 completed-20 component; never derive reward glyphs from 50.
const completed20 = new URL('../../evidence/staged-2026-11-01T11-50-22-744Z/1c143332-c14b-48b1-97a0-18124fc338d3.png', import.meta.url);
const blockedText = /登录|登陆|验证|授权|允许|同意|去完成|赚金币抵钱|继续浏览|温馨提示|确认|取消|任务列表/;
const requirementPattern = /^浏览(?<seconds>[1-9]\d*)秒可领(?:淘金币|金币|币)(?<reward>[1-9]\d*)[~～]?$/u;
const receiptPattern = /^[•·●!]?已得(?:淘金币|金币|币|市|帀)?([1-9]\d*)[|｜]下单再得(?:淘金币|金币|币|市|帀)?500[灣赠贈]?$/u;
type Rejection = { ok: false; reason: 'invalid_frame' | 'unsupported_reward' | 'blocked' | 'ambiguous_requirements'
  | 'requirements_missing' | 'unsupported_receipt' | 'image_or_component_mismatch' | 'image_error'; observedRewardCoins?: number };

// Parse the entire destination requirement/receipt. List maxima and the order
// promotion are never alternative sources for the browsing reward.
function rejectContract(frame: DeviceFrame, owner: Owner, options?: LearnedBrowseOptions): Rejection | null {
  const reward = options === undefined ? 50 : options?.rewardCoins;
  if (reward !== 20 && reward !== 50) return { ok: false, reason: 'unsupported_reward' };
  if (options?.requiredMs !== undefined && (options.requiredMs !== 25000 || reward !== 50))
    return { ok: false, reason: 'requirements_missing' };
  if (!valid(frame, owner)) return { ok: false, reason: 'invalid_frame' };
  if (frame.lines.some(l => blockedText.test(text(l)))) return { ok: false, reason: 'blocked' };
  const requirements = frame.lines.filter(l => /^浏览.*秒可领/u.test(text(l)));
  const receipts = frame.lines.filter(l => /已得/u.test(text(l)));
  if (requirements.length > 1 || receipts.length > 1 || (requirements.length && receipts.length))
    return { ok: false, reason: 'ambiguous_requirements' };
  const observed = requirements.length ? requirementPattern.exec(text(requirements[0])) : receipts.length ? receiptPattern.exec(text(receipts[0])) : null;
  if (!observed) return { ok: false, reason: 'requirements_missing' };
  const observedRewardCoins = Number(requirements.length ? observed.groups?.reward : observed[1]);
  // 187 supplies only an initial 25-second frame. Do not infer an original
  // duration from a first-seen countdown; the legacy 1–10 contract is unchanged.
  if (requirements.length) {
    const seconds = Number(observed.groups?.seconds);
    if (options?.requiredMs === 25000 ? seconds !== 25 : seconds < 1 || seconds > 10)
      return { ok: false, reason: 'requirements_missing' };
  }
  if (observedRewardCoins !== reward) return { ok: false, reason: 'unsupported_reward', observedRewardCoins };

  return null;
}

async function decode(path: string) {
  const sharp = (await import('sharp')).default;
  const image = sharp(await readFile(path), { failOn: 'warning', limitInputPixels: 1080 * 2400 });
  const meta = await image.metadata();
  if (meta.format !== 'png' || meta.width !== 1080 || meta.height !== 2400 || (meta.pages ?? 1) !== 1) throw Error('Invalid learned browse PNG');
  return image.removeAlpha().toColourspace('srgb').raw().toBuffer();
}

function valid(frame: DeviceFrame, owner: Owner) {
  return owner?.package === 'com.taobao.taobao' && Number.isSafeInteger(owner.userId) && owner.userId >= 0
    && frame?.package === owner.package && frame.userId === owner.userId && !frame.observationError
    && frame.width === 1080 && frame.height === 2400 && typeof frame.id === 'string' && !!frame.id
    && typeof frame.path === 'string' && !!frame.path && Number.isSafeInteger(frame.capturedAt)
    && Array.isArray(frame.lines) && frame.lines.length > 0 && frame.lines.every(line => typeof line?.text === 'string'
      && Array.isArray(line.bounds) && line.bounds.length === 4 && line.bounds.every(Number.isFinite)
      && line.bounds[0] >= 0 && line.bounds[1] >= 0 && line.bounds[2] <= frame.width && line.bounds[3] <= frame.height
      && line.bounds[0] < line.bounds[2] && line.bounds[1] < line.bounds[3]);
}

// Compare small tiles so a local obstruction cannot disappear in an average.
// Coordinates in source space; translation comes from current OCR anchors.
function matches(a: Buffer, b: Buffer, box: Box, dx = 0, dy = 0, masks: Box[] = [], tolerance = .035) {
  for (let y = box[1]; y < box[3]; y += 24) for (let x = box[0]; x < box[2]; x += 24) {
    let changed = 0, count = 0;
    for (let yy = y; yy < Math.min(y + 24, box[3]); yy++) for (let xx = x; xx < Math.min(x + 24, box[2]); xx++) {
      if (masks.some(m => xx >= m[0] && xx < m[2] && yy >= m[1] && yy < m[3])) continue;
      const tx = xx + dx, ty = yy + dy;
      if (tx < 0 || tx >= 1080 || ty < 0 || ty >= 2400) return false;
      const i = (yy * 1080 + xx) * 3, j = (ty * 1080 + tx) * 3;
      if (Math.max(...[0, 1, 2].map(k => Math.abs(a[i + k] - b[j + k]))) > 24) changed++;
      count++;
    }
    if (count && changed / count > tolerance) return false;
  }
  return true;
}

function matchesAnchor(a: Buffer, b: Buffer, dx: number, dy: number, masks: Box[] = [], bottom = 260, edgeJitter = 2) {
  for (let y = -edgeJitter; y <= edgeJitter; y++) for (let x = -2; x <= 2; x++) {
    if (matches(a, b, [0, 102, 1080, bottom], dx + x, dy + y, masks)) return true;
  }
  return false;
}

function hasInk(pixels: Buffer, bounds: Box) {
  // Reject stale OCR over blank/dim modal surfaces. OCR is an observation, not
  // proof that the original words remain visible in the supplied PNG.
  let low = 255, high = 0;
  for (let y = Math.ceil(bounds[1]); y < Math.floor(bounds[3]); y += 2)
    for (let x = Math.ceil(bounds[0]); x < Math.floor(bounds[2]); x += 2) {
      const i = (y * 1080 + x) * 3;
      const value = (pixels[i] + pixels[i + 1] + pixels[i + 2]) / 3;
      low = Math.min(low, value); high = Math.max(high, value);
    }
  // Product artwork includes near-white lettering (157's TOP2 has contrast 48).
  // A dimmed copy must not qualify just because it retains that small contrast.
  // Header and price badges still require strict learned pixel matches.
  return high - low > 65 || (high > 240 && high - low > 40);
}

async function inspect(frame: DeviceFrame, owner: Owner, options?: LearnedBrowseOptions): Promise<(Inspection & { pixels: Buffer; dx: number; dy: number }) | null> {
  if (rejectContract(frame, owner, options)) return null;
  const reward = options === undefined ? 50 : options?.rewardCoins;
  if (reward !== 20 && reward !== 50) return null;
  // 187 is the initial-requirement source; 153 supplies the unchanged layout
  // and reusable completed-50 component, not evidence that 187 completed.
  const contract = { version: options?.requiredMs === 25000 ? 'learned-browse-187-25-v1'
    : reward === 20 ? 'learned-browse-171-20-v1' : VERSION,
    ...(options === undefined ? {} : { rewardCoins: reward }),
    ...(options?.requiredMs === 25000 ? { requiredMs: 25000 as const } : {}) };
  const requirements = frame.lines.filter(l => Number(requirementPattern.exec(text(l))?.groups?.reward) === reward);
  const secondary = frame.lines.filter(l => text(l) === '任意下单最高另得500淘金币');
  const receipts = frame.lines.filter(l => Number(receiptPattern.exec(text(l))?.[1]) === reward);
  let pixels: Buffer, learned: Buffer, dx: number, dy: number, top: number;
  const done = receipts.length === 1;
  if (done) {
    if (requirements.length || secondary.length || frame.lines.filter(l => /已得/.test(text(l))).length !== 1) return null;
    const r = receipts[0].bounds;
    // Anchor to the stable lower text edge; the original OCR top edges differ.
    dx = Math.round(r[0] - (reward === 20 ? 417.655188315225 : 369));
    dy = Math.round(r[3] - (reward === 20 ? 209.83948024904794 : 213));
    if (Math.abs(dx) > 24 || Math.abs(dy) > 32 || r[2] < 1000 + dx
      || r[3] - r[1] > 86 || r[3] - r[1] < 35) return null;
    pixels = await decode(frame.path);
    learned = await decode(reward === 20 ? completed20.pathname
      : new URL('17cbd398-0659-40fc-90d7-79d3ee3c188f.png', reference).pathname);
    // The completed static header ends at 258; 258–260 is changing merchandise.
    // 170 OCR puts the same header's lower text edge 3px above the reference.
    if (!matchesAnchor(learned, pixels, dx, dy, [], 258, 3)) return null;
    top = Math.ceil(260 + dy);
  } else {
    if (requirements.length !== 1 || secondary.length !== 1 || frame.lines.some(l => /已得|任务完成|已完成/.test(text(l)))) return null;
    const r = requirements[0].bounds, s = secondary[0].bounds;
    dx = Math.round(s[0] - 553.9354777766166); dy = Math.round(s[1] - 198.83720955153325);
    if (Math.abs(dx) > 24 || Math.abs(dy) > 32 || Math.abs(r[0] - s[0]) > 16
      || r[1] < s[1] - 90 || r[3] > s[1] + 8 || s[1] - r[3] > 35
      || Math.abs(s[2] - s[0] - 407.6) > 25 || s[3] - s[1] > 55 || s[3] - s[1] < 20
      || r[2] < s[2] - 20 || r[2] > frame.width - 12) return null;
    pixels = await decode(frame.path);
    learned = await decode(reward === 20 ? reference20.pathname
      : new URL('bfbc7cc8-510d-4133-82f7-1a432fa97af7.png', reference).pathname);
    // Mask only digits and animated chevron, never the adjacent words or amount.
    if (!matchesAnchor(learned, pixels, dx, dy,
      [[650, 137, 706, 196], [976, 136, 1035, 195]])) return null;
    top = Math.ceil(s[3] + 28);
  }
  const bottom = frame.height - 120;
  const content = frame.lines.filter(l => l.bounds[1] >= top && l.bounds[3] <= bottom);
  const offers = content.filter(l => text(l) === '金币热卖价');
  if (offers.length < 2 || content.length < 8 || content.some(l => text(l).length >= 3 && !/^正在加载更多内容/.test(text(l)) && !hasInk(pixels, l.bounds))) return null;
  // A learned price badge is a static local component, independent of merchandise
  // words or the number of columns. Match it at each current OCR location.
  const badges = await decode(new URL('bfbc7cc8-510d-4133-82f7-1a432fa97af7.png', reference).pathname);
  const receiptBadges = done && reward === 20 ? await decode(completed20.pathname) : null;
  for (const offer of offers) {
    const b = offer.bounds;
    let found = false;
    for (const [rx, ry] of [[334, 970], [861, 1137], [334, 1751], [861, 1919]]) {
      const ox = Math.round(b[0]) - rx, oy = Math.round(b[1]) - ry;
      for (let y = -4; y <= 4 && !found; y++) for (let x = -4; x <= 4 && !found; x++)
        found = matches(badges, pixels, [rx, ry + 4, rx + 176, ry + 34], ox + x, oy + y, [], .12);
      if (found) break;
    }
    // 194's last badge has a different OCR left edge. Learn its original
    // complete glyph component with the same tile tolerance and search radius.
    if (!found && receiptBadges) {
      const rx = 327, ry = 2229;
      const ox = Math.round(b[0]) - rx, oy = Math.round(b[1]) - ry;
      for (let y = -4; y <= 4 && !found; y++) for (let x = -4; x <= 4 && !found; x++)
        found = matches(receiptBadges, pixels, [rx, ry + 4, rx + 176, ry + 34], ox + x, oy + y, [], .12);
    }
    if (!found || !content.some(l => /[¥￥]\d/.test(text(l)) && Math.abs(l.bounds[1] - b[1]) < 35
      && l.bounds[0] < b[0] && b[0] - l.bounds[0] < 400)) return null;
  }
  if (done) return { state: 'completed', quote: receipts[0].text, ...contract, pixels, dx, dy };
  const rows = offers.map(l => l.bounds).sort((a, b) => a[1] - b[1]);
  const toY = Math.ceil(Math.max(top + 64, rows[0][3] + 64));
  const fromY = Math.floor(Math.min(bottom - 64, rows.at(-1)![1] - 64));
  if (fromY - toY < 350) return null;
  const left = Math.min(...content.map(l => l.bounds[0])), right = Math.max(...content.map(l => l.bounds[2]));
  const x = Math.round((left + right) / 2);
  return { state: 'browsing', action: { type: 'swipe', fromX: x, fromY, toX: x, toY, ms: 900 },
    ...contract, ...(options?.requiredMs === 25000 ? {
      observedRemainingMs: Number(requirementPattern.exec(text(requirements[0]))?.groups?.seconds) * 1000,
    } : {}), pixels, dx, dy };
}

/** Current text/layout policy. Saved frame and raw OCR must describe the exact
 * supplied capture; contrast is an obstruction check, not OCR verification.
 * Caller owns entry/attempt binding, age, consumption, budgets and settlement. */
export async function inspectCurrentLearnedBrowse(frame: DeviceFrame, owner: Owner,
  options?: LearnedBrowseOptions): Promise<Inspection | null> {
  try {
    if (rejectContract(frame, owner, options) || !frame.path.endsWith('.png')
      || blockedText.test(frame.lines.map(text).join(''))) return null;
    const [savedBytes, rawBytes] = await Promise.all([
      readFile(frame.path.replace(/\.png$/, '.json')), readFile(frame.path.replace(/\.png$/, '.ocr.json')),
    ]);
    if (!isDeepStrictEqual(JSON.parse(savedBytes.toString()), frame)) return null;
    const raw = JSON.parse(rawBytes.toString()), page = raw.pages?.[0];
    if (raw.engine !== 'Apple Vision VNRecognizeTextRequest' || raw.languageCorrection !== false
      || !isDeepStrictEqual(raw.languages, ['zh-Hans', 'en-US']) || raw.pages.length !== 1
      || page.file !== frame.path || page.width !== frame.width || page.height !== frame.height || page.revision !== 3
      || !Array.isArray(page.lines) || page.lines.length !== frame.lines.length
      || page.lines.some((l: Line, i: number) => l?.text !== frame.lines[i].text
        || !Array.isArray(l.bounds) || l.bounds.length !== 4 || l.bounds.some((v, k) => !Number.isFinite(v)
          || v < -.001 || v > (k % 2 ? 2400 : 1080) + .001
          || frame.lines[i].bounds[k] !== Math.max(0, Math.min(k % 2 ? 2400 : 1080, v))))) return null;
    const pixels = await decode(frame.path);
    const rewardCoins = options?.rewardCoins ?? 50;
    const requirements = frame.lines.filter(l => requirementPattern.test(text(l)));
    const receipts = frame.lines.filter(l => receiptPattern.test(text(l)));
    const component = receipts.length ? receipts : requirements;
    if (component.length !== 1 || !hasInk(pixels, component[0].bounds)) return null;
    // A partly covered sentence can retain high global contrast. Bound blank
    // vertical strips within the complete current text component as well.
    const b = component[0].bounds;
    let blank = 0;
    for (let x = Math.ceil(b[0]); x < Math.floor(b[2]); x++) {
      let low = 255, high = 0;
      for (let y = Math.ceil(b[1]); y < Math.floor(b[3]); y++) {
        const i = (y * 1080 + x) * 3, v = (pixels[i] + pixels[i + 1] + pixels[i + 2]) / 3;
        low = Math.min(low, v); high = Math.max(high, v);
      }
      blank = high - low < 35 ? blank + 1 : 0;
      if (blank > (b[3] - b[1]) * .8) return null;
    }
    const version = 'learned-browse-current-components-v1';
    const contract = { version, rewardCoins, ...(options?.requiredMs === 25000 ? { requiredMs: 25000 as const } : {}) };
    if (receipts.length) return { state: 'completed', quote: receipts[0].text, ...contract };
    if (frame.lines.some(l => /已完成|任务完成/.test(text(l)))) return null;
    // Full instruction establishes the browse surface. Promotional copy and
    // merchandise never supply requirement, reward or swipe authority.
    const top = Math.ceil(component[0].bounds[3] + 128), bottom = frame.height - 160;
    if (bottom - top < 500) return null;
    return { state: 'browsing', ...contract,
      action: { type: 'swipe', fromX: 540, fromY: bottom, toX: 540, toY: top, ms: 900 },
      ...(options?.requiredMs === 25000 ? { observedRemainingMs: Number(requirementPattern.exec(text(component[0]))?.groups?.seconds) * 1000 } : {}),
    };
  } catch { return null; }
}

/** Candidate local inspection only. Caller owns selected-entry provenance,
 * capture age, one-shot consumption, swipe budget and account settlement. */
export async function inspectLearnedBrowse(frame: DeviceFrame, owner: Owner, options?: LearnedBrowseOptions): Promise<Inspection | null> {
  const result = await inspectLearnedBrowseDetailed(frame, owner, options);
  return result.ok ? result.inspection : null;
}

/** Diagnostics do not grant actions or certify execution provenance. Unknown
 * styles still require the caller's learning fallback. */
export async function inspectLearnedBrowseDetailed(frame: DeviceFrame, owner: Owner, options?: LearnedBrowseOptions): Promise<
  { ok: true; inspection: Inspection } | Rejection
> {
  try {
    const rejected = rejectContract(frame, owner, options);
    if (rejected) return rejected;
    const result = await inspect(frame, owner, options);
    if (!result) return { ok: false, reason: 'image_or_component_mismatch' };
    const { pixels, dx, dy, ...inspection } = result;
    return { ok: true, inspection };
  } catch { return { ok: false, reason: 'image_error' }; }
}

/** Re-observe before dispatch; never renew old coordinates or replay navigation.
 * Stable duplicates in offline tests exercise comparison, not capture provenance. */
export async function revalidateLearnedBrowse(
  oldFrame: DeviceFrame, freshFrame: DeviceFrame, action: DeviceAction, owner: Owner, options?: LearnedBrowseOptions,
): Promise<{ action: DeviceAction; reason: string } | null> {
  try {
    if (action?.type !== 'swipe' || !['fromX', 'fromY', 'toX', 'toY', 'ms'].every(k => Number.isSafeInteger(action[k as keyof DeviceAction]))
      || action.fromX! < 0 || action.fromX! >= 1080 || action.fromX !== action.toX
      || action.toY! < 0 || action.fromY! >= 2400 || action.fromY! <= action.toY!
      || action.ms! < 200 || action.ms! > 1500 || oldFrame?.id === freshFrame?.id
      || !(freshFrame?.capturedAt > oldFrame?.capturedAt)) return null;
    const old = await inspect(oldFrame, owner, options), fresh = await inspect(freshFrame, owner, options);
    if (old?.state !== 'browsing' || fresh?.state !== 'browsing' || !fresh.action) return null;
    const relevant = (frame: DeviceFrame) => frame.lines.filter(l => l.bounds[1] >= 260 && l.bounds[3] <= 2280);
    const before = relevant(oldFrame), after = relevant(freshFrame);
    // Each frame has independently passed the complete page/reward contract,
    // glyph visibility and price-badge checks. Merchandise OCR can jitter over
    // identical pixels; use its geometry for region continuity, and the entire
    // content PNG below for visual continuity rather than exact product words.
    if (before.length !== after.length || before.some(l => !after.some(n =>
      n.bounds.every((v, i) => Math.abs(v - l.bounds[i]) <= 4)))) return null;
    if (!matches(old.pixels, fresh.pixels, [0, 102, 1080, 260], 0, 0,
      [[650 + old.dx, 137 + old.dy, 706 + old.dx, 196 + old.dy], [976 + old.dx, 136 + old.dy, 1035 + old.dx, 195 + old.dy]])
      || !matches(old.pixels, fresh.pixels, [0, 260, 1080, 2280])) return null;
    return { action: fresh.action, reason: `${fresh.version}: complete learned reward component and content verified tile by tile; swipe regenerated from fresh OCR` };
  } catch { return null; }
}
