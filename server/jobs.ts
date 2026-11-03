/** Persistent queue. Enqueue never imports or invokes a phone runner. */
import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';

export function isProcessAlive(pid: number | null): boolean {
  if (!pid || !Number.isSafeInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; }
  catch (e: any) { return e.code !== 'ESRCH'; }
}

export class JobInputError extends Error {}
export type JobKind = 'plan' | 'run';
export type EnqueueInput = {
  kind: JobKind;
  activityId: string;
  accountId?: string | null;
  payload?: Record<string, unknown>;
  // Phone actions are never automatically retried, including collection/navigation.
  maxAttempt: 1;
};
export type Job = {
  id: number; kind: JobKind; activity_id: string; account_id: string;
  status: string; attempt: number; max_attempt: number; payload: string;
  lease_token: string | null; worker_pid: number | null; run_id: number | null;
};

export function createJobQueue(sqlite: Database.Database) {
  function validateTarget(activityId: string, accountId?: string | null) {
    const target = sqlite.prepare(`SELECT a.account_id FROM activity a JOIN account ac ON ac.id=a.account_id WHERE a.id=?`).get(activityId) as { account_id: string } | undefined;
    if (!target) throw new JobInputError(`activity/account not found: ${activityId}`);
    if (accountId && accountId !== target.account_id) throw new JobInputError('account does not own activity');
    return target.account_id;
  }
  const recoverInterrupted = sqlite.transaction(() => {
    let count = 0;
    for (const row of sqlite.prepare("SELECT id, worker_pid FROM job WHERE status='running'").all() as Job[]) {
      // Do not expire a live worker by age: a phone action may still be in progress.
      if (!isProcessAlive(row.worker_pid)) {
        count += sqlite.prepare(`UPDATE job SET status='interrupted',stage='interrupted',
          error='Worker exited during execution; manual review required, no automatic retry',finished_at=?,lease_token=NULL
          WHERE id=? AND status='running'`).run(new Date().toISOString(), row.id).changes;
      }
    }
    return count;
  });
  const claim = sqlite.transaction((): Job | null => {
    recoverInterrupted();
    if (sqlite.prepare("SELECT 1 FROM job WHERE status='running' LIMIT 1").get()) return null;
    const row = sqlite.prepare("SELECT * FROM job WHERE status='queued' AND attempt < max_attempt ORDER BY id LIMIT 1").get() as Job | undefined;
    if (!row) return null;
    const now = new Date().toISOString();
    const token = randomUUID();
    sqlite.prepare(`UPDATE job SET status='running',stage='running',attempt=attempt+1,
      started_at=?,worker_pid=?,lease_token=?,heartbeat_at=? WHERE id=? AND status='queued'`).run(now, process.pid, token, now, row.id);
    return sqlite.prepare('SELECT * FROM job WHERE id=?').get(row.id) as Job;
  });
  function finish(job: Job, result: any, error?: string) {
    const runId = Number.isSafeInteger(result?.runId) && result.runId > 0 ? result.runId : null;
    if (runId !== null) {
      const run = sqlite.prepare('SELECT account_id,activity_id FROM run WHERE id=?').get(runId) as any;
      if (!run || run.account_id !== job.account_id || run.activity_id !== job.activity_id) throw new Error('runId does not belong to job activity/account');
    }
    const failed = !!error || result?.ok === false;
    const updated = sqlite.prepare(`UPDATE job SET status=?,stage=?,result=?,error=?,run_id=?,finished_at=?,lease_token=NULL
      WHERE id=? AND status='running' AND lease_token=? AND worker_pid=?`).run(
      failed ? 'failed' : 'done', error ? 'error' : (result?.status ?? 'done'), JSON.stringify(result ?? null),
      error ?? null, runId, new Date().toISOString(), job.id, job.lease_token, process.pid,
    );
    if (updated.changes !== 1) throw new Error('job lease lost; refusing to finish');
  }
  return {
    validateTarget,
    recoverInterrupted: () => recoverInterrupted.immediate(),
    claim: () => claim.immediate(),
    finish,
    heartbeat(job: Job) {
      return sqlite.prepare("UPDATE job SET heartbeat_at=? WHERE id=? AND status='running' AND lease_token=? AND worker_pid=?")
        .run(new Date().toISOString(), job.id, job.lease_token, process.pid).changes === 1;
    },
    enqueue(input: EnqueueInput): number {
      if (!['run', 'plan'].includes(input.kind)) throw new JobInputError('invalid job kind');
      if (input.maxAttempt !== 1) throw new JobInputError('maxAttempt must be 1; automatic phone retries are disabled');
      const accountId = validateTarget(input.activityId, input.accountId);
      const result = sqlite.prepare(`INSERT INTO job(kind,account_id,activity_id,status,attempt,max_attempt,payload,created_at,stage)
        VALUES(?,?,?,'queued',0,?,?,?,'queued')`).run(input.kind, accountId, input.activityId, input.maxAttempt, JSON.stringify(input.payload ?? {}), new Date().toISOString());
      return Number(result.lastInsertRowid);
    },
  };
}
