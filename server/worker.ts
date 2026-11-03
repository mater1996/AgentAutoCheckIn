/** Explicit standalone worker. No worker or timer starts when this module is imported. */
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { createJobQueue } from './jobs';
import type { Job } from './jobs';

type Queue = ReturnType<typeof createJobQueue>;
export type JobExecutor = (job: Job, payload: Record<string, any>) => Promise<any>;

async function executePhoneJob(job: Job, payload: Record<string, any>) {
  // Runner public entry points own the shared device lock. Do not wrap again here.
  if (job.kind === 'plan') {
    const { collectAndPlan } = await import('../runner/collect');
    return collectAndPlan({ activityId: job.activity_id, skip: payload.skip });
  }
  if (job.kind === 'run') {
    const { runActivity } = await import('../runner/signin');
    return runActivity({ activityId: job.activity_id, coldStart: true, cacheStrategy: 'read-write' });
  }
  throw new Error(`unsupported job kind: ${job.kind}`);
}

export function createJobWorker(queue: Queue, execute: JobExecutor = executePhoneJob) {
  let busy = false;
  return {
    async consumeNext(): Promise<boolean> {
      if (busy) return false;
      busy = true;
      let heartbeat: ReturnType<typeof setInterval> | undefined;
      try {
        const job = queue.claim();
        if (!job) return false;
        heartbeat = setInterval(() => queue.heartbeat(job), 5000);
        heartbeat.unref();
        let result: any = null;
        let error: string | undefined;
        try {
          queue.validateTarget(job.activity_id, job.account_id);
          const payload = JSON.parse(job.payload || '{}');
          if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('invalid job payload');
          result = await execute(job, payload);
        } catch (e: any) {
          error = String(e?.message ?? e).slice(0, 500);
          // Runners may attach a real runId when throwing after creating the ledger row.
          result = Number.isSafeInteger(e?.runId) ? { ok: false, runId: e.runId } : null;
        }
        try {
          queue.finish(job, result, error);
        } catch (e: any) {
          // An invalid association must not strand a running row. The lease guard
          // still prevents this fallback from modifying another owner's job.
          queue.finish(job, null, String(e?.message ?? e).slice(0, 500));
        }
        return true;
      } finally {
        if (heartbeat) clearInterval(heartbeat);
        busy = false;
      }
    },
  };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.some((arg) => !['--once', '--drain'].includes(arg)) || args.length > 1) throw new Error('usage: tsx server/worker.ts [--once|--drain]');
  const { sqlite, dbPath } = await import('../db/client');
  const queue = createJobQueue(sqlite);
  const worker = createJobWorker(queue);
  let stop = false;
  const controller = new AbortController();
  const halt = () => { stop = true; controller.abort(); };
  process.once('SIGTERM', halt);
  process.once('SIGINT', halt);
  try {
    const interrupted = queue.recoverInterrupted();
    console.log(`worker pid=${process.pid} DB=${dbPath}; interrupted=${interrupted}`);
    while (!stop) {
      const consumed = await worker.consumeNext();
      if (args.includes('--once') || (args.includes('--drain') && !consumed)) break;
      if (!consumed) await delay(1000, undefined, { signal: controller.signal }).catch((e) => { if (e.name !== 'AbortError') throw e; });
    }
  } finally {
    process.removeListener('SIGTERM', halt);
    process.removeListener('SIGINT', halt);
    sqlite.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(e); process.exitCode = 1; });
}
