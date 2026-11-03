export type TaskCounter = { name: string; done: number; total: number };

/** Compare independently observed counters; navigation or action success is insufficient. */
export function observeTaskChange(before: TaskCounter | null, after: TaskCounter | null): {
  status: 'completed' | 'no_effect' | 'unknown'; increment: number | null;
} {
  const valid = (v: TaskCounter | null) => v && typeof v.name === 'string' && v.name.trim() && Number.isInteger(v.done) && Number.isInteger(v.total) && v.total > 0 && v.done >= 0 && v.done <= v.total;
  if (!valid(before) || !valid(after) || before!.name !== after!.name || before!.total !== after!.total || after!.done < before!.done) {
    return { status: 'unknown', increment: null };
  }
  const increment = after!.done - before!.done;
  return { status: increment > 0 ? 'completed' : 'no_effect', increment };
}
