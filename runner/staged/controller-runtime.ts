import { readFile } from 'node:fs/promises';
import { runStage } from './engine.ts';
import type { Action, StageInput, StageResult, StageEvent, TaskIdentity } from './contracts.ts';
import type { RawBatch } from './raw-capture.ts';
import type { DeviceFrame } from './device.ts';
import { createPanelClaimState, planPanelClaim, verifyContract, type LocalContract, type PanelClaimState, type PanelClaimPlan, type PanelClaimDeps } from './panel-claim.ts';
import { createShopBrowseState, inspectShopBrowse, planShopBrowse, type ShopBrowseState, type ShopPlan, type ShopReceipt } from './shop-browse.ts';

export type ControllerState = (PanelClaimState | ShopBrowseState) & { controller?: { status: 'unknown'; reason: string } };
export type ControllerInput = {
  executionPolicy?: StageInput['executionPolicy'];
  family: LocalContract['family']; contract: LocalContract; initialState?: ControllerState;
  sessionId: string; attemptId: string; taskAttemptId: string; scope: StageInput['scope']; package: string;
  task: TaskIdentity; budget: StageInput['budget']; balanceBefore?: number;
  capturePolicy?: {frames: number; intervalMs: number};
  panelClaimPolicy?: 'current-semantic-v1';
  learningBudget?: ShopBrowseState['learningBudget'];
};
export type CaptureRequest = { frame: DeviceFrame; frames: number; intervalMs: number; maxMs: 2000 };
export type ControllerDeps = {
  readPanelReceipt?: PanelClaimDeps['readReceipt'];
  observe: () => Promise<DeviceFrame>;
  dispatch: (action: Action, frame: DeviceFrame) => Promise<void>;
  persist: (event: StageEvent) => void | Promise<void>;
  now: () => number;
  /** External fast raw capture implementation. AdbOcrDevice.capture is NOT a burst implementation. */
  captureRawBurst?: (request: CaptureRequest) => Promise<RawBatch>;
  deriveRawFrames?: (batch: RawBatch, limits: { budgetMs: number }) => Promise<DeviceFrame[]>;
  captureBurst?: (request: CaptureRequest) => Promise<DeviceFrame[]>;
  /** Explicit bounded alternative, also external: must return the original post-tap capture. */
  captureTransient?: (request: CaptureRequest) => Promise<DeviceFrame>;
};
export type ControllerResult = { status: 'receipt' | 'needsLearning' | 'unknown' | 'stopped'; state: ControllerState;
  receipt?: PanelClaimState['receipt'] | { taskAttemptId: string; layers: ShopReceipt[]; returnedToActivity: true };
  stages: StageResult[]; reason?: string; candidate: true };
type Plan = PanelClaimPlan | ShopPlan;

/**
 * Real engine adapter, no device/model/ledger access beyond injected dependencies.
 * Engine scriptStep runs this explicitly authorized candidate; it is never registry
 * validation. Only an injected readPanelReceipt observer may read the original image.
 * Actual used contract version and current selection policy are archived in state.
 * A receipt means task evidence is ready for parent stable-balance settlement.
 * Panel return_list is a parent no-op. Shop receipt requires both backs and activity.
 */
export async function runControllerStage(input: ControllerInput, deps: ControllerDeps): Promise<ControllerResult> {
  const unbounded = input.executionPolicy === 'development-unbounded-v1';
  let state: ControllerState = structuredClone(input.initialState ?? (input.family === 'panel-claim'
    ? createPanelClaimState(input.contract, input.taskAttemptId, input.balanceBefore!, input.panelClaimPolicy ? { policy: input.panelClaimPolicy, task: input.task } : undefined)
    : { ...createShopBrowseState(input.contract, input.taskAttemptId), learningBudget: input.learningBudget }));
  const stages: StageResult[] = [];
  let status: ControllerResult['status'] = 'stopped', reason: string | undefined;
  let receipt: ControllerResult['receipt'];
  const finish = (): ControllerResult => ({ status, state, receipt, stages, reason, candidate: true });
  const save = async (next: ControllerState) => {
    await deps.persist({ type: 'controller_state', at: deps.now(), sessionId: input.sessionId, attemptId: input.attemptId,
      taskAttemptId: input.taskAttemptId, scope: input.scope, family: input.family, contractVersion: input.contract.version,
      candidate: true, state: structuredClone(next) });
    state = next;
  };
  try {
    if (!input.sessionId?.trim() || !input.attemptId?.trim() || !input.taskAttemptId?.trim()
      || !input.scope?.appId?.trim() || !input.scope.accountId?.trim() || !input.scope.activityId?.trim()
      || !Number.isSafeInteger(input.scope.userId) || input.scope.userId < 0 || input.package !== 'com.taobao.taobao'
      || state.taskAttemptId !== input.taskAttemptId || state.contract.version !== input.contract.version
      || input.contract.family !== input.family || state.contract.family !== input.family
      || input.family === 'panel-claim' && JSON.stringify((state as PanelClaimState).selection) !== JSON.stringify(input.panelClaimPolicy ? { policy: input.panelClaimPolicy, task: input.task } : undefined)) throw Error('Invalid scope, package, attempt or contract ownership');
    if (state.controller?.status === 'unknown') { status = 'unknown'; reason = state.controller.reason; return finish(); }
    if(input.capturePolicy && (input.family!=='panel-claim'||!Number.isSafeInteger(input.capturePolicy.frames)||input.capturePolicy.frames<1||!unbounded&&input.capturePolicy.frames>8||!Number.isSafeInteger(input.capturePolicy.intervalMs)||input.capturePolicy.intervalMs<0||!unbounded&&(input.capturePolicy.intervalMs>250||(input.capturePolicy.frames-1)*input.capturePolicy.intervalMs>=2000)))throw Error('Invalid controller capture policy');
    await verifyContract(input.contract);
    const source = JSON.parse(await readFile(input.contract.refs[0].path, 'utf8'));
    const target = input.family === 'panel-claim'
      ? { name: '任务到访得金币', instruction: '每日来任务面板' }
      : { name: '逛好店赚一大波金币', instruction: '浏览15秒' };
    if (!(input.family === 'panel-claim' && input.panelClaimPolicy === 'current-semantic-v1') && ((typeof source.task === 'string' ? source.task : source.task?.name) !== target.name
      || (input.family === 'shop-browse' && source.task?.instruction !== target.instruction)
      || input.task?.name !== target.name || input.task?.instruction !== target.instruction))
      throw Error('Selected exact task does not match source contract target');
    if (input.family === 'panel-claim' && state.phase === 'ready' && !(deps.captureRawBurst && deps.deriveRawFrames) && !deps.captureBurst && !deps.captureTransient) {
      status = 'needsLearning'; reason = 'Fast raw captureBurst or bounded captureTransient dependency required before claim authorization'; return finish();
    }
    const owner = () => ({ package: input.package, userId: input.scope.userId, taskAttemptId: input.taskAttemptId, now: deps.now(), executionPolicy: input.executionPolicy });
    let cached: { id: string; plan: Plan } | undefined;
    let transientPlan: PanelClaimPlan | undefined;
    let transientFrame: DeviceFrame | undefined;
    const planning = async (frame: DeviceFrame): Promise<Plan> => {
      if (cached?.id === frame.id) return cached.plan;
      let plan: Plan;
      if (input.family === 'panel-claim') plan = await planPanelClaim(frame, owner(), state as PanelClaimState, { readReceipt: deps.readPanelReceipt });
      else {
        let selectedState = state as ShopBrowseState;
        if (selectedState.phase === 'awaitShopList') {
          const inspected = await inspectShopBrowse(frame, owner(), input.contract);
          const first = inspected?.cards.filter(c => c.button === 'fresh').sort((a, b) => a.bounds[1] - b.bounds[1])[0];
          if (first && inspected!.cards.filter(c => c.name === first.name).length === 1)
            selectedState = { ...selectedState, selectedCardName: first.name };
        }
        plan = await planShopBrowse(frame, owner(), selectedState);
      }
      cached = { id: frame.id, plan };
      return plan;
    };
    const events: StageEvent[] = [];
    await deps.persist({type:'explicit_candidate_authorized',at:deps.now(),sessionId:input.sessionId,taskAttemptId:input.taskAttemptId,version:input.contract.version,registryValidated:false,family:input.family});
    const stage = await runStage({ executionPolicy: input.executionPolicy, sessionId: input.sessionId, attemptId: input.attemptId, taskAttemptId: input.taskAttemptId,
      stageId: `controller:${input.family}`, scope: input.scope, task: input.task, goal: 'Source-backed candidate task receipt and owning panel',
      expectedCheckpoint: 'receipt', script:{id:'explicit-'+input.family+'-candidate',version:input.contract.version,validated:true}, constraints: { allowedActions: ['tap', 'swipe', 'back', 'wait'], frameMaxAgeMs: 5000,
        maxRounds: input.budget.maxActions + 2 }, budget: { ...input.budget, maxAgentCalls: input.budget.maxActions + 1 } }, {
      now: deps.now, observe: deps.observe,
      persist: event => { events.push(event); },
      check: async context => {
        if (context.pendingAction?.status === 'unknown') return { done: false, blocked: true, reason: 'Unknown dispatch cannot be replayed' };
        const plan = transientPlan ?? await planning(context.frame as DeviceFrame);
        if (plan.kind === 'receipt' || plan.kind === 'awaitSettlement' || (plan.kind === 'observe' && 'receipt' in plan.nextState && plan.nextState.receipt)) {
          await save(plan.nextState);
          if (input.family === 'panel-claim') receipt = (state as PanelClaimState).receipt;
          else {
            const shop = state as ShopBrowseState;
            if (!shop.entry || !shop.selected || shop.receipts?.length !== 2 || shop.receipts[0].layer !== 'store' || shop.receipts[1].layer !== 'shopList')
              return { done: false, blocked: true, reason: 'Incomplete multilayer provenance' };
            receipt = { taskAttemptId: input.taskAttemptId, layers: shop.receipts, returnedToActivity: true };
          }
          status = 'receipt'; return { done: true, checkpoint: 'receipt' };
        }
        if (plan.kind === 'unknown' || plan.kind === 'needsLearning') {
          await save(plan.nextState); status = plan.kind; reason = plan.reason;
          return { done: false, blocked: true, reason: plan.reason };
        }
        return { done: false, checkpoint: state.phase };
      },
      agentStep: async context => ({frameId:context.frame.id,stop:true,reason:'Controller candidate has no model fallback',expected:'receipt'}),
      scriptStep: async context => {
        const plan = await planning(context.frame as DeviceFrame);
        if (plan.kind !== 'action' || !plan.action) return { frameId: context.frame.id, expected: state.phase, reason: plan.reason, stop: true };
        return { frameId: context.frame.id, expected: plan.nextState.phase, reason: plan.reason, action: plan.action as Action };
      },
      dispatch: async (action, frame) => {
        if (action.type === 'wait') { await deps.dispatch(action, frame as DeviceFrame); return; }
        const plan = cached?.id === frame.id ? cached.plan : undefined;
        if (!plan || plan.kind !== 'action') throw Error('No current cached action intent');
        await save(plan.nextState); // Durable reservation before real device dispatch; never roll back.
        await deps.dispatch(action, frame as DeviceFrame);
        if (input.family === 'panel-claim' && action.type === 'tap') {
          const request: CaptureRequest = { frame: frame as DeviceFrame, frames: input.capturePolicy?.frames??8, intervalMs: input.capturePolicy?.intervalMs??250, maxMs: 2000 };
          const started = deps.now(), wall = performance.now();
          let timer: ReturnType<typeof setTimeout> | undefined;
          try {
            const rawMode = !!(deps.captureRawBurst && deps.deriveRawFrames);
            const capture = () => rawMode ? deps.captureRawBurst!(request) : deps.captureBurst ? deps.captureBurst(request) : deps.captureTransient!(request).then(f => [f]);
            const result = unbounded ? await capture() : await Promise.race([
              rawMode ? deps.captureRawBurst!(request) : deps.captureBurst ? deps.captureBurst(request) : deps.captureTransient!(request).then(f => [f]),
              new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(Error('Transient capture exceeded 2000ms')), 2000); }),
            ]);
            clearTimeout(timer);
            if (!unbounded && (deps.now() - started > 2000 || performance.now() - wall > 2000))
              throw Error('Transient capture exceeded bounded budget');
            let captured: DeviceFrame[];
            if (rawMode) {
              const batch = result as RawBatch;
              if (!Array.isArray(batch.frames) || !batch.frames.length || !unbounded && batch.frames.length > 8 || batch.status === 'failed') throw Error('Invalid raw capture batch');
              if (batch.frames.some(f => f.capturedAt < started || f.capturedAt > deps.now() || !unbounded && f.capturedAt > started + 2000)) throw Error('Raw capture outside transient window');
              const budgetMs = unbounded ? 60000 : Math.min(3000, ...batch.frames.map(f => f.capturedAt + 5000 - deps.now()));
              if (budgetMs <= 0) throw Error('Raw capture expired before OCR');
              const parsingStarted = deps.now(), parsingWall = performance.now();
              captured = unbounded ? await deps.deriveRawFrames!(batch, {budgetMs}) : await Promise.race([
                deps.deriveRawFrames!(batch, {budgetMs}),
                new Promise<never>((_resolve,reject) => { timer=setTimeout(()=>reject(Error('Transient OCR deadline exceeded')),budgetMs); }),
              ]);
              if (!unbounded && (deps.now()-parsingStarted>budgetMs || performance.now()-parsingWall>budgetMs)) throw Error('Transient OCR deadline exceeded');
              if (captured.length !== batch.frames.length || captured.some(f => {
                const raw=batch.frames.filter(r=>r.id===f.id);
                return raw.length!==1 || raw[0].path!==f.path || raw[0].capturedAt!==f.capturedAt;
              })) throw Error('Derived frame lost original capture provenance');
            } else captured = result as DeviceFrame[];
            if (!unbounded && captured.length > 8 || !captured.length) throw Error('Invalid transient frame count');
            for (const fresh of captured) {
              if (fresh.capturedAt < started || fresh.capturedAt > deps.now() || !unbounded && fresh.capturedAt > started + 2000) continue;
              const proof = await planPanelClaim(fresh, owner(), state as PanelClaimState, { readReceipt: deps.readPanelReceipt });
              await deps.persist({ type: 'controller_transient_observed', at: deps.now(), frame: fresh, candidate: true });
              if (proof.kind === 'receipt') { transientPlan = proof; transientFrame = fresh; break; }
            }
          } finally { clearTimeout(timer); }
        }
      },
    });
    stages.push(stage);
    for (const event of events) await deps.persist(event);
    if (stage.status === 'unknown' || (status as ControllerResult['status']) === 'unknown') {
      status = 'unknown'; reason = stage.error;
      await save({ ...state, controller: { status: 'unknown', reason: reason ?? 'Unknown dispatch' } });
      receipt = undefined;
    } else if (stage.status !== 'completed' && status === 'stopped') reason = stage.error;
    // Preserve original transient frame provenance in the engine report as well.
    if (transientFrame) stage.events.push({ type: 'controller_transient_receipt', at: deps.now(), frame: transientFrame });
    return finish();
  } catch (error) {
    reason = error instanceof Error ? error.message : String(error);
    return { ...finish(), reason };
  }
}
