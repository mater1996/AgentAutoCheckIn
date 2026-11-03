import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';
import type { DeviceFrame } from './device.ts';
import { verifyImmersiveOcrQuality, type ImmersiveOcrQuality } from './immersive-ocr-quality.ts';

const VERSION = 'immersive-browse-candidate-v2';
type Owner = { package: string; userId: number };
export type ImmersiveBrowseInspection = {
  state: 'browsing' | 'completed'; version: string; rewardCoins: number; quote?: string; waitMs?: number;
};
export type ImmersiveBrowseRequirement = { rewardCoins: number };
const history = new URL('../../evidence/staged-2026-11-01T04-08-28-272Z/', import.meta.url);
const fiftyHistory = new URL('../../evidence/staged-2026-11-01T08-50-08-755Z/', import.meta.url);
const norm = (s: string) => s.normalize('NFKC').replace(/\s/g, '');

/** Historical provenance, not independent validation or task-selection policy. */
export const immersiveBrowseSource = {
  state: 'candidate', sourceRunId: 145, recoveryRunId: 146,
  amount50: { sourceRunId: 172, sourceStatus: 'stopped', browsingEvidence: 'real', completedEvidence: 'synthetic_only' },
  amount35: { sourceRunId: 184, sourceStatus: 'stopped', browsingSourceRunId: 191, browsingEvidence: 'real', completedEvidence: 'real' },
  waitPolicy: { kind: 'observed_budget', maxMs: 20000, sliceMs: 3000, pageRequiredMs: null },
  shellVariant: { version: 'immersive-browsing50-details-shell-209-v1', sourceRunId: 209, state: 'candidate', completionEvidence: 'none' },
  files: {
    browsing50DetailsShellPng: { path: 'evidence/staged-2026-11-01T16-45-09-994Z/0c820617-d113-48ad-8938-7687b74bcdfd.png', sha256: '3036ce3d58eeb3c7e7bdbe748e79021c79cd86f97911eded76be772d7400f7ff' },
    browsing50DetailsShellFrame: { path: 'evidence/staged-2026-11-01T16-45-09-994Z/0c820617-d113-48ad-8938-7687b74bcdfd.json', sha256: 'e98d9be6ee1403d5c34148a03854b9609e7df91a3e05bbddaeb940deff5e7a2f' },
    browsing35Png: { path: 'evidence/staged-2026-11-01T11-23-10-672Z/a87ba7da-87a6-4f13-a756-3b0b0970dc97.png', sha256: '26f8a21f53d762a45c07babdc5b41fbaa3b188eaf0c03631f91e413deac8fbca' },
    browsing35Frame: { path: 'evidence/staged-2026-11-01T11-23-10-672Z/a87ba7da-87a6-4f13-a756-3b0b0970dc97.json', sha256: '5c4ed349b51170799040a55e11f02bce9aaad60653d9134ed77567ef6d61ce0b' },
    contractProposal: { path: 'docs/历史已学任务本地合同草案.json', sha256: 'cf827410f03e52165fcc3b262b2144a3265fd08edce8c190588fe5925a90c07f' },
    executionResult: { path: 'evidence/staged-2026-11-01T04-08-28-272Z/result.json', sha256: '1dd131934ade6d83a84617957fe73afa73ad3cd09133ff7995fae0872d84969d' },
    executionStages: { path: 'evidence/staged-2026-11-01T04-08-28-272Z/stages.json', sha256: '24f729b78a52dc8d08b2bdbeaee2f8803bda65b6d7dc8a7f2fe9613c98c61ac5' },
    recoveryResult: { path: 'evidence/immersive-supervised-reconcile-2026-11-01T04-13-33-035Z/result.json', sha256: '19adbd8afbd634ad0748d9854f2c5b4975a80927b01ccd493dc83b27b673d323' },
    browsingPng: { path: 'evidence/staged-2026-11-01T04-08-28-272Z/fb612cbe-6736-4d77-8463-fc7848c70ce0.png', sha256: '156b47f8e5a0ee82b14c9babd69c647e26a5b114d9ccc66e59fe71df276382f0' },
    browsingFrame: { path: 'evidence/staged-2026-11-01T04-08-28-272Z/fb612cbe-6736-4d77-8463-fc7848c70ce0.json', sha256: '9c613286c61a528ccbb3040ef7dfd0cae29e9a5d01a43d92e2543f9c3c9ac41b' },
    completedPng: { path: 'evidence/staged-2026-11-01T04-08-28-272Z/bac64856-dcf1-4bf4-9db9-fe960e2af71d.png', sha256: '0558d2b93452f23559e281593dee191fd61ff43bb956136c3d632c8de8225ba3' },
    completedFrame: { path: 'evidence/staged-2026-11-01T04-08-28-272Z/bac64856-dcf1-4bf4-9db9-fe960e2af71d.json', sha256: 'a22f8c2c5d3ab3c8f8fb0fc31c8de7cf91d589d1fa1774c4c1dcc0df0a597b58' },
    completed35Png: { path: 'evidence/staged-2026-11-01T10-35-22-744Z/33f7f285-7248-432d-8040-13aded9e3ebf.png', sha256: '817a642d8e6c2561196845120ce12dd0fc546c95ff88856a19d74e2fbd52f4fd' },
    completed35Frame: { path: 'evidence/staged-2026-11-01T10-35-22-744Z/33f7f285-7248-432d-8040-13aded9e3ebf.json', sha256: '4a321baf8f1056eefd45e45fcf09b8db8ed2ad4c659e9bfe78ec6277ab9dba16' },
    variant35Result: { path: 'evidence/staged-2026-11-01T10-35-22-744Z/result.json', sha256: 'da1f93d09ea85dbeaf65ee3651b47664627aeeda2102a0e1787bf6e960084e5f' },
    variant35Stages: { path: 'evidence/staged-2026-11-01T10-35-22-744Z/stages.json', sha256: '80cd6045d022bf79c305199e013b9b9401262c06096156fd298b2447da88964c' },
    variant35BeforePng: { path: 'evidence/staged-2026-11-01T10-35-22-744Z/3a3d237c-00d4-4502-82db-2e85d084e370.png', sha256: '6813853f62474f567a899c1c48b96b1e23656660dc6c6f76f34484a0703f375b' },
    variant35BeforeFrame: { path: 'evidence/staged-2026-11-01T10-35-22-744Z/3a3d237c-00d4-4502-82db-2e85d084e370.json', sha256: 'bebc99932719346815e1e9060c4c4f17e2c048acc8fa4326fa38603dc912bd06' },
    browsing50Png: { path: 'evidence/staged-2026-11-01T08-50-08-755Z/50a8f18d-ec2e-47ed-a615-6ca435769c67.png', sha256: '69ab9bf10e24989716b193d85281d73b8fbc45eda5f63ee67170764fc1518023' },
    browsing50Frame: { path: 'evidence/staged-2026-11-01T08-50-08-755Z/50a8f18d-ec2e-47ed-a615-6ca435769c67.json', sha256: '63c3cd625f948011f87381bfafb72c3e230bf4ca873ea93f752a445a5ecee9c1' },
  },
} as const;

async function pixels(path: string): Promise<Buffer> {
  const sharp = (await import('sharp')).default;
  const image = sharp(await readFile(path), { failOn: 'warning', limitInputPixels: 1080 * 2400 });
  const meta = await image.metadata();
  if (meta.format !== 'png' || meta.width !== 1080 || meta.height !== 2400 || (meta.pages ?? 1) !== 1)
    throw Error('Invalid immersive video PNG');
  return image.removeAlpha().toColourspace('srgb').raw().toBuffer();
}

/** Compare static component tiles, never the changing video itself. */
function matches(actual: Buffer, reference: Buffer, box: number[]): boolean {
  for (let y = box[1]; y < box[3]; y += 16) for (let x = box[0]; x < box[2]; x += 16) {
    let changed = 0, count = 0;
    for (let yy = y; yy < Math.min(y + 16, box[3]); yy++) for (let xx = x; xx < Math.min(x + 16, box[2]); xx++) {
      const i = (yy * 1080 + xx) * 3;
      if ([0, 1, 2].some(k => Math.abs(actual[i + k] - reference[i + k]) > 24)) changed++;
      count++;
    }
    if (changed / count > .08) return false;
  }
  return true;
}

/** Captured 145/172/174/179 share the dark slot [903,1333,1036,1356).
 * Its inset yellow fill grows horizontally; shell and slot rim stay static. */
function matchesProgressBadge(actual: Buffer, reference: Buffer): boolean {
  const normalized = Buffer.from(actual);
  const rows: { left: number; right: number }[] = [];
  for (let y = 1336; y < 1353; y++) {
    let left = -1, right = -1, ended = false;
    for (let x = 906; x < 1033; x++) {
      const i = (y * 1080 + x) * 3;
      // Only the captured dark red -> yellow blend is legal, including AA.
      // Neutral obstructions and red shell painted into the track reject.
      const t = Math.max(0, Math.min(1, (actual[i + 1] - 9) / 224));
      if (Math.abs(actual[i] - (152 + 102 * t)) > 24
        || Math.abs(actual[i + 2] - (17 + 10 * t)) > 24) return false;
      const yellow = actual[i] > 180 && actual[i + 1] > 140 && actual[i + 2] < 100;
      if (yellow) {
        if (ended) return false;
        if (left < 0) left = x;
        right = x;
      } else if (left >= 0) ended = true;
      reference.copy(normalized, i, i, i + 3);
    }
    if (left < 906 || left > 912 || right < left) return false;
    rows.push({ left, right });
  }
  // Rounded, vertically symmetric, left-anchored connected fill, never a box.
  for (let n = 0; n < rows.length; n++) {
    const a = rows[n], mirror = rows[16 - n];
    if (Math.abs(a.left - mirror.left) > 1 || Math.abs(a.right - mirror.right) > 1) return false;
    if (n > 0 && n <= 8 && (a.left > rows[n - 1].left || a.right < rows[n - 1].right)) return false;
  }
  if (rows[8].left !== 906 || rows[0].left <= rows[8].left || rows[0].right >= rows[8].right) return false;
  return matches(normalized, reference, [878, 1230, 1060, 1376]);
}

/** Transparent controls bind foreground geometry, not the video behind it. */
function matchesControl(actual: Buffer, reference: Buffer, box: number[], coin: boolean): boolean {
  const foreground = (b: Buffer, i: number) => coin
    ? b[i] > 180 && b[i + 1] > 140 && b[i + 2] < 100
    : b[i] > 180 && b[i + 1] > 180 && b[i + 2] > 180;
  // White video pixels are not extra arrow strokes. Bind the captured glyph's
  // signed local edges instead: a flat white/black/gray obstruction has none.
  // Yellow chroma separates coin edges from neutral video backgrounds.
  const strength = (b: Buffer, i: number) => coin
    ? Math.min(b[i], b[i + 1]) - b[i + 2]
    : Math.min(b[i], b[i + 1], b[i + 2]);
  let expected = 0, present = 0, edges = 0, visibleEdges = 0;
  for (let y = box[1]; y < box[3]; y++) for (let x = box[0]; x < box[2]; x++) {
    const i = (y * 1080 + x) * 3;
    if (!foreground(reference, i)) continue;
    expected++;
    if (foreground(actual, i)) present++;
    for (const [dx, dy] of [[-4, 0], [4, 0], [0, -4], [0, 4]]) {
      if (x + dx < box[0] || x + dx >= box[2] || y + dy < box[1] || y + dy >= box[3]) continue;
      const j = ((y + dy) * 1080 + x + dx) * 3;
      if (foreground(reference, j) || strength(reference, i) - strength(reference, j) < 24) continue;
      edges++;
      if (strength(actual, i) - strength(actual, j) >= 8) visibleEdges++;
    }
  }
  return expected > 0 && present / expected >= .95 && edges > 0 && visibleEdges / edges >= .95;
}

/** Current component observation only. Preserve exact same-frame saved/raw
 * binding; no historical video, merchandise, price or shell equality. No
 * synthetic completed50 source is promoted. Caller owns attempt/transition,
 * current capture age, total wait budget, receipt attribution and settlement. */
export async function inspectCurrentImmersiveBrowse(frame: DeviceFrame, owner: Owner,
  requirement: ImmersiveBrowseRequirement = { rewardCoins: 20 }): Promise<ImmersiveBrowseInspection | null> {
  try {
    const rewardCoins = requirement?.rewardCoins;
    if (![20, 35, 50].includes(rewardCoins) || owner?.package !== 'com.taobao.taobao'
      || !Number.isSafeInteger(owner.userId) || owner.userId < 0 || frame?.package !== owner.package
      || frame.userId !== owner.userId || frame.observationError || frame.width !== 1080 || frame.height !== 2400
      || typeof frame.id !== 'string' || !frame.id.trim() || !Number.isSafeInteger(frame.capturedAt)
      || typeof frame.path !== 'string' || !frame.path.endsWith('.png') || !Array.isArray(frame.lines) || !frame.lines.length
      || frame.lines.some(l => typeof l?.text !== 'string' || !Array.isArray(l.bounds) || l.bounds.length !== 4
        || !l.bounds.every(Number.isFinite) || l.bounds[0] < 0 || l.bounds[1] < 0 || l.bounds[2] > 1080 || l.bounds[3] > 2400
        || l.bounds[0] >= l.bounds[2] || l.bounds[1] >= l.bounds[3])) return null;
    const [saved, rawBytes] = await Promise.all([readFile(frame.path.replace(/\.png$/, '.json')), readFile(frame.path.replace(/\.png$/, '.ocr.json'))]);
    const raw = JSON.parse(rawBytes.toString()), page = raw.pages?.[0];
    if (!isDeepStrictEqual(JSON.parse(saved.toString()), frame) || raw.engine !== 'Apple Vision VNRecognizeTextRequest'
      || raw.languageCorrection !== false || !isDeepStrictEqual(raw.languages, ['zh-Hans', 'en-US'])
      || raw.pages.length !== 1 || page.file !== frame.path || page.width !== 1080 || page.height !== 2400 || page.revision !== 3
      || !Array.isArray(page.lines) || page.lines.length !== frame.lines.length
      || page.lines.some((l: DeviceFrame['lines'][number], i: number) => l?.text !== frame.lines[i].text
        || !Array.isArray(l.bounds) || l.bounds.length !== 4 || l.bounds.some((v, k) => !Number.isFinite(v)
          || v < -.001 || v > (k % 2 ? 2400 : 1080) + .001
          || frame.lines[i].bounds[k] !== Math.max(0, Math.min(k % 2 ? 2400 : 1080, v))))) return null;
    if (/任务列表|赚金币抵钱|去完成|登[录陆]|验证|授权|允许|同意|隐私|温馨提示|确认|取消|当前页下单|再得500金币/.test(frame.lines.map(l => norm(l.text)).join(''))) return null;
    const receipts = frame.lines.filter(l => /已得/.test(norm(l.text)));
    const rewards = frame.lines.filter(l => /^得/.test(norm(l.text)));
    const browse = frame.lines.filter(l => /浏览/.test(norm(l.text)));
    const done = receipts.length === 1;
    if (done ? rewardCoins === 50 || norm(receipts[0].text) !== `已得${rewardCoins}` || rewards.length
        || browse.length !== (rewardCoins === 35 ? 1 : 0)
      : receipts.length || rewards.length !== 1 || norm(rewards[0].text) !== `得${rewardCoins}` || browse.length !== 1) return null;
    if (browse.some(l => norm(l.text) !== '浏览') || frame.lines.some(l => {
      const t = norm(l.text);
      return /得\d/.test(t) && !/^(?:已)?得\d+$/.test(t) && !/^下单(?:再)?得500[.円m]?$/.test(t);
    })) return null;
    const component = done ? receipts[0] : rewards[0];
    if (browse.length) {
      const a = browse[0].bounds, b = component.bounds;
      if (Math.abs((a[0] + a[2]) - (b[0] + b[2])) > 50 || b[1] < a[3] - 4 || b[1] - a[3] > 45) return null;
    }
    const actual = await pixels(frame.path);
    const refs = immersiveBrowseSource.files;
    const sourcePair = done ? rewardCoins === 35 ? [refs.completed35Png, refs.completed35Frame] : [refs.completedPng, refs.completedFrame]
      : rewardCoins === 35 ? [refs.browsing35Png, refs.browsing35Frame]
      : rewardCoins === 50 ? [refs.browsing50Png, refs.browsing50Frame] : [refs.browsingPng, refs.browsingFrame];
    for (const s of sourcePair) if (createHash('sha256').update(await readFile(new URL('../../' + s.path, import.meta.url))).digest('hex') !== s.sha256) return null;
    // Current text visibility: every short component needs real contrast.
    for (const l of [...browse, component]) {
      let low = 255, high = 0;
      const b = l.bounds;
      for (let y = Math.ceil(b[1]); y < Math.floor(b[3]); y++) for (let x = Math.ceil(b[0]); x < Math.floor(b[2]); x++) {
        const i = (y * 1080 + x) * 3, v = (actual[i] + actual[i + 1] + actual[i + 2]) / 3;
        low = Math.min(low, v); high = Math.max(high, v);
      }
      // Red/yellow completed35 text has luminance contrast 49 on its
      // captured badge; chroma remains strong despite similar luminance.
      if (high - low < 40) return null;
      let blank = 0;
      for (let x = Math.ceil(b[0]); x < Math.floor(b[2]); x++) {
        let lo = 255, hi = 0;
        for (let y = Math.ceil(b[1]); y < Math.floor(b[3]); y++) {
          const i = (y * 1080 + x) * 3, v = (actual[i] + actual[i + 1] + actual[i + 2]) / 3;
          lo = Math.min(lo, v); hi = Math.max(hi, v);
        }
        blank = hi - lo < 25 ? blank + 1 : 0;
        if (blank > (b[3] - b[1]) * .8) return null;
      }
    }
    const version = 'immersive-browse-current-components-v1';
    return done ? { state: 'completed', version, rewardCoins, quote: component.text }
      : { state: 'browsing', version, rewardCoins, waitMs: 3000 };
  } catch { return null; }
}

/** Local component observation only. Caller binds the actual selected entry,
 * task attempt, capture freshness, observation budget, return and settlement.
 * Runtime opt-in version is immersive-browse-candidate-v2. The optional third
 * argument binds rewardCoins from the current component or complete scenario;
 * omitted arguments retain the historical 20-coin requirement. The optional
 * fourth quality argument is independently rederived from the original files;
 * it supplies raw safety/amount text and strictly valid geometry separately.
 * It never replaces the capture or clears its original observationError.
 * Task names and task-list reward guesses supply no amount authority.
 * Exported async function can be injected directly as opts.inspectImmersiveBrowse.
 * Accumulate dispatched waits against waitPolicy.maxMs; never turn elapsed time
 * into a receipt. No tap/swipe/purchase/follow action is proposed here.
 *
 * This candidate supports captured 20/50 and real 191 browsing35 glyphs and the
 * distinct real 184 completed35 layout (retained 浏览, lower 已得35).
 * Explicit 35 supplies offline component recognition only: no amount-change authorization,
 * runtime opt-in or task-attempt authority; the caller owns its allowed amounts.
 * Completed50 placement is synthetic, not a real receipt source.
 * Changed layout/theme, unsupported amounts, moved pixels, OCR loss and the
 * historical order-only promotion frame return null. Video content/creator are
 * unconstrained. Overlays wholly inside video cannot be excluded from pixels
 * alone; visible blocked UI and obstructed component/control pixels reject.
 * Null supplies no completion or action authority;
 * the caller owns any separately authorized bounded navigation observation. */
export async function inspectImmersiveBrowse(frame: DeviceFrame, owner: Owner,
  requirement: ImmersiveBrowseRequirement = { rewardCoins: 20 },
  quality?: ImmersiveOcrQuality): Promise<ImmersiveBrowseInspection | null> {
  try {
    // Only amounts backed by captured glyphs are supported; never infer from a task name.
    const rewardCoins = requirement?.rewardCoins;
    if (rewardCoins !== 20 && rewardCoins !== 50 && rewardCoins !== 35) return null;
    // An explicit sidecar is always rederived from the original files, even for
    // an otherwise normal frame. Never clear its error or construct a replacement frame.
    const verified = quality === undefined ? undefined
      : await verifyImmersiveOcrQuality(frame, { rewardCoins }, quality);
    if (quality !== undefined && !verified) return null;
    const geometryLines = verified ? verified.validIndices.map(i => verified.rawLines[i]) : frame?.lines;
    const rawLines = verified ? verified.rawLines : frame?.lines;
    if (!owner || owner.package !== 'com.taobao.taobao' || !Number.isSafeInteger(owner.userId) || owner.userId < 0
      || !frame || frame.package !== owner.package || frame.userId !== owner.userId || (frame.observationError && !verified)
      || frame.width !== 1080 || frame.height !== 2400 || typeof frame.id !== 'string' || !frame.id.trim() || !Number.isSafeInteger(frame.capturedAt)
      || typeof frame.path !== 'string' || !Array.isArray(geometryLines) || !geometryLines.length
      || !geometryLines.every(l => typeof l?.text === 'string' && Array.isArray(l.bounds) && l.bounds.length === 4
        && l.bounds.every(Number.isFinite) && l.bounds[0] >= 0 && l.bounds[1] >= 0 && l.bounds[2] <= 1080
        && l.bounds[3] <= 2400 && l.bounds[0] < l.bounds[2] && l.bounds[1] < l.bounds[3])) return null;
    if (rawLines.some(l => /任务列表|赚金币抵钱|去完成|登[录陆]|安全验证|验证码|授权|允许访问|隐私政策|温馨提示|确定要离开|确认|取消|当前页下单|再得500金币/.test(norm(l.text)))) return null;
    const receipts = geometryLines.filter(l => norm(l.text) === `已得${rewardCoins}`);
    const browsing = geometryLines.filter(l => norm(l.text) === '浏览');
    const rewards = geometryLines.filter(l => norm(l.text) === `得${rewardCoins}`);
    const done = receipts.length === 1;
    // Only the real 184 completed35 layout retains 浏览 above its receipt.
    const retainedBrowse = rewardCoins === 35 && done;
    if (rawLines.filter(l => /^得\d+$/.test(norm(l.text))).length !== (done ? 0 : 1)) return null;
    if (rawLines.filter(l => /已得/.test(norm(l.text))).length !== (done ? 1 : 0)) return null;
    if (done ? browsing.length !== (retainedBrowse ? 1 : 0) || rewards.length
      : receipts.length || browsing.length !== 1 || rewards.length !== 1) return null;
    const near = (bounds: number[], expected: number[]) => bounds.every((v, i) => Math.abs(v - expected[i]) <= 8);
    if (done ? !near(receipts[0].bounds, retainedBrowse ? [920, 1297, 1021, 1329] : [920, 1270, 1014, 1301])
      || (retainedBrowse && !near(browsing[0].bounds, [934, 1263, 996, 1294]))
      : !near(browsing[0].bounds, [934, 1263, 996, 1294]) || !near(rewards[0].bounds, [930, 1298, 1007, 1329])) return null;
    const actual = await pixels(frame.path);
    const reference = await pixels(rewardCoins === 35 && !done
      ? new URL('../../' + immersiveBrowseSource.files.browsing35Png.path, import.meta.url).pathname
      : retainedBrowse
      ? new URL('../../evidence/staged-2026-11-01T10-35-22-744Z/33f7f285-7248-432d-8040-13aded9e3ebf.png', import.meta.url).pathname
      : new URL(done ? 'bac64856-dcf1-4bf4-9db9-fe960e2af71d.png'
        : rewardCoins === 50 ? '50a8f18d-ec2e-47ed-a615-6ca435769c67.png'
        : 'fb612cbe-6736-4d77-8463-fc7848c70ce0.png', !done && rewardCoins === 50 ? fiftyHistory : history).pathname);
    if (done && rewardCoins === 50) {
      // Project only the captured amount glyphs into the completed badge.
      // This is synthetic layout support, not evidence of a completed50 run.
      // Compare every pixel of the resulting badge, including the full 已得 word.
      const amountReference = await pixels(new URL('50a8f18d-ec2e-47ed-a615-6ca435769c67.png', fiftyHistory).pathname);
      for (let y = 0; y < 26; y++) {
        const from = ((1296 + y) * 1080 + 972) * 3;
        const to = ((1269 + y) * 1080 + 981) * 3;
        amountReference.copy(reference, to, from, from + 35 * 3);
      }
    }
    // Static shell and the complete red/yellow badge establish component layout.
    // The coin, promotion, and lower controls are evidence only; never actions.
    // Keep completed badges fully static; only browsing has a progress track.
    let shellMatches = matches(actual, reference, [316, 1924, 1040, 2030]);
    if (!shellMatches && rewardCoins === 50 && !done) {
      // The added reference grants browsing layout only, never a control click or receipt.
      const refs = immersiveBrowseSource.files;
      for (const source of [refs.browsing50DetailsShellPng, refs.browsing50DetailsShellFrame]) {
        const bytes = await readFile(new URL('../../' + source.path, import.meta.url));
        if (createHash('sha256').update(bytes).digest('hex') !== source.sha256) return null;
      }
      const shell = await pixels(new URL('../../' + refs.browsing50DetailsShellPng.path, import.meta.url).pathname);
      shellMatches = matches(actual, shell, [316, 1924, 1040, 2030]);
    }
    if (!shellMatches
      || (rewardCoins === 35 && !done && (!matches(actual, reference, [34, 1640, 202, 1704])
        || !matches(actual, reference, [892, 1640, 1048, 1704])))
      || !(done ? matches(actual, reference, [878, 1230, 1060, 1376])
        : matchesProgressBadge(actual, reference))) return null;
    if (!matchesControl(actual, reference, [48, 136, 80, 184], false)
      || !matchesControl(actual, reference, [910, 1100, 980, 1210], true)) return null;

    return done ? { state: 'completed', version: VERSION, rewardCoins, quote: receipts[0].text }
      : { state: 'browsing', version: VERSION, rewardCoins, waitMs: 3000 };
  } catch { return null; }
}
