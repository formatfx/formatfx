// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Sam Yost. FormatFX is dual-licensed: AGPL-3.0 (see LICENSE) or a commercial license (see LICENSING.md).

/**
 * editor/colGroups.ts — column TAB GROUPS for the grid floor (owner brief,
 * 2026-07-05): group columns the way a browser groups tabs — a named,
 * colored band over the member columns, collapsible to a slim chip.
 *
 * PRESENTATIONAL project metadata, deliberately: groups never touch the
 * floor document (the exported row schema is byte-identical with or without
 * them), and group gestures live off the undo stack like sheet renames —
 * they autosave via 'data'. Membership is by FIELD internal name, so it
 * survives column reorders and hide/re-add round trips. A field belongs to
 * at most one group (a tab sits in one group at a time).
 *
 * Pure + node-tested (colGroups.test.ts); state.ts owns the array,
 * gridView.ts renders it.
 */

export interface ColumnGroup {
  /** Opaque, stable identity ('g1', 'g2', … — monotonic per workspace). */
  id: string;
  /** The maker-facing name ("Group 1", "People", …). */
  name: string;
  /** One of GROUP_COLORS (any hex survives the load guard, though). */
  color: string;
  /** Member field internal names, in grouping order. */
  fields: string[];
  /** Collapsed groups render as one slim chip; their columns wait intact. */
  collapsed: boolean;
}

/** The browser-tab-group palette — Fluent-flavored, works on light and dark. */
export const GROUP_COLORS: Array<{ name: string; color: string }> = [
  { name: 'Blue', color: '#0078d4' },
  { name: 'Green', color: '#107c10' },
  { name: 'Red', color: '#d13438' },
  { name: 'Purple', color: '#8764b8' },
  { name: 'Teal', color: '#038387' },
  { name: 'Orange', color: '#ca5010' },
  { name: 'Magenta', color: '#c239b3' },
  { name: 'Grey', color: '#605e5c' },
];

/** Least-used palette color, first wins ties — the browser convention. */
export function nextGroupColor(groups: ColumnGroup[]): string {
  let best = GROUP_COLORS[0].color;
  let bestCount = Infinity;
  for (const { color } of GROUP_COLORS) {
    const count = groups.filter((g) => g.color === color).length;
    if (count < bestCount) { bestCount = count; best = color; }
  }
  return best;
}

/** Next fresh group id, seeded past every existing id. */
export function nextGroupId(groups: ColumnGroup[]): string {
  let n = 0;
  for (const g of groups) {
    const m = /^g(\d+)$/.exec(g.id);
    if (m) n = Math.max(n, Number(m[1]));
  }
  return `g${n + 1}`;
}

/** Default group name — the first "Group N" not already taken. */
export function nextGroupName(groups: ColumnGroup[]): string {
  let n = groups.length + 1;
  while (groups.some((g) => g.name === `Group ${n}`)) n++;
  return `Group ${n}`;
}

/** The group `field` belongs to, if any (membership is exclusive). */
export function groupForField(groups: ColumnGroup[], field: string): ColumnGroup | undefined {
  return groups.find((g) => g.fields.includes(field));
}

/**
 * Build a new group over `fields`, stealing them from any group they were in;
 * groups emptied by the steal are dropped. Returns the next groups array plus
 * the created group (the caller decides where to store it).
 */
export function addGroup(
  groups: ColumnGroup[],
  fields: string[],
  name?: string,
): { groups: ColumnGroup[]; group: ColumnGroup } {
  const members = [...new Set(fields)];
  const kept = groups
    .map((g) => ({ ...g, fields: g.fields.filter((f) => !members.includes(f)) }))
    .filter((g) => g.fields.length > 0);
  const group: ColumnGroup = {
    id: nextGroupId(groups),
    name: name?.trim() || nextGroupName(groups),
    color: nextGroupColor(kept),
    fields: members,
    collapsed: false,
  };
  return { groups: [...kept, group], group };
}

/**
 * Load guard for the additive `floorGroups` project key: keep only
 * well-shaped groups, drop empty ones and duplicate ids, and de-duplicate
 * fields across groups (first group wins) — a guard, not a converter.
 */
export function sanitizeGroups(raw: unknown): ColumnGroup[] {
  if (!Array.isArray(raw)) return [];
  const takenFields = new Set<string>();
  const takenIds = new Set<string>();
  const out: ColumnGroup[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const g = entry as Partial<ColumnGroup>;
    if (typeof g.id !== 'string' || !g.id || takenIds.has(g.id)) continue;
    if (typeof g.name !== 'string' || !g.name.trim()) continue;
    if (typeof g.color !== 'string' || !g.color) continue;
    if (!Array.isArray(g.fields)) continue;
    const members = g.fields.filter(
      (f): f is string => typeof f === 'string' && !!f && !takenFields.has(f),
    );
    if (!members.length) continue;
    members.forEach((f) => takenFields.add(f));
    takenIds.add(g.id);
    out.push({ id: g.id, name: g.name, color: g.color, fields: members, collapsed: g.collapsed === true });
  }
  return out;
}
