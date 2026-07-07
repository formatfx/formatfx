// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Sam Yost. FormatFX is dual-licensed: AGPL-3.0 (see LICENSE) or a commercial license (see LICENSING.md).

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
import { STYLE_VALUE_SUGGESTIONS } from '../core/schema';

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
  /** A richer value chooser this slot prefers (e.g. the Fluent icon gallery). */
  picker?: 'icon';
  /** One-line guidance: what the property does and what value it takes. */
  hint: string;
}

/** Elements that render text (so text + type slots are offered). */
const TEXT_CAPABLE = new Set(['div', 'span', 'a', 'p', 'button']);

const TEXT_HINT = 'The text shown in the cell — plain words, a column’s value, or a formula.';

type StyleDef = { id: string; label: string; prop: string; hint: string };

/** Box/paint slots — offered on every element. Each hint says what value it takes. */
const BOX_SLOTS: StyleDef[] = [
  { id: 'fill', label: 'Fill color', prop: 'background-color', hint: 'Background colour — a hex like #107c10, or a theme name.' },
  { id: 'leftBorder', label: 'Left border', prop: 'border-left', hint: 'A coloured bar down the left edge — e.g. 3px solid #d13438.' },
  { id: 'radius', label: 'Corner radius', prop: 'border-radius', hint: 'Rounds the corners — a length like 4px, or 50% for a circle.' },
  { id: 'opacity', label: 'Opacity', prop: 'opacity', hint: 'How see-through it is — 1 is solid, 0 is invisible (try 0.6).' },
];

/** Type slots — only where the element renders text. */
const TYPE_SLOTS: StyleDef[] = [
  { id: 'ink', label: 'Text color', prop: 'color', hint: 'Text colour — a hex like #d13438, or a theme name.' },
  { id: 'weight', label: 'Bold / weight', prop: 'font-weight', hint: 'How bold the text is — 400 normal, 600 semibold, 700 bold.' },
  { id: 'fontSize', label: 'Text size', prop: 'font-size', hint: 'Text size — a length like 12px or 16px.' },
  { id: 'align', label: 'Text align', prop: 'text-align', hint: 'Text alignment — left, center or right.' },
];

/** Element-specific attribute slots (only shown where they apply). */
function attrSlotsFor(elmType: string): FxSlot[] {
  if (elmType === 'img') {
    return [{ id: 'src', label: 'Image URL', kind: 'attr', attr: 'src', hint: 'The image address (URL) — usually a formula off a column.' }];
  }
  if (elmType === 'a') {
    return [{ id: 'href', label: 'Link URL', kind: 'attr', attr: 'href', hint: 'The link address (URL) — usually a formula off a column.' }];
  }
  return [];
}

/** Turn a CSS property into a readable label: 'border-radius' → 'Border radius'. */
export function humanizeProp(prop: string): string {
  const words = prop.replace(/^-+/, '').replace(/-/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * The fx bar's canonical slot id for a CSS property. Curated properties map to
 * their named slot ('color' → 'ink', 'background-color' → 'fill', …); anything
 * else addresses the generic `style:<prop>` slot that slotsFor() surfaces for a
 * property already on the element. Lets other panels (the inspector's `=`
 * formula preview) hand a property to the bar via focusFxSlot().
 */
const SLOT_ID_BY_PROP: Record<string, string> = {
  'color': 'ink',
  'background-color': 'fill',
  'font-weight': 'weight',
  'font-size': 'fontSize',
  'text-align': 'align',
  'border-radius': 'radius',
  'opacity': 'opacity',
  'border-left': 'leftBorder',
};
export function slotIdForProp(prop: string): string {
  return SLOT_ID_BY_PROP[prop] ?? `style:${prop}`;
}

/** Hint for an arbitrary CSS property, seeded with playground value examples. */
function genericHint(prop: string): string {
  const examples = (STYLE_VALUE_SUGGESTIONS[prop] ?? []).filter((v) => !v.startsWith('=')).slice(0, 3);
  return examples.length
    ? `${humanizeProp(prop)} — e.g. ${examples.join(', ')}.`
    : `${humanizeProp(prop)} — a CSS value, or a formula.`;
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
  // an element carrying a Fluent icon gets an Icon slot (gallery-backed), so the
  // iconName attribute is editable from the fx bar like any other property
  if (node.attributes?.iconName !== undefined) {
    out.push({
      id: 'attr:iconName', label: 'Icon', kind: 'attr', attr: 'iconName', picker: 'icon',
      hint: 'The Fluent icon shown in this cell — pick from the gallery (with previews) or type a name.',
    });
  }

  const covered = new Set(out.filter((s) => s.prop).map((s) => s.prop!));
  for (const prop of Object.keys(node.style ?? {})) {
    if (covered.has(prop)) continue;
    covered.add(prop);
    out.push({ id: `style:${prop}`, label: humanizeProp(prop), kind: 'style', prop, hint: genericHint(prop) });
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
