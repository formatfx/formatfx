/**
 * editor/multiSelect.ts — property computation across a multi-selection (pure).
 *
 * When several nodes are selected, the Left Edit Pane shows the UNION of their
 * properties; a property whose value differs across nodes is "divergent" and
 * gets a per-node breakdown, while editing it writes the new value to ALL
 * selected nodes. This module computes that union/divergence. DOM-free and
 * state-free → unit-tested directly (multiSelect.test.ts).
 */

import type { SPElement, SPExpr } from '../core/types';

/** A value that is either uniform across the selection, or divergent. */
export type Unified<T> =
  | { uniform: true; value: T }
  | { uniform: false; values: T[] };

/** Structural equality good enough for SP values (strings, numbers, AST objects). */
export function valuesEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Collapse a list of values to uniform (all equal) or divergent. */
export function unify<T>(values: T[]): Unified<T> {
  if (values.length <= 1) return { uniform: true, value: values[0] as T };
  const first = values[0];
  for (let i = 1; i < values.length; i++) {
    if (!valuesEqual(values[i], first)) return { uniform: false, values };
  }
  return { uniform: true, value: first };
}

/** Read a value off every item, then unify. */
export function unifyBy<T, V>(items: T[], read: (item: T) => V): Unified<V> {
  return unify(items.map(read));
}

/** Every style property set (to a defined value) on ANY node — union, first-seen order. */
export function unionStyleProps(nodes: SPElement[]): string[] {
  return unionKeys(nodes.map((n) => n.style));
}

/** Every attribute set on ANY node — union, first-seen order. */
export function unionAttrs(nodes: SPElement[]): string[] {
  return unionKeys(nodes.map((n) => n.attributes));
}

function unionKeys(maps: Array<Record<string, SPExpr | undefined> | undefined>): string[] {
  const order: string[] = [];
  const seen = new Set<string>();
  for (const map of maps) {
    if (!map) continue;
    for (const key of Object.keys(map)) {
      if (map[key] === undefined) continue;
      if (!seen.has(key)) { seen.add(key); order.push(key); }
    }
  }
  return order;
}

/** The shared value of one style property across the selection, or divergent. */
export function styleAcross(nodes: SPElement[], prop: string): Unified<SPExpr | undefined> {
  return unifyBy(nodes, (n) => n.style?.[prop]);
}

/** The shared value of one attribute across the selection, or divergent. */
export function attrAcross(nodes: SPElement[], attr: string): Unified<SPExpr | undefined> {
  return unifyBy(nodes, (n) => n.attributes?.[attr]);
}

/** The shared txtContent across the selection, or divergent. */
export function txtContentAcross(nodes: SPElement[]): Unified<SPExpr | undefined> {
  return unifyBy(nodes, (n) => n.txtContent);
}
