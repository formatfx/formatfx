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

/** Deep-clone a tree, rewriting every string-valued expression with `fn`. */
function transformRefs(tree: SPElement, fn: (s: string) => string): SPElement {
  const clone = JSON.parse(JSON.stringify(tree)) as SPElement;
  const visit = (node: SPElement): void => {
    if (typeof node.txtContent === 'string') node.txtContent = fn(node.txtContent);
    if (node.style) {
      for (const k of Object.keys(node.style)) {
        const v = node.style[k];
        if (typeof v === 'string') node.style[k] = fn(v);
      }
    }
    if (node.attributes) {
      for (const k of Object.keys(node.attributes)) {
        const v = node.attributes[k];
        if (typeof v === 'string') node.attributes[k] = fn(v);
      }
    }
    if (typeof node.forEach === 'string') node.forEach = fn(node.forEach);
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
