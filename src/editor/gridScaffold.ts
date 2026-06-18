/**
 * editor/gridScaffold.ts — Pure document generation + mapping for the
 * grid-first workspace (DocumentKind 'grid'): the preview pane as a
 * Microsoft-Lists-style grid where each root child is one view column.
 *
 * No DOM, no state imports — node-testable, like presets.ts. The grid is a
 * row formatter in embryo: its root is the future rowFormatter flex row,
 * and grouping two columns is just wrapping two children. Everything
 * generated here arrives fully _elmName'd (a product constraint).
 */

import type { SPElement, MockField } from '../core/types';
import { cfrFieldName } from '../core/refs';

/** User-facing label for a field: display name when it differs. */
export function fieldLabel(field: MockField): string {
  return field.displayName ?? field.name;
}

/** `[$Name]` or `[$Name.prop]` — the Excel-style field reference. */
function ref(name: string, prop?: string): string {
  return prop ? `[$${name}.${prop}]` : `[$${name}]`;
}

/**
 * The faithful plain-value rendering of a field (what an unformatted Lists
 * cell shows), as a real SP formatter snippet. `fieldRef('@currentField')`
 * variants are produced by defaultColumnFormatter below.
 */
function plainCellContent(field: MockField): Partial<SPElement> {
  const n = field.name;
  switch (field.type) {
    case 'date': return { txtContent: `=toLocaleDateString(${ref(n)})` };
    case 'boolean': return { txtContent: `=if(${ref(n)},'Yes','No')` };
    case 'person': return { txtContent: ref(n, 'title') };
    case 'personMulti': return { txtContent: `=join(${ref(n, 'title')},', ')` };
    case 'lookup': return { txtContent: ref(n, 'lookupValue') };
    case 'lookupMulti': return { txtContent: `=join(${ref(n, 'lookupValue')},', ')` };
    case 'hyperlink': return { txtContent: ref(n), attributes: { href: ref(n) } };
    default: return { txtContent: ref(n) };
  }
}

/**
 * One grid column for a field: a CFR cell when the column has a registered
 * formatter (the grid renders "its current formatter", like a real list),
 * otherwise a plain-value cell. flex/min-width make the same tree lay out
 * sensibly the moment it's viewed as a row formatter.
 */
export function gridCellForField(
  field: MockField,
  columnRefs: Record<string, SPElement>,
): SPElement {
  const cell: SPElement = {
    elmType: field.type === 'hyperlink' && !(field.name in columnRefs) ? 'a' : 'div',
    _elmName: fieldLabel(field),
    style: { 'flex': '1', 'min-width': '0' },
  };
  if (field.name in columnRefs) {
    cell.columnFormatterReference = ref(field.name);
  } else {
    Object.assign(cell, plainCellContent(field));
  }
  return cell;
}

/**
 * The grid root: the future rowFormatter flex row, one child per included
 * field (default: every non-protected field, in schema order).
 */
export function buildGridRoot(
  fields: MockField[],
  columnRefs: Record<string, SPElement>,
  include?: string[],
): SPElement {
  const chosen = include
    ? include
      .map((name) => fields.find((f) => f.name === name))
      .filter((f): f is MockField => f !== undefined)
    : fields.filter((f) => !f.protected);
  return {
    elmType: 'div',
    _elmName: 'Row layout',
    style: { 'display': 'flex', 'align-items': 'center', 'width': '100%', 'gap': '12px' },
    children: chosen.map((f) => gridCellForField(f, columnRefs)),
  };
}

/**
 * A starting column formatter for "Format this column" on an unformatted
 * column — the plain value, @currentField-flavored, ready to style.
 */
export function defaultColumnFormatter(field: MockField): SPElement {
  const plain = plainCellContent(field);
  // [$Name] → @currentField, [$Name.title] → @currentField.title
  const fieldRef = new RegExp(`\\[\\$${field.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:\\.([^\\]]+))?\\]`, 'g');
  const swap = (v: unknown): unknown =>
    typeof v === 'string' ? v.replace(fieldRef, (_m, prop) => (prop ? `@currentField.${prop}` : '@currentField')) : v;
  const tree: SPElement = {
    elmType: field.type === 'hyperlink' ? 'a' : 'div',
    _elmName: `${fieldLabel(field)} formatter`,
  };
  if (plain.txtContent !== undefined) tree.txtContent = swap(plain.txtContent) as SPElement['txtContent'];
  if (plain.attributes) {
    tree.attributes = Object.fromEntries(
      Object.entries(plain.attributes).map(([k, v]) => [k, swap(v) as string]),
    );
  }
  return tree;
}

/** Every `[$Field]` reference (and CFR/inline-edit target) in a subtree. */
export function fieldRefsIn(el: SPElement): Set<string> {
  const out = new Set<string>();
  const scanString = (s: string): void => {
    for (const m of s.matchAll(/\[\$([^.\]\s]+)/g)) out.add(m[1]);
  };
  const scanValue = (v: unknown): void => {
    if (typeof v === 'string') scanString(v);
    else if (Array.isArray(v)) v.forEach(scanValue);
    else if (v && typeof v === 'object') Object.values(v).forEach(scanValue);
  };
  const walk = (node: SPElement): void => {
    if (node.columnFormatterReference) out.add(cfrFieldName(node.columnFormatterReference));
    if (node.inlineEditField) out.add(cfrFieldName(node.inlineEditField));
    if (node.defaultHoverField) out.add(cfrFieldName(node.defaultHoverField));
    scanValue(node.txtContent);
    scanValue(node.style);
    scanValue(node.attributes);
    scanValue(node.forEach);
    scanValue(node.customRowAction?.actionInput);
    node.children?.forEach(walk);
    if (node.customCardProps?.formatter) walk(node.customCardProps.formatter);
  };
  walk(el);
  return out;
}

/**
 * The single field a grid column represents, or null for composites
 * (groups) — a column stays "column-ish" while it maps to exactly one field.
 */
export function gridColumnField(el: SPElement): string | null {
  if (el.columnFormatterReference) return cfrFieldName(el.columnFormatterReference);
  const refs = fieldRefsIn(el);
  return refs.size === 1 ? [...refs][0] : null;
}

/** Header label for a grid column. */
export function gridColumnLabel(el: SPElement, fields: MockField[]): string {
  if (el._elmName) return el._elmName;
  const fieldName = gridColumnField(el);
  if (fieldName) {
    const field = fields.find((f) => f.name === fieldName);
    return field ? fieldLabel(field) : fieldName;
  }
  return `<${el.elmType}>`;
}

/** Roadmap-contract name for a generated group: "Status + DueDate group". */
export function groupName(targetLabel: string, draggedLabel: string): string {
  return `${targetLabel} + ${draggedLabel} group`;
}

/**
 * True while every column still maps to a single field — i.e. the grid is
 * pure scaffolding with no groups/composites. Schema import only rebuilds
 * pure grids; a layout someone has started building is never clobbered.
 */
export function isPureGrid(root: SPElement): boolean {
  if (!root.children?.length) return false;
  return root.children.every((c) => gridColumnField(c) !== null);
}

/** Fields not yet represented anywhere in the grid (for "+ column"). */
export function unplacedFields(root: SPElement, fields: MockField[]): MockField[] {
  const placed = fieldRefsIn(root);
  return fields.filter((f) => !placed.has(f.name));
}
