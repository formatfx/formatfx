// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Sam Yost. FormatFX is dual-licensed: AGPL-3.0-only (see LICENSE) or a commercial license (see LICENSING.md).

/**
 * editor/componentUsage.ts — the pure inventory brain behind the ⬡ tab's
 * "In this project" section: where is each component USED in this project?
 * DOM- and state-free (node-tested), like gridScaffold/areas/lookDialect.
 *
 * One provenance channel feeds the scan: the instance stamp —
 * bindComponentInstance marks a bound root with `_component: { id, map }`.
 * Stamps are found anywhere in the main (view) doc, card content included,
 * and inside each column's LOOK tree (state.columnLooks). A column counts
 * ONCE per component no matter how many stamps its look carries, and only
 * ids an actual def carries are reported — a deleted component leaves no
 * ghost rows.
 */

import type { SPElement, NodePath } from '../core/types';
import type { ComponentDef } from './components';

/** Mirrors state.ts's path convention: segment -1 descends into
 *  customCardProps.formatter (kept local — this module never imports state). */
const CARD_SEGMENT = -1;

/** One stamped instance in the main (view) doc, addressable by NodePath. */
export interface ComponentViewUsage {
  kind: 'view';
  path: NodePath;
  /** The subtree's _elmName, else the def's name — the jump row's label. */
  label: string;
}

/** One column whose LOOK uses the component (a stamped subtree in its tree). */
export interface ComponentColumnUsage {
  kind: 'column';
  field: string;
}

export type ComponentUsage = ComponentViewUsage | ComponentColumnUsage;

/**
 * Scan the project for component usages. `mainRoot` is the active surface's
 * document root, `columnLooks` the per-column look store (field name → baked
 * look tree). Returns usages per component id; defs with no usage have NO
 * entry, so the count is `map.get(id)?.length ?? 0`.
 */
export function scanComponentUsages(
  defs: ComponentDef[],
  mainRoot: SPElement | undefined,
  columnLooks: Record<string, SPElement>,
): Map<string, ComponentUsage[]> {
  const byId = new Map(defs.map((d) => [d.id, d]));
  const out = new Map<string, ComponentUsage[]>();
  const add = (id: string, u: ComponentUsage): void => {
    const list = out.get(id);
    if (list) list.push(u);
    else out.set(id, [u]);
  };

  // view usages: every stamped subtree — children AND card content
  const walkView = (el: SPElement, path: NodePath): void => {
    const def = el._component && byId.get(el._component.id);
    if (def) add(def.id, { kind: 'view', path, label: el._elmName ?? def.name });
    el.children?.forEach((c, i) => walkView(c, [...path, i]));
    if (el.customCardProps?.formatter) walkView(el.customCardProps.formatter, [...path, CARD_SEGMENT]);
  };
  if (mainRoot) walkView(mainRoot, []);

  // column usages: stamped subtrees in each look (normally the root itself),
  // collapsed to ONE usage per (component, column)
  const stampedIn = (el: SPElement, ids: Set<string>): void => {
    if (el._component && byId.has(el._component.id)) ids.add(el._component.id);
    el.children?.forEach((c) => stampedIn(c, ids));
    if (el.customCardProps?.formatter) stampedIn(el.customCardProps.formatter, ids);
  };
  for (const [name, tree] of Object.entries(columnLooks)) {
    const ids = new Set<string>();
    stampedIn(tree, ids);
    for (const id of ids) add(id, { kind: 'column', field: name });
  }
  return out;
}

/** The jump-row label for a MAIN-doc usage — the main doc is always a view
 *  (or the grid) now, so the label is uniform. */
export function mainUsageLabel(u: ComponentViewUsage): string {
  return `View — ${u.label}`;
}
