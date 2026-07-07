/**
 * editor/lookDialect.ts — the two reference dialects a column's look moves
 * between (pure, node-testable; no DOM/state imports).
 *
 * A look is STORED and PLACED in explicit-reference dialect (`[$Field]`) so
 * the same tree renders anywhere — a grid cell, a view zone, a card. The
 * per-column SharePoint export speaks `@currentField`. The two converters
 * are inverses, so store→export→import round-trips the field binding:
 *
 *   · inlineColumnFormatter — `@currentField` → `[$Field]` (import a
 *     column-dialect formatter as a placeable look / component tree)
 *   · toColumnFormatter    — `[$Field]` → `@currentField` (compile a look
 *     into the column's CustomFormatter JSON at export time)
 */

import type { SPElement } from '../core/types';

/** Rewrite every string LEAF of an expression value — SPExpr is either a
 *  plain string or the AST object form ({ operator, operands }), and real
 *  imported formatters use both, nested arbitrarily. */
function mapExpr<T>(value: T, fn: (s: string) => string): T {
  if (typeof value === 'string') return fn(value) as unknown as T;
  if (Array.isArray(value)) return value.map((v) => mapExpr(v, fn)) as unknown as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = mapExpr(v, fn);
    return out as unknown as T;
  }
  return value;
}

/** Deep-clone a tree, rewriting every expression-bearing slot with `fn` —
 *  string and AST ({ operator, operands }) forms alike. */
function transformRefs(tree: SPElement, fn: (s: string) => string): SPElement {
  const clone = JSON.parse(JSON.stringify(tree)) as SPElement;
  const visit = (node: SPElement): void => {
    if (node.txtContent !== undefined) node.txtContent = mapExpr(node.txtContent, fn);
    if (node.style) node.style = mapExpr(node.style, fn);
    if (node.attributes) node.attributes = mapExpr(node.attributes, fn);
    if (node.forEach !== undefined) node.forEach = mapExpr(node.forEach, fn);
    if (node.customRowAction?.actionInput !== undefined) {
      node.customRowAction.actionInput = mapExpr(node.customRowAction.actionInput, fn);
    }
    node.children?.forEach(visit);
    if (node.customCardProps?.formatter) visit(node.customCardProps.formatter);
  };
  visit(clone);
  return clone;
}

/**
 * `@currentField` → `[$Field]`: a column-dialect formatter (an import, an
 * export sample, a pre-migration recipe) becomes a placeable explicit-ref
 * tree. Dotted props (@currentField.title) carry through.
 */
export function inlineColumnFormatter(tree: SPElement, field: string): SPElement {
  return transformRefs(tree, (s) =>
    s.replace(/@currentField(\.[A-Za-z0-9_]+)?/g, (_m, prop: string | undefined) => `[$${field}${prop ?? ''}]`));
}

/**
 * `[$Field]` → `@currentField`: compile a placeable look into the column's
 * own formatter JSON (inside a column formatter, @currentField IS the
 * column). Grid-layout artifacts (flex/min-width) are dropped from the root.
 */
export function toColumnFormatter(cell: SPElement, field: string): SPElement {
  const esc = field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`\\[\\$${esc}(?:\\.([^\\]]+))?\\]`, 'g');
  const tree = transformRefs(cell, (s) =>
    s.replace(re, (_m, prop: string | undefined) => (prop ? `@currentField.${prop}` : '@currentField')));
  if (tree.style) {
    delete tree.style['flex'];
    delete tree.style['min-width'];
    if (Object.keys(tree.style).length === 0) delete tree.style;
  }
  return tree;
}
