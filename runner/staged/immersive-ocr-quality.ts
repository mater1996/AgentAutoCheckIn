import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';
import type { DeviceFrame } from './device.ts';

export const IMMERSIVE_OCR_QUALITY_VERSION = 'immersive-ocr-quality-v1-left3' as const;
export type ImmersiveOcrQualityRequirement = { rewardCoins: 20 | 35 | 50 };
type RawLine = DeviceFrame['lines'][number] & { confidence?: number; [key: string]: unknown };
export type ImmersiveOcrProtectedRegion = { name: string; bounds: number[] };
export type ImmersiveOcrInvalidLine = {
  index: number; text: string; bounds: number[]; geometryValid: false;
  reason: 'noncritical-left-edge'; overshootPx: number[]; intersects: string[];
};
/** Serializable evidence only. Neither this object nor accepted flags confer action authority. */
export type ImmersiveOcrQuality = {
  version: typeof IMMERSIVE_OCR_QUALITY_VERSION;
  frameId: string; path: string; capturedAt: number; package: 'com.taobao.taobao'; userId: 0;
  sourcePngSha256: string; sourceFrameJsonPath: string; sourceFrameJsonSha256: string;
  rawOcrPath: string; rawOcrSha256: string;
  engine: 'Apple Vision VNRecognizeTextRequest'; revision: 3;
  languages: string[]; languageCorrection: false;
  requirement: ImmersiveOcrQualityRequirement;
  protectedRegions: ImmersiveOcrProtectedRegion[];
  rawLines: RawLine[]; validIndices: number[]; invalidLines: ImmersiveOcrInvalidLine[];
};
const norm = (s: string) => s.normalize('NFKC').replace(/\s/g, '');
const risk = /任务列表|赚金币抵钱|去完成|登[录陆]|验证|验证码|授权|允许|隐私|温馨提示|确定要离开|确认|取消|同意|当前页下单|再得500金币/;
const critical = /浏览|已得|得\d|收益|奖励|金币|任务|完成/;
const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const intersects = (a: number[], b: number[]) => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];

/** Pure offline derivation: no capture, OCR rerun, clamping, timestamp refresh or source writes.
 * Only an original owner-u0 capture with the exact bounds failure may use this version.
 * All raw text survives; only strict in-page rows can supply component geometry. */
export async function deriveImmersiveOcrQuality(frame: DeviceFrame,
  requirement: ImmersiveOcrQualityRequirement): Promise<ImmersiveOcrQuality | null> {
  try {
    if (!frame || frame.observationError !== 'OCR capture failed: Invalid OCR frame or bounds'
      || frame.package !== 'com.taobao.taobao' || frame.userId !== 0 || frame.width !== 1080 || frame.height !== 2400
      || typeof frame.id !== 'string' || !frame.id.trim() || !Number.isSafeInteger(frame.capturedAt)
      || typeof frame.path !== 'string' || !frame.path.endsWith('.png') || !Array.isArray(frame.lines) || frame.lines.length
      || !requirement || ![20, 35, 50].includes(requirement.rewardCoins)) return null;
    const sourceFrameJsonPath = frame.path.replace(/\.png$/, '.json');
    const rawOcrPath = frame.path.replace(/\.png$/, '.ocr.json');
    const [png, frameBytes, rawBytes] = await Promise.all([readFile(frame.path), readFile(sourceFrameJsonPath), readFile(rawOcrPath)]);
    if (!isDeepStrictEqual(JSON.parse(frameBytes.toString('utf8')), frame)) return null;
    const sharp = (await import('sharp')).default;
    const image = sharp(png, { failOn: 'warning', limitInputPixels: 1080 * 2400 });
    const meta = await image.metadata();
    if (meta.format !== 'png' || meta.width !== 1080 || meta.height !== 2400 || (meta.pages ?? 1) !== 1) return null;
    await image.raw().toBuffer(); // Decode original bytes as well as checking the header.
    const raw = JSON.parse(rawBytes.toString('utf8'));
    if (raw?.engine !== 'Apple Vision VNRecognizeTextRequest' || raw.languageCorrection !== false
      || !Array.isArray(raw.languages) || !isDeepStrictEqual(raw.languages, ['zh-Hans', 'en-US'])
      || !Array.isArray(raw.pages) || raw.pages.length !== 1) return null;
    const page = raw.pages[0];
    if (page?.file !== frame.path || page.width !== 1080 || page.height !== 2400 || page.revision !== 3
      || !Array.isArray(page.lines) || !page.lines.length) return null;
    const rawLines: RawLine[] = page.lines;
    if (rawLines.some(l => !l || typeof l.text !== 'string' || !norm(l.text) || !Array.isArray(l.bounds)
      || l.bounds.length !== 4 || !l.bounds.every(v => typeof v === 'number' && Number.isFinite(v))
      || l.bounds[0] >= l.bounds[2] || l.bounds[1] >= l.bounds[3])) return null;
    const texts = rawLines.map(l => norm(l.text));
    if (texts.some(t => risk.test(t)) || risk.test(texts.join(''))) return null;
    // Critical tokens spanning OCR rows are ambiguity, even if one row has no geometry.
    const joined = texts.join('');
    const boundaries = new Set<number>();
    let end = 0;
    for (const text of texts.slice(0, -1)) { end += text.length; boundaries.add(end); }
    for (const match of joined.matchAll(/浏览|已得\d*|得\d+/g)) {
      if ([...boundaries].some(b => b > match.index! && b < match.index! + match[0].length)) return null;
    }
    if (texts.some(t => (/得\d/.test(t) && !/^(?:已)?得\d+$/.test(t) && !/^下单(?:再)?得500$/.test(t))
      || (/^得/.test(t) && !/^得\d+$/.test(t))
      || (/已得/.test(t) && !/^已得\d+$/.test(t)) || (/浏览/.test(t) && t !== '浏览'))) return null;
    const protectedRegions: ImmersiveOcrProtectedRegion[] = [
      { name: 'badge', bounds: [878, 1230, 1060, 1376] },
      { name: 'back', bounds: [48, 136, 80, 184] },
      { name: 'coin', bounds: [910, 1100, 980, 1210] },
      { name: 'shell', bounds: [316, 1924, 1040, 2030] },
    ];
    if (requirement.rewardCoins === 35) protectedRegions.push(
      { name: 'promotionLeft', bounds: [34, 1640, 202, 1704] },
      { name: 'promotionRight', bounds: [892, 1640, 1048, 1704] },
    );
    const validIndices: number[] = [], invalidLines: ImmersiveOcrInvalidLine[] = [];
    for (const [index, line] of rawLines.entries()) {
      const b = line.bounds;
      const overshootPx = [Math.max(0, -b[0]), Math.max(0, -b[1]), Math.max(0, b[2] - 1080), Math.max(0, b[3] - 2400)];
      if (!overshootPx.some(v => v > 0)) { validIndices.push(index); continue; }
      const hits = protectedRegions.filter(r => intersects(b, r.bounds)).map(r => r.name);
      if (b[0] < -3 || b[0] >= 0 || b[1] < 0 || b[2] <= 0 || b[2] > 1080 || b[3] > 2400
        || hits.length || critical.test(texts[index])) return null;
      invalidLines.push({ index, text: line.text, bounds: b, geometryValid: false,
        reason: 'noncritical-left-edge', overshootPx, intersects: hits });
    }
    // The exact original failure must have a genuine beyond-device-tolerance cause.
    if (!invalidLines.some(l => l.overshootPx[0] > .001)) return null;
    return {
      version: IMMERSIVE_OCR_QUALITY_VERSION, frameId: frame.id, path: frame.path, capturedAt: frame.capturedAt,
      package: 'com.taobao.taobao', userId: 0, sourcePngSha256: sha(png), sourceFrameJsonPath,
      sourceFrameJsonSha256: sha(frameBytes), rawOcrPath, rawOcrSha256: sha(rawBytes),
      engine: raw.engine, revision: page.revision, languages: raw.languages, languageCorrection: false,
      requirement: { rewardCoins: requirement.rewardCoins }, protectedRegions, rawLines, validIndices, invalidLines,
    };
  } catch { return null; }
}

/** Re-read source bytes; never use fields from a submitted sidecar as derivation inputs. */
export async function rederiveImmersiveOcrQuality(frame: DeviceFrame,
  requirement: ImmersiveOcrQualityRequirement): Promise<ImmersiveOcrQuality | null> {
  return deriveImmersiveOcrQuality(frame, requirement);
}

/** Return independently recomputed evidence only when the entire submitted value matches. */
export async function verifyImmersiveOcrQuality(frame: DeviceFrame,
  requirement: ImmersiveOcrQualityRequirement, quality: unknown): Promise<ImmersiveOcrQuality | null> {
  const derived = await rederiveImmersiveOcrQuality(frame, requirement);
  return derived && isDeepStrictEqual(quality, derived) ? derived : null;
}
