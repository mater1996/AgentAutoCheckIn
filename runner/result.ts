export type RunEvidence = {
  before: number | null;
  after: number | null;
  failures: string[];
  verified: boolean;
  entryFailed?: boolean;
};

/** Cash/asset movement and workflow completion are separate facts. */
export function classifyRunResult(e: RunEvidence): string {
  const hasBefore = e.before !== null && Number.isFinite(e.before);
  const hasAfter = e.after !== null && Number.isFinite(e.after);
  const grew = hasBefore && hasAfter && e.after! > e.before!;
  if (e.failures.length && grew) return 'PARTIAL';
  if (grew) return 'OK';
  if (e.entryFailed) return 'NEEDS_HUMAN';
  if (e.failures.some((f) => f.includes('读数不可信'))) return 'BAD_READ';
  if (e.failures.length) return 'ERROR';
  if (!hasBefore || !hasAfter) return 'OBSERVATION_FAILED';
  if (e.verified) return 'ALREADY';
  return 'NO_EFFECT';
}
