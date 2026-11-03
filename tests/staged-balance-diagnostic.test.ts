import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { readPanel } from '../runner/staged/observations.ts';

const load = (directory: string, id: string) => JSON.parse(fs.readFileSync(`evidence/${directory}/${id}.json`, 'utf8'));
const directory195 = 'staged-2026-11-01T11-56-23-111Z';
const final195 = () => load(directory195, '55b28a1a-f5f7-4939-9724-c478d02bf8ca');
const changeBalanceText = (text: string) => {
  const f = final195();
  return { ...f, lines: f.lines.map((l: any) => l.text === '）2155 無' ? { ...l, text } : l) };
};

// Explicit pending acceptance, not a safe regex fix: OcrFrame has no PNG bytes,
// so stale OCR on an occluded PNG is indistinguishable at this synchronous seam.
// Integrate a same-frame balance-component visibility/glyph gate at capture time,
// anchored to the owning activity/header; OCR only the integer subcomponent.
// Preserve its PNG/OCR identity and raw digits. Do not alias 無 or strip arbitrary
// text, join digit groups, infer income, or make readPanel asynchronous.
test('195 final original panel reads its raw integer without an OCR alias', {
  todo: 'Blocked: require same-frame component image evidence before accepting edge symbols',
}, () => {
  const f = final195();
  assert.equal(f.lines.find((l: any) => l.text === '）2155 無')?.text, '）2155 無');
  assert.equal(readPanel(f).balance, 2155);
});

test('193/194 real owning balances and alternate 195 capture remain readable', () => {
  const fixtures: [string, string, number][] = [
    ['staged-2026-11-01T11-46-47-689Z', '25811c26-a30c-4e73-8c1e-9b726e81e9f4', 2085],
    ['staged-2026-11-01T11-46-47-689Z', 'fdcbc6b8-2005-4d02-9534-ea9bd8a8d1a7', 2135],
    ['staged-2026-11-01T11-50-22-744Z', 'a7aaab9d-c2e8-4ac3-b3a0-0340f2d849c0', 2135],
    [directory195, 'da2f48b8-e8ff-4257-af6b-a53cf5e9bfff', 2155],
  ];
  for (const [directory, id, expected] of fixtures) assert.equal(readPanel(load(directory, id)).balance, expected, id);
});

for (const text of ['2155推广奖励', '2155 50', '2155.50', '2155-50']) {
  test(`balance rejects synthetic unsafe numeric prefix ${JSON.stringify(text)}`, {
    todo: 'Existing prefix parser accepts this; resolve with strict owning-component contract',
  }, () => assert.equal(readPanel(changeBalanceText(text)).balance, null));
}

test('negative integer and missing owning panel are rejected', () => {
  assert.equal(readPanel(changeBalanceText('-2155')).balance, null);
  const f = load(directory195, 'da2f48b8-e8ff-4257-af6b-a53cf5e9bfff');
  assert.equal(readPanel({ ...f, lines: f.lines.filter((l: any) => l.text !== '赚金币抵钱') }).balance, null);
});

test('occluded PNG cannot retain balance authority from unchanged OCR', {
  todo: 'OcrFrame contract has no image evidence; parent integration must supply a verified component gate',
}, () => {
  // Synthetic seam probe, not an independently captured occluded screenshot.
  // An invalid/missing PNG path deliberately retains all original OCR.
  const f = load(directory195, 'da2f48b8-e8ff-4257-af6b-a53cf5e9bfff');
  assert.equal(readPanel({ ...f, path: '/nonexistent/occluded.png' }).balance, null);
});
