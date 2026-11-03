export type ForegroundObservation = {
  marker: 'topResumedActivity' | 'mResumedActivity' | 'ResumedActivity' | 'Resumed' | null;
  activity: string | null;
  taskId: number | null;
};

export type SystemObservationSource = { path: string; sha256: string; startedAt: number; endedAt: number };
export type ForegroundObservationRecord = ForegroundObservation & { source: SystemObservationSource };
export type SystemObservation = { version: 'android-system-v1'; before: ForegroundObservationRecord; after: ForegroundObservationRecord };

/** Only a complete, explicitly labelled resumed ActivityRecord is a fallback. */
export function parseExplicitResumedActivity(line: string) {
  return line.match(/^[ \t]*(?:ResumedActivity|Resumed):[ \t]*ActivityRecord\{[^\s{}]+[ \t]+u(\d+)[ \t]+([\w.]+)\/([\w.$]+)(?=[ \t}])[^{}\r\n]*\}[ \t]*\r?$/);
}

/** Diagnostic only: never infer current state from background tasks or Intent. */
export function readForegroundObservation(raw: string): ForegroundObservation {
  const top = raw.split('\n').filter(line => /\btopResumedActivity\s*=/.test(line));
  const resumed = raw.split('\n').filter(line => /\bmResumedActivity\s*[:=]/.test(line));
  const explicit = raw.split('\n').filter(line => /^[ \t]*(?:ResumedActivity|Resumed):/.test(line));
  const lines = top.length ? top : resumed.length ? resumed : explicit;
  const marker = top.length ? 'topResumedActivity' : resumed.length ? 'mResumedActivity'
    : explicit.some(line => /^[ \t]*ResumedActivity:/.test(line)) ? 'ResumedActivity' : explicit.length ? 'Resumed' : null;
  const fallback = !top.length && !resumed.length;
  const identities = fallback ? lines.map(parseExplicitResumedActivity) : [];
  const validExplicit = !fallback || identities.every(m => m && Number.isSafeInteger(Number(m[1]))
    && /^[a-zA-Z][\w]*(?:\.[a-zA-Z][\w]*)+$/.test(m[2]))
    && new Set(identities.map(m => m && `${Number(m[1])}:${m[2]}`)).size === 1;
  const components = lines.map((line, index) => fallback
    ? validExplicit ? `${identities[index]![2]}/${identities[index]![3]}` : null
    : line.match(/\bu\d+\s+([\w.]+\/[\w.$]+)(?=\s|\})/)?.[1] ?? null);
  const activity = components.length && components.every(c => c !== null && c === components[0]) ? components[0] : null;
  const tasks = lines.map(line => {
    const value = line.match(/\bt(\d+)(?=\s|\})/)?.[1];
    return value !== undefined && Number.isSafeInteger(Number(value)) ? Number(value) : null;
  });
  const taskId = activity && tasks.every(t => t !== null && t === tasks[0]) ? tasks[0] : null;
  return { marker, activity, taskId };
}
