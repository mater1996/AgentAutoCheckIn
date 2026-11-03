import { extractPortalRows, portalNodes, type PortalBounds, type PortalNode, type PortalState } from '../../runner/portal-observation.ts';
import type { InventoryPageObservation } from '../../runner/inventory.ts';

const rules = { panelText: '赚金币抵钱', titlePattern: '^(.+)[(]([0-9]+)/([0-9]+)[)]$',
  buttonTexts: ['领取奖励', '去完成', '去逛逛', '逛一逛'] };
const disclaimer = '注：以上奖励均为最高奖励，以实际获得奖励为准';
const label = (n: PortalNode) => (n.text || n.contentDescription || '').trim();
const under = (path: string, parent: string) => path === parent || path.startsWith(`${parent}/`);
const parent = (path: string) => path.slice(0, path.lastIndexOf('/'));
const boundsValid = (b?: PortalBounds): b is PortalBounds => !!b
  && Object.values(b).every(Number.isFinite) && b.right > b.left && b.bottom > b.top;
const intersect = (a: PortalBounds, b: PortalBounds): PortalBounds => ({ left: Math.max(a.left, b.left),
  top: Math.max(a.top, b.top), right: Math.min(a.right, b.right), bottom: Math.min(a.bottom, b.bottom) });
const contains = (a: PortalBounds, b: PortalBounds) => b.left >= a.left && b.top >= a.top && b.right <= a.right && b.bottom <= a.bottom;
function common(paths: string[]): string {
  let path = paths[0];
  while (!paths.every(p => under(p, path))) path = parent(path);
  return path;
}
export type TreeNodeEvidence = { path: string; text: string; bounds: PortalBounds };
export type TreePageRaw = InventoryPageObservation & {
  progress: string | null;
  evidence: {
    panel: TreeNodeEvidence; list: TreeNodeEvidence; container: TreeNodeEvidence;
    progress: TreeNodeEvidence | null; bottom: TreeNodeEvidence | null; blockers: TreeNodeEvidence[];
    tiers: { reward: TreeNodeEvidence; need: TreeNodeEvidence | null; button: TreeNodeEvidence | null }[];
    tasks: { row: TreeNodeEvidence; title: TreeNodeEvidence; button: TreeNodeEvidence; leaves: TreeNodeEvidence[] }[];
  };
};

/** Offline facts only: no freshness, foreground, occlusion or action authorization. */
export function parseTreePage(state: PortalState): { raw: TreePageRaw; scrollBounds: PortalBounds; signature: string } {
  const all = portalNodes(state.a11y_tree), byPath = new Map(all.map(e => [e.path, e.node]));
  const size = state.device_context?.screen_bounds;
  if (!size || !Number.isFinite(size.width) || !Number.isFinite(size.height) || size.width <= 0 || size.height <= 0)
    throw Error('Portal viewport missing');
  const panels = all.filter(e => e.node.isVisibleToUser === true && label(e.node) === rules.panelText);
  if (panels.length !== 1) throw Error('Portal task panel missing or ambiguous');
  const panel = panels[0];
  const rows = extractPortalRows(state, rules);
  if (!rows.length) throw Error('Portal task rows missing or ambiguous');
  let listPath = common(rows.map(r => r.path));
  if (rows.length === 1) {
    while (listPath && !/ListView|RecyclerView|ScrollView/.test(byPath.get(listPath)?.className ?? '')) listPath = parent(listPath);
    if (!listPath) throw Error('Portal task list ambiguous');
  }
  const panelPath = common([listPath, panel.path]);
  if (listPath === panelPath) throw Error('Portal task list ambiguous with panel header');
  let containerPath = listPath;
  // Include the footer's sibling branch, stopping before the panel header/background.
  for (let p = listPath; p && p !== panelPath; p = parent(p)) {
    const notes = all.filter(e => under(e.path, p) && label(e.node) === disclaimer);
    if (notes.length > 1) throw Error('Portal bottom disclaimer ambiguous');
    if (notes.length === 1) { containerPath = p; break; }
  }
  let scrollBounds: PortalBounds = { left: 0, top: 0, right: size.width, bottom: size.height };
  for (let p = containerPath; p; p = parent(p)) {
    const b = byPath.get(p)?.boundsInScreen;
    if (!boundsValid(b)) throw Error('Portal task container bounds missing');
    scrollBounds = intersect(scrollBounds, b);
  }
  if (!boundsValid(scrollBounds)) throw Error('Portal task container outside viewport');
  const visible = (path: string) => {
    const node = byPath.get(path)!;
    if (node.isVisibleToUser !== true || !boundsValid(node.boundsInScreen)) return false;
    let clip = scrollBounds;
    for (let p = parent(path); p && under(p, containerPath); p = parent(p)) {
      const ancestor = byPath.get(p)!;
      if (ancestor.isVisibleToUser === false) return false;
      // Generic text wrappers in saved WebView trees under-report text height.
      // Clip at the task list/content viewport, not each inline wrapper.
      if (p === listPath || p === containerPath || /ScrollView|RecyclerView|ListView/.test(ancestor.className ?? '')) {
        if (!boundsValid(ancestor.boundsInScreen)) return false;
        clip = intersect(clip, ancestor.boundsInScreen);
      }
    }
    return contains(clip, node.boundsInScreen);
  };
  const proof = (path: string): TreeNodeEvidence => {
    const node = byPath.get(path)!;
    if (!boundsValid(node.boundsInScreen)) throw Error(`Portal evidence bounds missing: ${path}`);
    return { path, text: label(node), bounds: { ...node.boundsInScreen } };
  };
  const clipTree = (node: PortalNode, path: string): PortalNode => ({ ...node,
    isVisibleToUser: under(path, listPath) ? visible(path) : node.isVisibleToUser,
    children: node.children?.map((child, i) => clipTree(child, `${path}/${i}`)) });
  const clippedRows = extractPortalRows({ ...state, a11y_tree: clipTree(state.a11y_tree, '0') }, rules);
  const matchedTasks = clippedRows.map(row => {
    const titles = all.filter(e => under(e.path, row.path) && new RegExp(rules.titlePattern).test(label(e.node)));
    if (titles.length !== 1) throw Error('Portal task title ambiguous');
    return { row, titlePath: titles[0].path };
  }).filter(e => visible(e.titlePath) && visible(e.row.button.path));
  const progressNodes = all.filter(e => under(e.path, listPath) && visible(e.path) && /^完成进度\s*\d+\/\d+$/.test(label(e.node)));
  if (progressNodes.length > 1) throw Error('Portal progress ambiguous');
  const progressNode = progressNodes[0];
  const progress = progressNode ? label(progressNode.node).match(/\d+\/\d+$/)![0] : null;
  if (progress) {
    const [done, total] = progress.split('/').map(Number);
    if (!Number.isSafeInteger(done) || !Number.isSafeInteger(total) || total <= 0 || done > total)
      throw Error('Portal progress invalid');
  }
  const tierEvidence: TreePageRaw['evidence']['tiers'] = [];
  const tiers: InventoryPageObservation['tiers'] = [];
  if (progressNode) {
    let sectionPath = progressNode.path;
    while (parent(sectionPath) !== listPath) sectionPath = parent(sectionPath);
    const rewards = all.filter(e => under(e.path, sectionPath) && visible(e.path) && /^\+\d+$/.test(label(e.node)));
    for (const reward of rewards) {
      let groupPath = parent(reward.path);
      let members: typeof all = [];
      for (; under(groupPath, sectionPath); groupPath = parent(groupPath)) {
        const group = all.filter(e => under(e.path, groupPath) && visible(e.path)
          && label(e.node) && !e.node.children?.length && !/Image/.test(e.node.className ?? ''));
        if (group.some(e => e.path !== reward.path && !/^\+\d+$/.test(label(e.node)))) { members = group; break; }
      }
      if (!members.length || members.filter(e => /^\+\d+$/.test(label(e.node))).length !== 1)
        throw Error('Portal tier grouping ambiguous');
      const buttons = members.filter(e => e.node.isClickable === true || /Button/.test(e.node.className ?? ''));
      const needs = members.filter(e => e.path !== reward.path && !buttons.includes(e));
      if (buttons.length > 1 || needs.length > 1) throw Error('Portal tier condition/button ambiguous');
      const coin = Number(label(reward.node).slice(1));
      if (!Number.isSafeInteger(coin) || coin <= 0) throw Error('Portal tier reward invalid');
      tiers.push({ coin, need: needs[0] ? label(needs[0].node) : '', button: buttons[0] ? label(buttons[0].node) : '' });
      tierEvidence.push({ reward: proof(reward.path), need: needs[0] ? proof(needs[0].path) : null,
        button: buttons[0] ? proof(buttons[0].path) : null });
    }
  }
  const bottomNodes = all.filter(e => under(e.path, containerPath) && visible(e.path) && label(e.node) === disclaimer);
  const blockers = all.filter(e => e.node.isVisibleToUser === true && boundsValid(e.node.boundsInScreen)
    && boundsValid(intersect(scrollBounds, e.node.boundsInScreen))
    && /^(?:验证码登录|滑块验证|请完成验证|账号登录|安全验证|加载中(?:…|\.\.\.)?)$/.test(label(e.node)));
  const raw: TreePageRaw = {
    pageIsTaskPanel: true, blocked: blockers.length > 0, atTop: !!progress && tiers.length > 0, atBottom: bottomNodes.length === 1,
    progress, tiers,
    tasks: matchedTasks.map(({ row }) => ({ name: row.name, instruction: row.instruction, quota: row.quota,
      button: row.button.text, reward: row.reward ?? 0 })),
    evidence: { panel: proof(panel.path), list: proof(listPath), container: proof(containerPath),
      progress: progressNode ? proof(progressNode.path) : null, bottom: bottomNodes[0] ? proof(bottomNodes[0].path) : null,
      blockers: blockers.map(e => proof(e.path)), tiers: tierEvidence,
      tasks: matchedTasks.map(({ row, titlePath }) => ({ row: proof(row.path), title: proof(titlePath), button: proof(row.button.path),
        leaves: all.filter(e => under(e.path, row.path) && visible(e.path) && label(e.node)
          && !e.node.children?.length && !/Image/.test(e.node.className ?? '')).map(e => proof(e.path)) })) },
  };
  return { raw, scrollBounds, signature: JSON.stringify({ tasks: raw.tasks, evidence: raw.evidence.tasks, scrollBounds,
    top: raw.evidence.progress, tiers: raw.evidence.tiers, bottom: raw.evidence.bottom }) };
}
