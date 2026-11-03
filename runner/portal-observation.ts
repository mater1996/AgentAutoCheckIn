/* Portal tree parsing only. Extracted facts never authorize an action. */
export type PortalBounds = { left: number; top: number; right: number; bottom: number };
export type PortalNode = {
  text?: string; contentDescription?: string; className?: string;
  isVisibleToUser?: boolean; isEnabled?: boolean; isClickable?: boolean;
  boundsInScreen?: PortalBounds; children?: PortalNode[];
};
export type PortalState = {
  a11y_tree: PortalNode;
  phone_state: { packageName?: string; activityName?: string; [key: string]: unknown };
  device_context?: { screen_bounds?: { width: number; height: number }; [key: string]: unknown };
  degraded?: boolean; degradedReason?: string; snapshotAgeMs?: number;
};
export type PortalRowRules = { panelText: string; titlePattern: string; buttonTexts: string[] };
export type PortalTarget = { path: string; text: string; bounds: PortalBounds };
export type PortalRow = {
  name: string; instruction: string; quota: string; reward: number | null;
  path: string; button: PortalTarget;
};
export function portalNodes(root: PortalNode): { node: PortalNode; path: string }[] {
  const out: { node: PortalNode; path: string }[] = [];
  const visit = (node: PortalNode, path: string) => {
    out.push({ node, path });
    (node.children ?? []).forEach((child, index) => visit(child, `${path}/${index}`));
  };
  visit(root, '0');
  return out;
}
const label = (node: PortalNode) => (node.text || node.contentDescription || '').trim();
const validBounds = (b?: PortalBounds): b is PortalBounds => !!b
  && [b.left, b.top, b.right, b.bottom].every(Number.isFinite)
  && b.left >= 0 && b.top >= 0 && b.right > b.left && b.bottom > b.top;

export type PortalObservationContext = {
  state: PortalState; capturedAt: number; now: number; maxAgeMs: number;
  expectedPackage: string; foregroundPackage: string;
  expectedText: string; screenConfirmed: boolean;
  portalVersion?: string; readStartedAt?: number;
  targetConfirmation?: PortalTarget & { confirmedAt: number };
};

/** Readable cached data is evidence, never an actionable snapshot. */
export function assessPortalObservation(c: PortalObservationContext): { ok: boolean; reason: string } {
  if (c.state.degraded === true || c.state.degradedReason)
    return { ok: false, reason: 'Portal degraded snapshot' };
  if (!Number.isFinite(c.capturedAt) || !Number.isFinite(c.now) || c.now < c.capturedAt
    || !Number.isFinite(c.maxAgeMs) || c.maxAgeMs <= 0)
    return { ok: false, reason: 'Portal invalid observation timing' };
  const age = c.state.snapshotAgeMs;
  const normalResponse = c.portalVersion === '0.7.30'
    && c.state.degraded === undefined && age === undefined;
  if (normalResponse) {
    // The protocol omits capture age on normal completion. Request time is a
    // budget, not capture provenance: a shared in-flight read may predate it.
    if (typeof c.readStartedAt !== 'number' || !Number.isFinite(c.readStartedAt)
      || c.readStartedAt > c.capturedAt || c.now - c.readStartedAt > c.maxAgeMs)
      return { ok: false, reason: 'Portal normal response outside read budget' };
  } else if (c.state.degraded !== false || typeof age !== 'number' || !Number.isFinite(age)
    || age < 0 || age + c.now - c.capturedAt > c.maxAgeMs)
    return { ok: false, reason: 'Portal stale or unknown snapshot age' };
  if (!c.expectedPackage || c.foregroundPackage !== c.expectedPackage
    || c.state.phone_state.packageName !== c.expectedPackage || c.screenConfirmed !== true)
    return { ok: false, reason: 'Portal foreground or screenshot not confirmed' };
  const markers = portalNodes(c.state.a11y_tree).filter(({ node }) => node.isVisibleToUser === true
    && label(node) === c.expectedText);
  if (!c.expectedText || markers.length !== 1) return { ok: false, reason: 'Portal expected page missing or ambiguous' };
  return { ok: true, reason: normalResponse
    ? 'Portal normal response, bounded timing and page checked; capture age unknown'
    : 'Expected page and source age checked' };
}

/** One dispatch per attempt. The owner must verify effects before creating another attempt. */
export class PortalTapAttempt {
  private used = false;
  constructor(private readonly transport: { tap(x: number, y: number): Promise<unknown> }) {}
  async tap(target: PortalTarget, context: PortalObservationContext): Promise<{
    status: 'dispatched' | 'rejected' | 'unknown'; businessComplete: false;
  }> {
    if (this.used) throw new Error('Portal attempt already dispatched; verify outcome first');
    const verdict = assessPortalObservation(context);
    if (!verdict.ok) throw new Error(verdict.reason);
    if (context.state.snapshotAgeMs === undefined) {
      const proof = context.targetConfirmation;
      if (!proof || !Number.isFinite(proof.confirmedAt) || proof.confirmedAt < context.capturedAt
        || proof.confirmedAt > context.now || proof.path !== target.path || proof.text !== target.text
        || (['left', 'top', 'right', 'bottom'] as const).some(k => proof.bounds[k] !== target.bounds[k]))
        throw new Error('Portal current target confirmation missing or mismatched');
    }
    const node = portalNodes(context.state.a11y_tree).find(x => x.path === target.path)?.node;
    const size = context.state.device_context?.screen_bounds;
    if (!node || node.isVisibleToUser !== true || node.isEnabled !== true || node.isClickable !== true
      || label(node) !== target.text || !validBounds(target.bounds) || !validBounds(node.boundsInScreen)
      || !size || !Number.isFinite(size.width) || !Number.isFinite(size.height)
      || size.width <= 0 || size.height <= 0
      || target.bounds.right > size.width || target.bounds.bottom > size.height
      || (['left', 'top', 'right', 'bottom'] as const).some(k => node.boundsInScreen![k] !== target.bounds[k]))
      throw new Error('Portal target changed, disabled, ambiguous or offscreen');
    this.used = true;
    const b = target.bounds;
    try {
      const receipt = await this.transport.tap(Math.round((b.left + b.right) / 2), Math.round((b.top + b.bottom) / 2));
      if (receipt && typeof receipt === 'object' && 'portalStatus' in receipt && receipt.portalStatus === 'error')
        return { status: 'rejected', businessComplete: false };
      return { status: 'dispatched', businessComplete: false };
    } catch {
      // No provider payloads: they may contain credentials; dispatch effect remains unknown.
      return { status: 'unknown', businessComplete: false };
    }
  }
}

export function extractPortalRows(state: PortalState, rules: PortalRowRules): PortalRow[] {
  const all = portalNodes(state.a11y_tree);
  const panels = all.filter(({ node }) => node.isVisibleToUser === true && label(node) === rules.panelText);
  if (panels.length !== 1) throw new Error('Portal task panel identity missing or ambiguous');
  const title = new RegExp(rules.titlePattern);
  const rows: PortalRow[] = [];
  const size = state.device_context?.screen_bounds;
  const onScreen = (node: PortalNode) => node.isVisibleToUser === true && validBounds(node.boundsInScreen)
    && (!size || (node.boundsInScreen.right <= size.width && node.boundsInScreen.bottom <= size.height));
  const visit = (node: PortalNode, path: string) => {
    const descendants = portalNodes(node);
    const titles = descendants.filter(x => onScreen(x.node) && title.test(label(x.node)));
    const buttons = descendants.filter(x => onScreen(x.node) && x.node.isEnabled === true
      && x.node.isClickable === true && rules.buttonTexts.includes(label(x.node)));
    if (titles.length === 1 && buttons.length > 1) throw new Error('Portal ambiguous task buttons');
    if (titles.length === 1 && buttons.length === 1) {
      // Descend until this is the smallest shared ancestor of the title and button.
      const sharedChild = (node.children ?? []).findIndex(child => {
        const nested = portalNodes(child).map(x => x.node);
        return nested.includes(titles[0].node) && nested.includes(buttons[0].node);
      });
      if (sharedChild >= 0) {
        visit(node.children![sharedChild], `${path}/${sharedChild}`);
        return;
      }
      const match = label(titles[0].node).match(title)!;
      const done = Number(match[2]), total = Number(match[3]);
      if (!Number.isSafeInteger(done) || !Number.isSafeInteger(total) || done < 0 || total <= 0 || done > total)
        throw new Error('Portal invalid task quota');
      const leaves = descendants.filter(x => onScreen(x.node) && !(x.node.children?.length))
        .map(x => label(x.node)).filter(Boolean);
      const rewardTexts = leaves.filter(x => /^\+\d+$/.test(x));
      const instruction = leaves.filter(x => x !== label(titles[0].node) && !rules.buttonTexts.includes(x)
        && !/^\+\d+$/.test(x) && !/Image/i.test(descendants.find(d => label(d.node) === x)?.node.className ?? ''));
      rows.push({ name: match[1], quota: `${done}/${total}`, instruction: instruction.join('\n'),
        reward: rewardTexts.length === 1 ? Number(rewardTexts[0].slice(1)) : null,
        path, button: { path: path + buttons[0].path.slice(1), text: label(buttons[0].node), bounds: { ...buttons[0].node.boundsInScreen! } } });
      return;
    }
    (node.children ?? []).forEach((child, index) => visit(child, `${path}/${index}`));
  };
  visit(state.a11y_tree, '0');
  return rows;
}
