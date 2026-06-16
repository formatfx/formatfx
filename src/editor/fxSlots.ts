/**
 * editor/fxSlots.ts — the fx bar's property-slot model (pure, node-testable).
 *
 * The fx bar edits ONE "property slot" of the selected element at a time —
 * "Text shown", "Fill color", "Image URL" … — the Name-Box / property-picker
 * idea from SHEET-MODE.md, done right. This module is the type/element-aware
 * catalog of which slots an element offers and how to read/write each one; the
 * DOM bar (fxBar.ts) layers the dialect transpiler and the editor on top.
 *
 * The list is element-aware, not one-size-fits-all: box/paint slots are offered
 * everywhere, type slots (text colour/weight/size/align) only where the element
 * actually renders text, and attribute slots only where they apply (an image's
 * URL, a link's URL). Any expression the element already carries is surfaced as
 * its own slot so nothing is hidden.
 *
 * No DOM, no state imports — a sibling of condRules.ts / dialect.ts, pinned by
 * fxSlots.test.ts. Slots map to real SP surfaces: txtContent, individual style
 * properties, and a few element attributes.
 */

import type { SPElement, SPExpr } from '../core/types';

export type FxSlotKind = 'text' | 'style' | 'attr';

export interface FxSlot {
  /** Stable id (kept across selections so "Fill color" stays chosen). */
  id: string;
  /** Plain-language label for the picker. */
  label: string;
  kind: FxSlotKind;
  /** Style property name when kind === 'style'. */
  prop?: string;
  /** Attribute name when kind === 'attr'. */
  attr?: string;
  /** One-line guidance for the slot. */
  hint: string;
}

/** Elements that render text (so text + type slots are offered). */
const TEXT_CAPABLE = new Set(['div', 'span', 'a', 'p', 'button']);

const TEXT_HINT = 'The text shown in every row of this cell.';
const paintHint = (what: string): string => `Paints the ${what} of every row.`;

type StyleDef = { id: string; label: string; prop: string; hint: string };

/** Box/paint slots — offered on every element. */
const BOX_SLOTS: StyleDef[] = [
  { id: 'fill', label: 'Fill color', prop: 'background-color', hint: paintHint('fill colour') },
  { id: 'leftBorder', label: 'Left border', prop: 'border-left', hint: paintHint('left border') },
  { id: 'radius', label: 'Corner radius', prop: 'border-radius', hint: paintHint('corner radius') },
  { id: 'opacity', label: 'Opacity', prop: 'opacity', hint: paintHint('opacity') },
];

/** Type slots — only where the element renders text. */
const TYPE_SLOTS: StyleDef[] = [
  { id: 'ink', label: 'Text color', prop: 'color', hint: paintHint('text colour') },
  { id: 'weight', label: 'Bold / weight', prop: 'font-weight', hint: paintHint('text weight') },
  { id: 'fontSize', label: 'Text size', prop: 'font-size', hint: paintHint('text size') },
  { id: 'align', label: 'Text align', prop: 'text-align', hint: paintHint('text alignment') },
];

/** Element-specific attribute slots (only shown where they apply). */
function attrSlotsFor(elmType: string): FxSlot[] {
  if (elmType === 'img') {
    return [{ id: 'src', label: 'Image URL', kind: 'attr', attr: 'src', hint: 'The image shown in every row.' }];
  }
  if (elmType === 'a') {
    return [{ id: 'href', label: 'Link URL', kind: 'attr', attr: 'href', hint: 'The link target for every row.' }];
  }
  return [];
}

/** Turn a CSS property into a readable label: 'border-radius' → 'Border radius'. */
export function humanizeProp(prop: string): string {
  const words = prop.replace(/^-+/, '').replace(/-/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

const asStyle = (d: StyleDef): FxSlot => ({ id: d.id, label: d.label, kind: 'style', prop: d.prop, hint: d.hint });

/**
 * The slots this element offers, tailored to its type, then any other style
 * property it already uses (so every expression on the element is reachable).
 */
export function slotsFor(node: SPElement): FxSlot[] {
  const textCapable = TEXT_CAPABLE.has(node.elmType);
  const out: FxSlot[] = [];
  if (textCapable) out.push({ id: 'text', label: 'Text shown', kind: 'text', hint: TEXT_HINT });
  out.push(...BOX_SLOTS.map(asStyle));
  if (textCapable) out.push(...TYPE_SLOTS.map(asStyle));
  out.push(...attrSlotsFor(node.elmType));

  const covered = new Set(out.filter((s) => s.prop).map((s) => s.prop!));
  for (const prop of Object.keys(node.style ?? {})) {
    if (covered.has(prop)) continue;
    covered.add(prop);
    out.push({ id: `style:${prop}`, label: humanizeProp(prop), kind: 'style', prop, hint: paintHint(prop) });
  }
  return out;
}

/** The slot's current stored value (SP dialect / literal), or undefined when unset. */
export function readSlot(node: SPElement, slot: FxSlot): SPExpr | undefined {
  if (slot.kind === 'text') return node.txtContent;
  if (slot.kind === 'attr') return node.attributes?.[slot.attr!];
  return node.style?.[slot.prop!];
}

/**
 * Write a slot. An empty/undefined value clears it (and tidies away an empty
 * style/attributes object). Caller wraps this in state.mutateDocument (one undo).
 */
export function writeSlot(node: SPElement, slot: FxSlot, value: SPExpr | undefined): void {
  const clear = value === undefined || value === '';
  if (slot.kind === 'text') {
    if (clear) delete node.txtContent;
    else node.txtContent = value;
    return;
  }
  if (slot.kind === 'attr') {
    if (clear) {
      if (node.attributes) {
        delete node.attributes[slot.attr!];
        if (Object.keys(node.attributes).length === 0) delete node.attributes;
      }
      return;
    }
    node.attributes = node.attributes ?? {};
    node.attributes[slot.attr!] = value;
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
