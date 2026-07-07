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

import type { SPElement, NodePath, CustomRowAction, MockField, FieldType } from '../core/types';

/** Path segment that descends into customCardProps.formatter (state.ts convention). */
const CARD_SEGMENT = -1;

export type TriggerActionKind = 'card' | 'defaultClick' | 'executeFlow' | 'setValue' | 'link' | 'inlineEdit';

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
  /** inlineEdit only: the FieldRef to edit, '[$Internal]' — blank refuses. */
  inlineEditField?: string;
  /** cursor on the trigger surface. */
  cursor?: 'pointer' | 'default';
  /** Accessible label for the generated trigger surface. */
  label?: string;
}

// ─── inline edit (issue #212) — element-level, Text & Person columns only ────

/**
 * Column types `inlineEditField` verifiably works with on real SP (the
 * inspector's long-standing "Text & Person fields only" constraint, restated
 * in issue #212). personMulti IS a Person column (multi-select). Everything
 * else refuses-and-teaches at the picker — never guess.
 */
export const INLINE_EDITABLE_TYPES: ReadonlySet<FieldType> = new Set(['text', 'person', 'personMulti']);

/** Human-readable label for a field's type in refuse-and-teach copy. */
const TYPE_LABELS: Record<FieldType, string> = {
  text: 'Text', note: 'Multiple lines of text', number: 'Number', currency: 'Currency',
  choice: 'Choice', choiceMulti: 'Choice (multi)', date: 'Date', person: 'Person',
  personMulti: 'Person (multi)', boolean: 'Yes/No', hyperlink: 'Hyperlink',
  lookup: 'Lookup', lookupMulti: 'Lookup (multi)',
};

/**
 * Why a column can't take an inline editor — null when it can (refuse-don't-
 * guess: the picker greys unsupported columns WITH this reason, it never
 * silently drops them).
 */
export function inlineEditBlockReason(field: MockField): string | null {
  if (field.protected) return `${field.name} is a read-only system column — it can't be edited.`;
  if (!INLINE_EDITABLE_TYPES.has(field.type)) {
    return `${field.name} is a ${TYPE_LABELS[field.type]} column — inline edit works on Text & Person columns only (verified SP). Use setValue, or stage through a draft Text column.`;
  }
  return null;
}

/**
 * The column an element (subtree) displays — used to default the inline-edit
 * target to "the field you're showing". Prefers the editor's `_field` cell
 * stamp, then the first `[$Field]` reference in a txtContent (depth-first),
 * then `@currentField` mapped to the caller-supplied current column. Returns
 * the INTERNAL name (no `[$…]`), or null when the element displays no field.
 */
export function displayedField(el: SPElement, currentField?: string): string | null {
  if (el._field) return el._field;
  const t = el.txtContent;
  if (t !== undefined) {
    const s = typeof t === 'string' ? t : JSON.stringify(t);
    const m = /\[\$([A-Za-z0-9_]+)/.exec(s);
    if (m) return m[1];
    if (currentField && s.includes('@currentField')) return currentField;
  }
  for (const c of el.children ?? []) {
    const r = displayedField(c, currentField);
    if (r) return r;
  }
  return null;
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

  if (spec.action === 'inlineEdit') {
    // Element-level like hover-reveal (#203), NOT a customRowAction/
    // customCardProps — inlineEditField rides the element directly (no
    // overlay), composes with the structural triggers, and works on leaves.
    // The #204 candidate-collision rules deliberately don't apply. Refuses a
    // blank FieldRef and never silently clobbers an existing inline editor.
    const ref = spec.inlineEditField?.trim();
    if (!ref || host.inlineEditField) return null;
    host.inlineEditField = ref;
    if (spec.cursor) host.style = { ...(host.style ?? {}), cursor: spec.cursor };
    return hostPath;
  }

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

// ─── the "Editable with confirm" recipe (issue #212 part 2b) ─────────────────

/** Parameters for the draft-column confirm & commit recipe. INTERNAL names. */
export interface ConfirmEditSpec {
  /** The column the value really lives in — Save promotes the draft here. */
  realField: string;
  /** The scratch Text column edits stage into (chosen by the maker). */
  draftField: string;
}

/**
 * The owner's field-tested draft-column "confirm & commit" pattern, stamped
 * in ONE call (callers wrap it in mutateDocument → one undoable gesture):
 *
 *   host division
 *   ├─ edit surface  — the host's ORIGINAL children, wrapped, wearing
 *   │                  inlineEditField:[$Draft] (edits stage into the draft;
 *   │                  the wrapper keeps the editable surface and the Save/
 *   │                  Cancel buttons disjoint, so a button click can never
 *   │                  double as "open the editor")
 *   └─ confirm edit  — visible ONLY while [$Draft]!='' (SP has NO logical
 *                      NOT — the gate is `!=`, never a standalone `!`):
 *                      [$Real] → [$Draft]   [Save]   [Cancel]
 *
 * Save is ONE setValue with TWO ordered actionInput entries — promote the
 * draft into the real column, then clear the draft ({Real:"[$Draft]",
 * Draft:""}); Cancel just clears ({Draft:""}). setValue has no Text/Person
 * restriction, so the REAL column can be any editable type; only the draft
 * must be Text (the form layer enforces that — refuse-and-teach when the
 * schema has no scratch Text column).
 *
 * Returns the host path (select the whole assembly), or null when the spec
 * is incomplete (blank/identical columns) or the host isn't a candidate
 * division (the generated buttons carry actions — collision rules apply).
 */
export function applyConfirmEditAt(
  root: SPElement,
  hostPath: NodePath,
  spec: ConfirmEditSpec,
): NodePath | null {
  const host = nodeAt(root, hostPath);
  if (!host) return null;
  const real = spec.realField.trim();
  const draft = spec.draftField.trim();
  if (!real || !draft || real === draft) return null;
  if (!canHostTrigger(host)) return null;
  // like applyTriggerAt: never stack a second inline editor — a host that
  // already edits inline would fight the draft edit surface we're adding
  if (host.inlineEditField) return null;

  const draftRef = `[$${draft}]`;
  const editSurface: SPElement = {
    elmType: 'div',
    _elmName: 'edit surface',
    inlineEditField: draftRef,
    style: { cursor: 'pointer' },
    children: host.children,
  };
  const btn = (label: string, title: string, actionInput: Record<string, unknown>): SPElement => ({
    elmType: 'button',
    _elmName: `${label} draft`,
    txtContent: label,
    attributes: { class: 'sp-field-quickActionButton', title },
    style: { cursor: 'pointer' },
    customRowAction: { action: 'setValue', actionInput },
  });
  const confirm: SPElement = {
    elmType: 'div',
    _elmName: 'confirm edit',
    style: {
      // no logical NOT on SP — non-empty is `!=''` (verified empty-value
      // semantics, HANDOFF §3); no spaces (split-safe habit, lint-quiet)
      display: `=if(${draftRef}!='','flex','none')`,
      'align-items': 'center',
      gap: '6px',
    },
    children: [
      { elmType: 'span', _elmName: 'current value', txtContent: `[$${real}]` },
      // the from→to arrow as a Fluent icon, not a literal '→' — the ascii-only
      // lint (CSOM deployments garble non-ASCII) must stay quiet on generated
      // JSON, and SP's attribute allow-list has no aria-* keys to hide it with
      { elmType: 'span', attributes: { iconName: 'Forward', title: 'becomes' } },
      { elmType: 'span', _elmName: 'pending value', txtContent: draftRef, style: { 'font-weight': '600' } },
      // ordered entries: 1) promote the draft into the real column, 2) clear
      // the draft — one action, one round-trip (the #212 contract shape)
      btn('Save', `Write the pending value into ${real}, then clear the draft`, { [real]: draftRef, [draft]: '' }),
      btn('Cancel', 'Discard the pending value (clears the draft column)', { [draft]: '' }),
    ],
  };
  host.children = [editSurface, confirm];
  return hostPath;
}
