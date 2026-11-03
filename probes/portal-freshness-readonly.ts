import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { withDeviceLock } from '../runner/device-lock.ts';
import { parsePortalEnvelope } from '../runner/portal-client.ts';
const exec = promisify(execFile);
const out = path.resolve('evidence/portal-freshness-' + new Date().toISOString().replace(/[:.]/g, '-'));
fs.mkdirSync(out, { recursive: true });
await withDeviceLock(async () => {
  const adb = async (...args: string[]) => (await exec('adb', ['-s', '3d8a7934', ...args], { timeout: 22000, maxBuffer: 8 * 1024 * 1024 })).stdout;
  const foreground = async (label: string) => {
    const raw = await adb('shell', 'dumpsys', 'activity', 'activities');
    const lines = raw.split('\n').filter(l => /topResumedActivity|mResumedActivity/.test(l));
    fs.writeFileSync(path.join(out, label + '-foreground.txt'), lines.join('\n'));
    return lines;
  };
  const shot = async (label: string) => {
    const { stdout } = await exec('adb', ['-s', '3d8a7934', 'exec-out', 'screencap', '-p'], { encoding: 'buffer', timeout: 15000, maxBuffer: 12 * 1024 * 1024 });
    fs.writeFileSync(path.join(out, label + '.png'), stdout);
  };
  const power = await adb('shell', 'dumpsys', 'power');
  fs.writeFileSync(path.join(out, 'power.txt'), power.split('\n').filter(l => /mWakefulness=|Display Power:|mIsPowered=/.test(l)).join('\n'));
  const before = await foreground('before'); await shot('before');
  const samples = [];
  for (const endpoint of ['state_full?filter=false', 'state_full?filter=false', 'state_full?filter=false', 'state_full?filter=false', 'state_full?filter=true', 'state_full?filter=true']) {
    const index: number = samples.length + 1, start = Date.now();
    try {
      const raw = await adb('shell', 'content', 'query', '--uri', 'content://com.mobilerun.portal/' + endpoint);
      const envelope = parsePortalEnvelope(raw);
      if (envelope.status !== 'success') throw Error('Portal reported error');
      fs.writeFileSync(path.join(out, `sample-${index}.json`), JSON.stringify(envelope.result, null, 2));
      const s: any = envelope.result;
      let count = 0; const texts: string[] = [];
      const visit = (n: any) => { if (!n || typeof n !== 'object') return; count++; if(n.text) texts.push(n.text); for(const c of n.children ?? []) visit(c); };
      visit(s.a11y_tree ?? s);
      samples.push({ index, endpoint, durationMs: Date.now()-start, degraded: s.degraded, degradedReason: s.degradedReason, snapshotAgeMs: s.snapshotAgeMs, package: s.phone_state?.packageName, nodes: count, panel: texts.includes('赚金币抵钱'), firstTexts: texts.slice(0, 10) });
    } catch { samples.push({ index, endpoint, durationMs: Date.now()-start, error: 'Read failed; raw error omitted' }); }
  }
  const after = await foreground('after'); await shot('after');
  const summary = { out, before, after, samples, phoneActions: 0 };
  fs.writeFileSync(path.join(out, 'summary.json'), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
});
