/**
 * 日志切片：记录每次运行前后的日志行号偏移，把全局日志切成按 run 的片段。
 *
 * 为什么需要：Midscene 的 log 是全局共享的单文件追加，不区分 run。
 * 不切片就无法回答"这次运行的搜一搜做了什么"。
 */
import fs from 'node:fs';
import path from 'node:path';
import {readStateFile,writeStateFile} from './storage/structured.ts';

const LOG_DIR = path.resolve('midscene_run', 'log');
const STATE = path.resolve('data', 'log-state.json');

export type LogMark = { file: string; offset: number };

/** 记录当前各日志文件的行数，作为基线 */
export function markLogs(): Record<string, number> {
  const marks: Record<string, number> = {};
  try {
    for (const f of fs.readdirSync(LOG_DIR)) {
      if (!f.endsWith('.log')) continue;
      const p = path.join(LOG_DIR, f);
      marks[f] = fs.readFileSync(p, 'utf8').split('\n').length;
    }
  } catch {}
  writeStateFile(STATE, marks);
  return marks;
}

export type SliceResult = {
  dir: string;
  files: string[];
  lines: number;
};

/** 从基线之后的部分切片，存到 data/logs/<runId>/ */
export function sliceLogs(runId: string): SliceResult {
  const outDir = path.resolve('data', 'logs', runId);
  fs.mkdirSync(outDir, { recursive: true });

  let marks: Record<string, number> = {};
  try {
    marks = readStateFile(STATE);
  } catch {}

  const files: string[] = [];
  let lines = 0;

  try {
    for (const f of fs.readdirSync(LOG_DIR)) {
      if (!f.endsWith('.log')) continue;
      const src = path.join(LOG_DIR, f);
      const all = fs.readFileSync(src, 'utf8').split('\n');
      const from = marks[f] ?? 0;
      const part = all.slice(from);
      if (part.length < 2) continue;

      const dst = path.join(outDir, f);
      fs.writeFileSync(dst, part.join('\n'), 'utf8');
      files.push(f);
      lines += part.length;
    }
  } catch {}

  return { dir: outDir, files, lines };
}