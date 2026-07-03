/**
 * editor/componentUsage.ts — the pure inventory brain behind the ⬡ tab's
 * "In this project" section: where is each component USED in this project?
 * DOM- and state-free (node-tested), like gridScaffold/areas/cfr.
 *
 * Two provenance channels feed the scan:
 *   · stamped instances — bindComponentInstance marks a bound root with
 *     `_component: { id, map }`; found anywhere in the main (view) doc, card
 *     content included, and inside registered column-formatter trees
 *   · the field tag — the Format-this-column catalog writes the component id
 *     to `field.subtype` when a column wears one (recipe in columnRefs)
 * A column counts ONCE per component even when both channels agree, and only
 * ids an actual def carries are reported — a deleted component leaves no
 * ghost rows.
 */

import type { SPElement, MockField, NodePath } from '../core/types';
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

/** One column whose registered formatter uses the component (via the field's
 *  subtype tag, a stamped subtree, or both — always a single usage). */
export interface ComponentColumnUsage {
  kind: 'column';
  field: string;
}

export type ComponentUsage = ComponentViewUsage | ComponentColumnUsage;

/**
 * Scan the project for component usages. `mainRoot` is the main (view) doc's
 * root (pass the stashed one while drilled into a column — state's
 * `mainRootForScope`), `columnRefs` the registered column formatters, and
 * `fields` the schema (subtype tags carry component ids). Returns usages per
 * component id; defs with no usage have NO entry, so the count is
 * `map.get(id)?.length ?? 0`.
 */
export function scanComponentUsages(
  defs: ComponentDef[],
  mainRoot: SPElement | undefined,
  columnRefs: Record<string, SPElement>,
  fields: MockField[],
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

  // column usages: the field tag + stamped subtrees in the registered tree,
  // collapsed to ONE usage per (component, column)
  const stampedIn = (el: SPElement, ids: Set<string>): void => {
    if (el._component && byId.has(el._component.id)) ids.add(el._component.id);
    el.children?.forEach((c) => stampedIn(c, ids));
    if (el.customCardProps?.formatter) stampedIn(el.customCardProps.formatter, ids);
  };
  for (const [name, tree] of Object.entries(columnRefs)) {
    const ids = new Set<string>();
    const tag = fields.find((f) => f.name === name)?.subtype;
    if (tag && byId.has(tag)) ids.add(tag);
    stampedIn(tree, ids);
    for (const id of ids) add(id, { kind: 'column', field: name });
  }
  return out;
}
