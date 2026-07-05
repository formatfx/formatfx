/**
 * editor/triggerBind.ts — the ONE trigger model (issue #204, docs/specs/
 * TRIGGER-MODEL.md): pure logic for binding content to hover cards, click
 * cards and row actions at APPLY time.
 *
 * A component stays trigger-agnostic content; the act of applying it binds it
 * to a host division + event. This module owns:
 *   - the candidate scan (which divisions may host a trigger)
 *   - the fixed trigger vocabulary (TriggerSpec)
 *   - the robust-pattern generator: the workflow *generates* what the linter
 *     would otherwise flag after the fact (children swallow customCardProps /
 *     customRowAction clicks — `card-trigger-button`), via the
 *     sp-card-defaultClickButton overlay pattern (theme.ts styles it
 *     position:absolute;inset:0;z-index:1).
 *
 * Pure tree logic only — callers wrap mutations in state.mutateDocument() so
 * one drop/pick = one undoable document mutation (overlay + trigger props +
 * content together).
 */

import type { SPElement, NodePath, CustomRowAction } from '../core/types';

/** Path segment that descends into customCardProps.formatter (state.ts convention). */
const CARD_SEGMENT = -1;

export type TriggerActionKind = 'card' | 'defaultClick' | 'executeFlow' | 'setValue' | 'link';

/** The fixed apply-time vocabulary (TRIGGER-MODEL §3). Nothing outside it. */
export interface TriggerSpec {
  action: TriggerActionKind;
  /** card only: when the card opens. */
  event?: 'hover' | 'click';
  /** card only: callout placement. */
  directionalHint?: string;
  isBeakVisible?: boolean;
  /** executeFlow: '{"id":"<FLOWID>"}' — blank refuses at the form layer. */
  actionParams?: string;
  /** setValue: {"Column":"value"} — blank refuses at the form layer. */
  actionInput?: Record<string, unknown>;
  /** link only. */
  href?: string;
  /** cursor on the trigger surface. */
  cursor?: 'pointer' | 'default';
  /** Accessible label for the generated trigger surface. */
  label?: string;
}

function nodeAt(root: SPElement, path: NodePath): SPElement | null {
  let node: SPElement | undefined = root;
  for (const i of path) {
    node = i === CARD_SEGMENT ? node?.customCardProps?.formatter : node?.children?.[i];
    if (!node) return null;
  }
  return node ?? null;
}

/** Anything in this subtree already carries a structural trigger. */
function subtreeHasTrigger(el: SPElement): boolean {
  if (el.customRowAction || el.customCardProps) return true;
  return (el.children ?? []).some(subtreeHasTrigger);
}

/** The single-element candidacy test — a division that can host a trigger:
 *  has children and no card/action anywhere in its subtree. */
export function canHostTrigger(el: SPElement): boolean {
  return el.elmType === 'div' && Boolean(el.children?.length) && !subtreeHasTrigger(el);
}

/**
 * Candidate host divisions for a new trigger (TRIGGER-MODEL §3.1): divs that
 * (a) have children and (b) carry no customRowAction/customCardProps anywhere
 * in their subtree (no trigger collision — nested triggers are parked, #205).
 * Never descends into customCardProps.formatter: content inside a card is
 * already behind a trigger. Outermost candidates first (document order).
 */
export function candidateHostPaths(root: SPElement): NodePath[] {
  const out: NodePath[] = [];
  const walk = (el: SPElement, path: NodePath): void => {
    if (el.customCardProps) return; // don't offer hosts inside a card's subtree either
    if (canHostTrigger(el)) out.push([...path]);
    (el.children ?? []).forEach((c, i) => walk(c, [...path, i]));
  };
  walk(root, []);
  return out;
}

/** Short breadcrumb label for a candidate row in the picker. */
export function hostLabel(root: SPElement, path: NodePath): string {
  const names: string[] = [];
  let node: SPElement | undefined = root;
  for (const i of [...path, NaN]) {
    if (!node) break;
    const txt = typeof node.txtContent === 'string' && node.txtContent.trim()
      ? ` "${node.txtContent.trim().slice(0, 12)}"` : '';
    names.push(node._elmName ?? `${node.elmType}${txt}`);
    node = Number.isNaN(i) ? undefined : node.children?.[i];
  }
  return names.join(' › ');
}

/** The overlay trigger surface (TRIGGER-MODEL §5): an absolutely-positioned
 *  last child covering the whole division, so the division's children can
 *  never swallow the click. */
function overlayElement(spec: TriggerSpec, elmType: 'button' | 'a'): SPElement {
  const el: SPElement = {
    elmType,
    _elmName: spec.action === 'card' ? 'card trigger' : `${spec.action} trigger`,
    attributes: {
      class: 'sp-card-defaultClickButton',
      title: spec.label ?? (spec.action === 'card' ? 'Open card' : 'Click action'),
    },
  };
  if (spec.cursor) el.style = { cursor: spec.cursor };
  return el;
}

/** Ensure the host positions its overlay without disturbing an existing
 *  position value. */
function ensurePositioned(host: SPElement): void {
  const pos = host.style?.position;
  if (pos === undefined || pos === '' ) {
    host.style = { ...(host.style ?? {}), position: 'relative' };
  }
}

/**
 * Layer the trigger onto the division at `hostPath`, generating the robust
 * pattern by construction. Returns the path of the element that carries the
 * trigger props (the host itself for hover cards and link-on-`a`, the new
 * overlay child otherwise) so the caller can select it — or null if the host
 * can't be resolved or the spec is incomplete for its kind.
 *
 * `content` is the (already-bound) card body — required for action 'card'.
 */
export function applyTriggerAt(
  root: SPElement,
  hostPath: NodePath,
  spec: TriggerSpec,
  content?: SPElement,
): NodePath | null {
  const host = nodeAt(root, hostPath);
  if (!host) return null;
  // re-validate at apply time — the pick may be stale (the candidate scan ran
  // when the picker opened): a host that gained a trigger since, or stopped
  // being a division-with-children, refuses instead of colliding (#205 parks
  // nested triggers). Setting href on a bare <a> only needs the no-collision
  // half of the test.
  const linkOnAnchor = spec.action === 'link' && (host.elmType as string) === 'a';
  if (linkOnAnchor ? subtreeHasTrigger(host) : !canHostTrigger(host)) return null;

  if (spec.action === 'card') {
    if (!content) return null;
    const props = {
      openOnEvent: spec.event ?? 'hover',
      directionalHint: spec.directionalHint ?? 'bottomCenter',
      isBeakVisible: spec.isBeakVisible ?? true,
      formatter: content,
    } as const;
    if (props.openOnEvent === 'hover') {
      // hover isn't swallowed by children — props go on the division directly
      host.customCardProps = { ...props };
      if (spec.cursor) host.style = { ...(host.style ?? {}), cursor: spec.cursor };
      return hostPath;
    }
    // click: children swallow it — generate the overlay
    const overlay = overlayElement(spec, 'button');
    overlay.customCardProps = { ...props };
    ensurePositioned(host);
    host.children = [...(host.children ?? []), overlay];
    return [...hostPath, host.children.length - 1];
  }

  if (spec.action === 'link') {
    if (!spec.href) return null;
    // rel rides the EXPORTED JSON (allow-listed attribute), not just the
    // sandbox render — target=_blank without it is a reverse-tabnabbing hole
    // on real SP
    const linkAttrs = { href: spec.href, target: '_blank', rel: 'noopener noreferrer' };
    if (linkOnAnchor) {
      host.attributes = { ...(host.attributes ?? {}), ...linkAttrs };
      if (spec.cursor) host.style = { ...(host.style ?? {}), cursor: spec.cursor };
      return hostPath;
    }
    const overlay = overlayElement(spec, 'a');
    overlay.attributes = { ...overlay.attributes, ...linkAttrs };
    ensurePositioned(host);
    host.children = [...(host.children ?? []), overlay];
    return [...hostPath, host.children.length - 1];
  }

  // row actions: defaultClick / executeFlow / setValue — click surfaces, so
  // always the overlay pattern (completeness is refused at the form layer,
  // and the flow-missing-id / setvalue-missing-target lint rules back it up)
  const cra: CustomRowAction = { action: spec.action };
  if (spec.actionParams !== undefined) cra.actionParams = spec.actionParams;
  if (spec.actionInput !== undefined) cra.actionInput = spec.actionInput;
  const overlay = overlayElement(spec, 'button');
  overlay.customRowAction = cra;
  ensurePositioned(host);
  host.children = [...(host.children ?? []), overlay];
  return [...hostPath, host.children.length - 1];
}
