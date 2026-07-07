// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Sam Yost. FormatFX is dual-licensed: AGPL-3.0 (see LICENSE) or a commercial license (see LICENSING.md).

/**
 * editor/cfr.ts — Pure brain for Stage 4, the CFR linked-instance (Figma)
 * model. A grid cell with a columnFormatterReference is a LINKED INSTANCE of a
 * column's shared format; a plain styled cell is LOCAL ("yours"). This module
 * has no DOM/state imports (node-testable, like gridScaffold/areas):
 *
 *   · cfrBlastRadius   — where a column's format is linked (change-everywhere
 *                        scope)
 *   · inlineColumnFormatter — fork a linked instance to a local copy
 *                        ("override in this view"): @currentField → [$Field]
 *   · toColumnFormatter — promote a local cell to the column's shared format
 *                        ("save as the column's format"): [$Field] → @currentField
 *
 * The two ref swaps are inverses, so fork→promote round-trips the field binding.
 */

import type { SPElement } from '../core/types';
import { cfrFieldName } from '../core/refs';

/** Count columnFormatterReferences to `field` in a subtree. */
function countCfrIn(el: SPElement | undefined, field: string): number {
  if (!el) return 0;
  let n = 0;
  const walk = (node: SPElement): void => {
    if (node.columnFormatterReference && cfrFieldName(node.columnFormatterReference) === field) n += 1;
    node.children?.forEach(walk);
    if (node.customCardProps?.formatter) walk(node.customCardProps.formatter);
  };
  walk(el);
  return n;
}

/**
 * The blast radius of a column's shared format: every linked instance of it,
 * across the main (view) formatter and any OTHER registered column formatters.
 * `count` is how many places change if you "change everywhere".
 */
export function cfrBlastRadius(
  field: string,
  mainRoot: SPElement | undefined,
  columnRefs: Record<string, SPElement>,
): { count: number; places: string[] } {
  const places: string[] = [];
  let count = 0;
  const inMain = countCfrIn(mainRoot, field);
  if (inMain > 0) { count += inMain; places.push(inMain > 1 ? `the view (${inMain}×)` : 'the view'); }
  for (const [name, tree] of Object.entries(columnRefs)) {
    if (name === field) continue; // a formatter referencing itself isn't a place
    const c = countCfrIn(tree, field);
    if (c > 0) { count += c; places.push(`the ${name} formatter`); }
  }
  return { count, places };
}

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
 * Fork a registered column formatter into a LOCAL cell ("override in this view"): the
 * formatter is written in @currentField terms (it's resolved as a CFR), but a
 * local cell renders under the row context, so @currentField must become the
 * explicit [$Field] reference. Dotted props (@currentField.title) carry through.
 */
export function inlineColumnFormatter(tree: SPElement, field: string): SPElement {
  return transformRefs(tree, (s) =>
    s.replace(/@currentField(\.[A-Za-z0-9_]+)?/g, (_m, prop: string | undefined) => `[$${field}${prop ?? ''}]`));
}

/**
 * Promote a local single-field cell to the column's shared format ("save as the
 * column's format"): inside a column formatter @currentField IS the column, so
 * the cell's explicit [$Field] references become @currentField. Grid-layout
 * artifacts (flex/min-width) and any stale CFR are dropped from the root.
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
  delete tree.columnFormatterReference;
  return tree;
}
