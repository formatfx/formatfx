// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Sam Yost. FormatFX is dual-licensed: AGPL-3.0 (see LICENSE) or a commercial license (see LICENSING.md).

/**
 * editor/paletteComponents.ts — the palette, offered as COMPONENTS (owner
 * brief 2026-07-05: "views are made up of columns and components — and the
 * components we offer are built out from the palette we've been carrying").
 *
 * Pure and schema-independent: every field-bound palette preset becomes an
 * element ComponentDef over its CANONICAL tree (the preset as authored,
 * written against the default field names — exactly how hand-written
 * built-ins are written against slot keys). Slots are typed by the preset's
 * AUTHORED INTENT (presets.ts PRESET_FIELD_TYPES): a due-date badge asks for
 * a date column even when the open schema has none — the mapping dialog then
 * refuses honestly instead of offering a wrong-typed column. Binding to the
 * live schema happens where it does for every component: bestGuessMapping at
 * preview/insert time.
 *
 * Palette components are builtin-flavored — never persisted, never deletable;
 * the palette (presets.ts) stays the single source of truth, so a preset
 * edit updates the offering on the next render.
 *
 * Deliberately offered groups only: Primitives stay on the draw toolbar
 * (they're drawing elements, not packaged formatting) and Layout Shells
 * stay with the row/tile builder (whole-row shapes live in its gallery).
 */

import { PALETTE, presetRefTypes, type PaletteItem } from './presets';
import { fieldRefsIn, widenType, type ComponentDef, type ComponentSlot } from './components';

const OFFERED_GROUPS: Array<PaletteItem['group']> = [
  'Text & Status', 'People', 'Actions', 'Data & Charts',
];

/** Stable id for a palette-derived component — `palette-<preset id>`. */
export function paletteComponentId(presetId: string): string {
  return `palette-${presetId}`;
}

/** Slot for one canonical field reference, typed by authored intent. */
function slotFor(name: string): ComponentSlot {
  const intent = presetRefTypes(name);
  const types = intent
    ? [...new Set(intent.flatMap(widenType))]
    : widenType('text'); // a ref outside the authored vocabulary: text-ish
  return { key: name, label: name, types };
}

let cache: ComponentDef[] | null = null;

/** Every palette preset offered as a component (memoized — pure constants).
 *  Field-less presets (pure decoration) stay palette-only. */
export function paletteComponents(): ComponentDef[] {
  if (cache) return cache;
  const out: ComponentDef[] = [];
  for (const item of PALETTE) {
    if (!OFFERED_GROUPS.includes(item.group)) continue;
    const root = item.create();
    root._elmName = root._elmName ?? item.label;
    const slots = fieldRefsIn(root).map(slotFor);
    if (!slots.length) continue;
    out.push({
      id: paletteComponentId(item.id),
      name: item.label,
      description: item.description,
      slots,
      root,
      builtin: true,
    });
  }
  cache = out;
  return cache;
}
