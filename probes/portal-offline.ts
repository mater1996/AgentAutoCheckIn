import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assessPortalObservation, extractPortalRows } from '../runner/portal-observation';

// Offline replay only: no device imports, model requests or balance writes.
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const source = path.resolve(root, process.argv[2] || 'evidence/portal-readonly-2026-10-31/panel-settled-state.txt');
const raw = fs.readFileSync(source, 'utf8');
const envelope = JSON.parse(raw.includes('result=') ? raw.split('result=')[1] : raw);
const state = typeof envelope.result === 'string' ? JSON.parse(envelope.result) : envelope.result;
const rules = {
  panelText: '赚金币抵钱', titlePattern: '^(.+)[(]([0-9]+)/([0-9]+)[)]$',
  buttonTexts: ['领取奖励', '去完成', '去逛逛', '逛一逛'],
};
const report = {
  mode: 'offline-replay', source,
  sourceMetadata: { degraded: state.degraded, degradedReason: state.degradedReason, snapshotAgeMs: state.snapshotAgeMs },
  rows: extractPortalRows(state, rules),
  actionPermission: assessPortalObservation({
    state, capturedAt: 0, now: 0, maxAgeMs: 2000,
    expectedPackage: 'com.taobao.taobao', foregroundPackage: '',
    expectedText: rules.panelText, screenConfirmed: false,
  }),
  executionAllowed: false,
};
console.log(JSON.stringify(report, null, 2));
