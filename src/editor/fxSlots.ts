/**
 * editor/fxSlots.ts — the fx bar's property-slot model (pure, node-testable).
 *
 * The fx bar edits ONE "property slot" of the selected element at a time —
 * "Text shown", "Fill color", "Left border" … — the Name-Box / property-picker
 * idea from SHEET-MODE.md, done right. This module is the type/element-aware
 * catalog of which slots an element offers and how to read/write each one; the
 * DOM bar (fxBar.ts) layers the dialect transpiler and the editor on top.
 *
 * No DOM, no state imports — a sibling of condRules.ts / dialect.ts, pinned by
 * fxSlots.test.ts. Slots map to real SP surfaces: txtContent (the displayed
 * text) and individual style properties (the paint). Every slot accepts an
 * expression; the curated set is the everyday paint, and any expression an
 * element already carries is surfaced as its own slot so nothing is hidden.
 */

import type { SPElement, SPExpr } from '../core/types';

export type FxSlotKind = 'text' | 'style';

export interface FxSlot {
  /** Stable id (kept across selections so "Fill color" stays chosen). */
  id: string;
  /** Plain-language label for the picker. */
  label: string;
  kind: FxSlotKind;
  /** Style property name when kind === 'style'. */
  prop?: string;
  /** One-line guidance — always says "every row" and "formatting only". */
  hint: string;
}

/** Elements that render text (so "Text shown" is offered). */
const TEXT_CAPABLE = new Set(['div', 'span', 'a', 'p', 'button']);

const TEXT_HINT =
  'The text shown in every row of this cell — formatting only; the column’s stored value never changes.';

const paintHint = (what: string): string =>
  `Paints the ${what} of every row — formatting only; it never changes the stored value.`;

/** The everyday paint surfaces, in the order makers reach for them. */
const CURATED: Array<Omit<FxSlot, 'kind' | 'hint'> & { prop: string; hint: string }> = [
  { id: 'fill', label: 'Fill color', prop: 'background-color', hint: paintHint('fill colour') },
  { id: 'ink', label: 'Text color', prop: 'color', hint: paintHint('text colour') },
  { id: 'weight', label: 'Bold / weight', prop: 'font-weight', hint: paintHint('text weight') },
  { id: 'leftBorder', label: 'Left border', prop: 'border-left', hint: paintHint('left border') },
];

/** Turn a CSS property into a readable label: 'border-radius' → 'Border radius'. */
export function humanizeProp(prop: string): string {
  const words = prop.replace(/^-+/, '').replace(/-/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * The slots this element offers: "Text shown" (when it renders text), the
 * curated paint set, then any other style property the element already uses —
 * so every expression already on the element is reachable and editable.
 */
export function slotsFor(node: SPElement): FxSlot[] {
  const out: FxSlot[] = [];
  if (TEXT_CAPABLE.has(node.elmType)) {
    out.push({ id: 'text', label: 'Text shown', kind: 'text', hint: TEXT_HINT });
  }
  const covered = new Set<string>();
  for (const c of CURATED) {
    out.push({ id: c.id, label: c.label, kind: 'style', prop: c.prop, hint: c.hint });
    covered.add(c.prop);
  }
  for (const prop of Object.keys(node.style ?? {})) {
    if (covered.has(prop)) continue;
    covered.add(prop);
    out.push({
      id: `style:${prop}`,
      label: humanizeProp(prop),
      kind: 'style',
      prop,
      hint: paintHint(`${prop}`),
    });
  }
  return out;
}

/** The slot's current stored value (SP dialect / literal), or undefined when unset. */
export function readSlot(node: SPElement, slot: FxSlot): SPExpr | undefined {
  if (slot.kind === 'text') return node.txtContent;
  return node.style?.[slot.prop!];
}

/**
 * Write a slot. An empty/undefined value clears it (and tidies away an empty
 * style object). Caller wraps this in state.mutateDocument so it's one undo.
 */
export function writeSlot(node: SPElement, slot: FxSlot, value: SPExpr | undefined): void {
  const clear = value === undefined || value === '';
  if (slot.kind === 'text') {
    if (clear) delete node.txtContent;
    else node.txtContent = value;
    return;
  }
  const prop = slot.prop!;
  if (clear) {
    if (node.style) {
      delete node.style[prop];
      if (Object.keys(node.style).length === 0) delete node.style;
    }
    return;
  }
  node.style = node.style ?? {};
  node.style[prop] = value;
}
