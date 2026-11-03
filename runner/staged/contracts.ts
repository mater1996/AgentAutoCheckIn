export type Frame = {
  id: string; path: string; width: number; height: number; capturedAt: number;
  lines: readonly unknown[]; package: string; userId: number;
};
export type Action =
  | { type: 'tap'; x: number; y: number }
  | { type: 'swipe'; x1: number; y1: number; x2: number; y2: number; durationMs?: number }
  | { type: 'swipe'; fromX: number; fromY: number; toX: number; toY: number; ms?: number }
  | { type: 'back' }
  | { type: 'wait'; ms: number }
  | { type: 'launch'; package: string; userId?: number };
export type Proposal = { frameId: string; action?: Action; expected: string; reason: string; stop?: boolean };
export type StageInput = {
  executionPolicy?: 'development-unbounded-v1';
  sessionId: string; stageId: string; attemptId?: string; taskAttemptId?: string;
  scope: { appId: string; accountId: string; activityId: string; userId: number };
  goal: string; previousCheckpoint?: string; expectedCheckpoint: string;
  task?: unknown; plan?: unknown; experience?: unknown;
  constraints: { allowedActions?: readonly Action['type'][]; frameMaxAgeMs?: number; observationAgePolicy?: 'data-only-v1'; maxRounds?: number; [key: string]: unknown };
  budget: { maxMs: number; maxAgentCalls: number; maxActions: number };
  script?: { id: string; version: string; validated: boolean };
};
export type ActionRecord = { proposal: Proposal; source: 'script' | 'agent'; status: 'rejected' | 'pending' | 'observed' | 'verified' | 'unknown'; error?: string };
export type StageEvent = { type: string; at: number; [key: string]: unknown };
/** signal is cooperative cancellation; the engine also bounds every awaited dependency itself. */
export type StageContext = StageInput & {
  frame: Frame; signal?: AbortSignal; lastCheckpoint?: string; recentActions: readonly ActionRecord[]; pendingAction?: ActionRecord; error?: string;
  remaining: { ms: number | null; agentCalls: number | null; actions: number | null; rounds: number | null };
};
export type CheckResult = { done: boolean; checkpoint?: string; reason?: string; blocked?: boolean };
export type StageResult = {
  status: 'completed' | 'stopped' | 'unknown'; stageId: string; checkpoint?: string;
  events: StageEvent[]; actions: ActionRecord[]; review?: unknown; error?: string;
  usedScriptVersion?: string; derivedCandidate?: { status: 'candidate'; value: unknown };
};
export type StageDeps = {
  observe: () => Promise<Frame>;
  scriptStep?: (context: StageContext) => Promise<Proposal | null>;
  agentStep: (context: StageContext) => Promise<Proposal>;
  /** Explicitly reobserve and relocate an action; never renew coordinates from the source frame. */
  beforeDispatch?: (context: StageContext, proposal: Proposal) => Promise<{ frame: Frame; proposal: Proposal } | null>;
  dispatch: (action: Action, frame: Frame) => Promise<void>;
  /** Optional device-proven unsent recovery. Invoked once only; a replacement dispatch cannot recover again. */
  recoverUnsentDispatch?: (context: StageContext, proposal: Proposal, error: unknown) => Promise<{ frame: Frame; proposal: Proposal; proof: unknown } | null>;
  check: (context: StageContext, proposal?: Proposal) => Promise<CheckResult>;
  review?: (summary: StageResult) => Promise<unknown>;
  now?: () => number;
  persist?: (event: StageEvent) => void;
};

/** Exact task identity; raw text is deliberately never normalized. */
export type TaskIdentity = { taskDefinitionId?: string; name?: string; instruction?: string };
export type CurrentTask = TaskIdentity & { quota: string; reward?: number; [key: string]: unknown };
/** maxAttempts is the original plan allowance; completed counts are subtracted by identity. */
export type PlanDecision = TaskIdentity & { decision: 'do' | 'skip'; maxAttempts: number };
export type CompletedTask = TaskIdentity & { count: number };
