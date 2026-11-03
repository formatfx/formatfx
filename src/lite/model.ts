// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Sam Yost

/**
 * lite/model.ts — the free-layout card model behind FormatFX Lite.
 *
 * A Lite card is an ordinary SharePoint gallery (tile) formatter with one
 * convention: the root is `position: relative` at the tile's exact size, and
 * every PART is a direct child with `position: absolute` and literal px
 * left/top/width/height. That convention is what makes a part draggable,
 * resizable and nudgeable — and it is plain, schema-valid JSON, so
 * SharePoint needs nothing special to render it.
 *
 * Pure: no DOM. Every edit returns a new document, so undo is "keep the old
 * one" and one gesture = one undoable mutation.
 */

import type { SPElement, SPExpr, FormatterDocument, MockField, FieldType } from '../core/types';
import { exportJson } from '../core/serializer';
import { lintDocument, type LintIssue } from '../core/linter';

export interface Rect { x: number; y: number; w: number; h: number }

/** What the maker has selected: a part (its index in root.children) or the card. */
export type Target = number | 'card';

export type PartKind = 'text' | 'shape' | 'image' | 'group';

export const DEFAULT_W = 254;
export const DEFAULT_H = 236;
export const MIN_SIZE = 4;
/** The inset the starters use; snapping offers it as a guide. */
export const CARD_MARGIN = 16;

// ─── reading values ──────────────────────────────────────────────────────────

/** A literal "12px" → 12. Expressions, %, auto and the rest → null. */
export function px(v: SPExpr | undefined): number | null {
  if (typeof v !== 'string') return null;
  const m = /^\s*(-?\d+(?:\.\d+)?)px\s*$/.exec(v);
  return m ? Number(m[1]) : null;
}

/** True when SharePoint computes the value per item (an expression). */
export function isRule(v: SPExpr | undefined): boolean {
  if (v === undefined) return false;
  return typeof v !== 'string' || v.trim().startsWith('=');
}

function leadingPx(v: SPExpr | undefined): number | null {
  if (typeof v !== 'string' || isRule(v)) return null;
  const m = /^\s*(\d+(?:\.\d+)?)px\b/.exec(v);
  return m ? Number(m[1]) : null;
}

export function isClickOverlay(el: SPElement): boolean {
  const cls = el.attributes?.class;
  return typeof cls === 'string' && /\bsp-card-defaultClickButton\b/.test(cls);
}

/** A part's box, or null when the element is not a free-layout part. */
export function partRect(el: SPElement): Rect | null {
  const s = el.style ?? {};
  if (s.position !== 'absolute') return null;
  const x = px(s.left), y = px(s.top), w = px(s.width), h = px(s.height);
  if (x === null || y === null || w === null || h === null) return null;
  return { x, y, w, h };
}

export function partKind(el: SPElement): PartKind {
  if (el.elmType === 'img') return 'image';
  if (el.children?.length) return 'group';
  return el.txtContent !== undefined ? 'text' : 'shape';
}

export function cardSize(doc: FormatterDocument): { w: number; h: number } {
  return { w: doc.tileWidth ?? DEFAULT_W, h: doc.tileHeight ?? DEFAULT_H };
}

export function borderWidth(root: SPElement): number {
  const s = root.style ?? {};
  return px(s['border-width']) ?? leadingPx(s.border) ?? 0;
}

/** The area parts are positioned in: the card minus its border. */
export function innerSize(doc: FormatterDocument): { w: number; h: number } {
  const { w, h } = cardSize(doc);
  const b = borderWidth(doc.root);
  return { w: w - 2 * b, h: h - 2 * b };
}

/** Indices of root.children that are parts (the click overlay is not). */
export function partIndices(doc: FormatterDocument): number[] {
  const out: number[] = [];
  (doc.root.children ?? []).forEach((c, i) => {
    if (!isClickOverlay(c) && partRect(c)) out.push(i);
  });
  return out;
}

/** Can Lite edit this card as-is (no flatten needed)? */
export function isFreeCard(doc: FormatterDocument): boolean {
  if (doc.kind !== 'tile' || doc.root.style?.position !== 'relative') return false;
  return (doc.root.children ?? []).every((c) => isClickOverlay(c) || partRect(c) !== null);
}

// ─── field binding (text parts) ──────────────────────────────────────────────

const MULTI: FieldType[] = ['personMulti', 'lookupMulti', 'choiceMulti'];

/** Fields a text part can show on its own (multi-value fields need a loop). */
export function bindableFields(fields: MockField[]): MockField[] {
  return fields.filter((f) => !MULTI.includes(f.type));
}

/** The txtContent that shows a field the way SharePoint makers expect. */
export function fieldText(field: MockField): string {
  const ref = `[$${field.name}]`;
  switch (field.type) {
    case 'person': return `[$${field.name}.title]`;
    case 'lookup': return `[$${field.name}.lookupValue]`;
    // the main app's verified empty-date guard: toLocaleDateString('') is
    // not safe to show raw
    case 'date': return `=if(toString(${ref})=='','',toLocaleDateString(${ref}))`;
    default: return ref;
  }
}

const PLAIN_REF = /^\[\$([A-Za-z_][A-Za-z0-9_]*)(?:\.(?:title|lookupValue))?\]$/;
const DATE_REF = /^=if\(toString\(\[\$([A-Za-z_][A-Za-z0-9_]*)\]\)=='','',toLocaleDateString\(\[\$\1\]\)\)$/;

/** The field a text part shows, when it shows exactly one field and nothing else. */
export function boundField(txt: SPExpr | undefined): string | null {
  if (typeof txt !== 'string') return null;
  const t = txt.trim();
  return PLAIN_REF.exec(t)?.[1] ?? DATE_REF.exec(t)?.[1] ?? null;
}

export function partName(el: SPElement): string {
  if (typeof el._elmName === 'string' && el._elmName) return el._elmName;
  const field = boundField(el.txtContent);
  if (field) return field;
  return { text: 'Text', shape: 'Shape', image: 'Picture', group: 'Group' }[partKind(el)];
}

// ─── edits (each returns a new document) ─────────────────────────────────────

function withChildren(doc: FormatterDocument, children: SPElement[]): FormatterDocument {
  return { ...doc, root: { ...doc.root, children } };
}

export function updatePart(doc: FormatterDocument, i: number, fn: (el: SPElement) => SPElement): FormatterDocument {
  const children = [...(doc.root.children ?? [])];
  if (!children[i]) return doc;
  children[i] = fn(children[i]);
  return withChildren(doc, children);
}

export function withRect(el: SPElement, r: Rect): SPElement {
  return {
    ...el,
    style: {
      ...(el.style ?? {}),
      position: 'absolute',
      left: `${Math.round(r.x)}px`,
      top: `${Math.round(r.y)}px`,
      width: `${Math.round(r.w)}px`,
      height: `${Math.round(r.h)}px`,
    },
  };
}

/**
 * Keep a text part looking right when the maker resizes its box (they drag;
 * Lite does the arithmetic). Only parts with a px line height take part —
 * without one, Lite can't know where the lines fall, so it leaves them be.
 *  - A one-line part whose line height matched its height (pills, badges)
 *    stays vertically centred.
 *  - A wrapping part's height snaps to whole lines (and a line clamp follows),
 *    so a box never shows a cut-off extra line.
 */
function fitText(el: SPElement, before: Rect | null): SPElement {
  const r = partRect(el);
  const s = el.style;
  const lh = px(s?.['line-height']);
  if (!r || !s || !lh || !before || before.h === r.h || el.txtContent === undefined || el.children?.length) return el;
  if (s['white-space'] === 'nowrap') {
    return lh === before.h ? { ...el, style: { ...s, 'line-height': `${r.h}px` } } : el;
  }
  const lines = Math.max(1, Math.round(r.h / lh));
  const h = lines * lh;
  const fromTop = before.y !== r.y && before.y + before.h === r.y + r.h; // the top edge moved
  let out = withRect(el, { ...r, y: fromTop ? r.y + r.h - h : r.y, h });
  if (s.display === '-webkit-box') out = { ...out, style: { ...out.style, '-webkit-line-clamp': String(lines) } };
  return out;
}

export function setPartRect(doc: FormatterDocument, i: number, r: Rect): FormatterDocument {
  return updatePart(doc, i, (el) => fitText(withRect(el, r), partRect(el)));
}

/**
 * Change a text part's size without breaking its box:
 *  - a centred one-line part keeps its centring, and its box grows if the
 *    bigger text no longer fits;
 *  - other text scales its line height in proportion;
 *  - wrapping text keeps its number of lines, and the box follows.
 */
export function setFontSize(doc: FormatterDocument, i: number, size: number): FormatterDocument {
  return updatePart(doc, i, (el) => {
    const s = el.style ?? {};
    const r = partRect(el);
    const fs = px(s['font-size']);
    const lh = px(s['line-height']);
    const style: Record<string, SPExpr> = { ...s, 'font-size': `${size}px` };
    const sized = { ...el, style: style as SPElement['style'] };
    if (!r || !fs || !lh) return sized;
    if (s['white-space'] === 'nowrap') {
      const line = lh === r.h ? Math.max(r.h, Math.ceil(size * 1.4)) : Math.round((size * lh) / fs);
      const next = { ...el, style: { ...style, 'line-height': `${line}px` } as SPElement['style'] };
      return line > r.h ? withRect(next, { ...r, h: line }) : next;
    }
    const lines = (s.display === '-webkit-box' && Number(s['-webkit-line-clamp'])) || Math.max(1, Math.round(r.h / lh));
    const line = Math.round((size * lh) / fs);
    return withRect({ ...el, style: { ...style, 'line-height': `${line}px` } as SPElement['style'] }, { ...r, h: lines * line });
  });
}

/** Set (or with undefined, remove) one style property on a part or the card. */
export function setStyle(doc: FormatterDocument, t: Target, prop: string, value: string | undefined): FormatterDocument {
  const apply = (el: SPElement): SPElement => {
    const style = { ...(el.style ?? {}) };
    if (value === undefined) delete style[prop]; else style[prop] = value;
    return { ...el, style };
  };
  return t === 'card' ? { ...doc, root: apply(doc.root) } : updatePart(doc, t, apply);
}

/** Several style changes as ONE edit (one undo step). */
export function setStyles(doc: FormatterDocument, t: Target, changes: Record<string, string | undefined>): FormatterDocument {
  let out = doc;
  for (const [prop, value] of Object.entries(changes)) out = setStyle(out, t, prop, value);
  return out;
}

export function setText(doc: FormatterDocument, i: number, txt: string): FormatterDocument {
  return updatePart(doc, i, (el) => ({ ...el, txtContent: txt }));
}

export function setAttribute(doc: FormatterDocument, i: number, key: string, value: string): FormatterDocument {
  return updatePart(doc, i, (el) => ({ ...el, attributes: { ...(el.attributes ?? {}), [key]: value } }));
}

export function renamePart(doc: FormatterDocument, i: number, name: string): FormatterDocument {
  return updatePart(doc, i, (el) => ({ ...el, _elmName: name }));
}

export function addPart(doc: FormatterDocument, el: SPElement): { doc: FormatterDocument; index: number } {
  const children = [...(doc.root.children ?? []), el];
  return { doc: withChildren(doc, children), index: children.length - 1 };
}

export function removePart(doc: FormatterDocument, i: number): FormatterDocument {
  const children = [...(doc.root.children ?? [])];
  children.splice(i, 1);
  return withChildren(doc, children);
}

export function duplicatePart(doc: FormatterDocument, i: number): { doc: FormatterDocument; index: number } {
  const el = doc.root.children?.[i];
  const r = el && partRect(el);
  if (!el || !r) return { doc, index: i };
  const copy = withRect(JSON.parse(JSON.stringify(el)) as SPElement, { ...r, x: r.x + 8, y: r.y + 8 });
  const children = [...(doc.root.children ?? [])];
  children.splice(i + 1, 0, copy);
  return { doc: withChildren(doc, children), index: i + 1 };
}

/** Move a part one step up (+1, toward the front) or down (-1) the stack. */
export function moveLayer(doc: FormatterDocument, i: number, dir: 1 | -1): { doc: FormatterDocument; index: number } {
  const parts = partIndices(doc);
  const at = parts.indexOf(i);
  const j = parts[at + dir];
  if (at < 0 || j === undefined) return { doc, index: i };
  const children = [...(doc.root.children ?? [])];
  [children[i], children[j]] = [children[j], children[i]];
  return { doc: withChildren(doc, children), index: j };
}

/** Resize the card (the tile box AND the root, which must stay in step). */
export function setCardSize(doc: FormatterDocument, w: number, h: number): FormatterDocument {
  const W = Math.max(80, Math.round(w)), H = Math.max(40, Math.round(h));
  const style = { ...(doc.root.style ?? {}), width: `${W}px`, height: `${H}px` };
  return { ...doc, tileWidth: W, tileHeight: H, root: { ...doc.root, style } };
}

// ─── new parts ───────────────────────────────────────────────────────────────

const INK = '#323130';
const MUTED = '#605e5c';

export function centered(doc: FormatterDocument, w: number, h: number): Rect {
  const inner = innerSize(doc);
  return { x: Math.round((inner.w - w) / 2), y: Math.round((inner.h - h) / 2), w, h };
}

export function newText(field: MockField, at: Rect): SPElement {
  return withRect({
    elmType: 'div',
    _elmName: field.displayName ?? field.name,
    txtContent: fieldText(field),
    style: {
      'font-size': '13px', 'line-height': '18px', color: INK,
      'white-space': 'nowrap', overflow: 'hidden', 'text-overflow': 'ellipsis',
    },
  }, at);
}

export function newShape(at: Rect): SPElement {
  return withRect({
    elmType: 'div', _elmName: 'Shape',
    style: { 'background-color': '#deecf9', 'border-radius': '4px' },
  }, at);
}

export function newPhoto(person: MockField, at: Rect): SPElement {
  return withRect({
    elmType: 'img', _elmName: `${person.displayName ?? person.name} photo`,
    attributes: { src: `=getUserImage([$${person.name}.email],'s')`, title: `[$${person.name}.title]` },
    style: { 'border-radius': '50%', 'object-fit': 'cover' },
  }, at);
}

// ─── the card and the starters ───────────────────────────────────────────────

/** SharePoint's own "click the card to open the item" overlay (the verified
 *  sp-card-defaultClickButton pattern from the main app's presets). Not a
 *  part: Lite pins it as the first child and never lets it be selected. */
export function clickOverlay(): SPElement {
  return {
    elmType: 'div',
    _elmName: 'Open item',
    attributes: { class: 'sp-card-defaultClickButton', role: 'button', title: 'Open item' },
    customRowAction: { action: 'defaultClick' },
  };
}

export function makeCard(w: number, h: number, paint: Record<string, string>, parts: SPElement[]): FormatterDocument {
  return {
    kind: 'tile',
    tileWidth: w,
    tileHeight: h,
    hideSelection: false,
    fillHorizontally: false,
    root: {
      elmType: 'div',
      _elmName: 'Card',
      style: {
        position: 'relative', width: `${w}px`, height: `${h}px`,
        overflow: 'hidden', 'box-sizing': 'border-box', ...paint,
      },
      children: [clickOverlay(), ...parts],
    },
  };
}

const CARD_PAINT = {
  'background-color': '#ffffff',
  'border-width': '1px', 'border-style': 'solid', 'border-color': '#edebe9',
  'border-radius': '8px',
};

const statusRule = (done: string, blocked: string, active: string, idle: string): string =>
  `=if([$Status]=='Done','${done}',if([$Status]=='Blocked','${blocked}',if([$Status]=='In Progress','${active}','${idle}')))`;

const box = (x: number, y: number, w: number, h: number): Rect => ({ x, y, w, h });

const oneLine = { 'white-space': 'nowrap', overflow: 'hidden', 'text-overflow': 'ellipsis' };

function text(name: string, txt: string, r: Rect, style: Record<string, string>): SPElement {
  return withRect({ elmType: 'div', _elmName: name, txtContent: txt, style: { ...oneLine, ...style } }, r);
}

function shape(name: string, r: Rect, style: Record<string, string>): SPElement {
  return withRect({ elmType: 'div', _elmName: name, style }, r);
}

function progressBar(r: Rect): SPElement {
  return withRect({
    elmType: 'div', _elmName: 'Progress bar',
    style: { 'background-color': '#edebe9', 'border-radius': '3px', overflow: 'hidden' },
    children: [{
      elmType: 'div',
      style: { width: "=if([$Progress]>100,'100%',[$Progress]+'%')", height: '100%', 'background-color': '#0078d4' },
    }],
  }, r);
}

const photo = (r: Rect): SPElement => withRect({
  elmType: 'img', _elmName: 'Owner photo',
  attributes: { src: "=getUserImage([$Owner.email],'s')", title: '[$Owner.title]' },
  style: { 'border-radius': '50%', 'object-fit': 'cover' },
}, r);

const DUE = "=if(toString([$DueDate])=='','No due date','Due '+toLocaleDateString([$DueDate]))";

function taskCard(): FormatterDocument {
  return makeCard(254, 236, CARD_PAINT, [
    shape('Status stripe', box(0, 0, 252, 6), { 'background-color': statusRule('#107c10', '#d13438', '#0078d4', '#a19f9d') }),
    withRect({
      elmType: 'div', _elmName: 'Title', txtContent: '[$Title]',
      style: {
        'font-size': '16px', 'font-weight': '600', 'line-height': '22px', color: INK,
        display: '-webkit-box', '-webkit-box-orient': 'vertical', '-webkit-line-clamp': '2', overflow: 'hidden',
      },
    }, box(16, 22, 220, 44)),
    text('Status pill', '[$Status]', box(16, 76, 96, 24), {
      'font-size': '12px', 'font-weight': '600', 'line-height': '24px', 'text-align': 'center', 'border-radius': '12px',
      'background-color': statusRule('#dff6dd', '#fde7e9', '#deecf9', '#f3f2f1'),
      color: statusRule('#107c10', '#a4262c', '#004578', MUTED),
    }),
    text('Due date', DUE, box(124, 76, 112, 24), { 'font-size': '12px', 'line-height': '24px', 'text-align': 'right', color: MUTED }),
    shape('Divider', box(16, 116, 220, 1), { 'background-color': '#edebe9' }),
    photo(box(16, 132, 32, 32)),
    text('Owner', '[$Owner.title]', box(56, 132, 180, 18), { 'font-size': '13px', 'font-weight': '600', 'line-height': '18px', color: INK }),
    text('Project', '[$Project.lookupValue]', box(56, 150, 180, 16), { 'font-size': '12px', 'line-height': '16px', color: MUTED }),
    progressBar(box(16, 186, 220, 6)),
    text('Progress label', "=[$Progress]+'% done'", box(16, 198, 220, 16), { 'font-size': '11px', 'line-height': '16px', color: MUTED }),
  ]);
}

function headerCard(): FormatterDocument {
  return makeCard(254, 196, CARD_PAINT, [
    shape('Header', box(0, 0, 252, 60), { 'background-color': '#0078d4' }),
    text('Project', '[$Project.lookupValue]', box(16, 10, 220, 16), { 'font-size': '11px', 'font-weight': '600', 'line-height': '16px', color: '#c7e0f4' }),
    text('Title', '[$Title]', box(16, 28, 220, 22), { 'font-size': '15px', 'font-weight': '600', 'line-height': '22px', color: '#ffffff' }),
    photo(box(16, 76, 40, 40)),
    text('Owner', '[$Owner.title]', box(66, 78, 170, 18), { 'font-size': '13px', 'font-weight': '600', 'line-height': '18px', color: INK }),
    text('Status', '[$Status]', box(66, 98, 170, 16), {
      'font-size': '12px', 'font-weight': '600', 'line-height': '16px', color: statusRule('#107c10', '#a4262c', '#005a9e', MUTED),
    }),
    text('Due date', DUE, box(16, 134, 220, 16), { 'font-size': '12px', 'line-height': '16px', color: MUTED }),
    progressBar(box(16, 166, 220, 6)),
  ]);
}

function blankCard(): FormatterDocument {
  return makeCard(254, 160, CARD_PAINT, [
    text('Title', '[$Title]', box(16, 16, 220, 22), { 'font-size': '15px', 'font-weight': '600', 'line-height': '22px', color: INK }),
  ]);
}

export interface Starter { id: string; label: string; build: () => FormatterDocument }

export const STARTERS: Starter[] = [
  { id: 'task', label: 'Task card', build: taskCard },
  { id: 'header', label: 'Header card', build: headerCard },
  { id: 'blank', label: 'Blank card', build: blankCard },
];

// ─── export ──────────────────────────────────────────────────────────────────

export interface ExportResult { json: string; errors: LintIssue[]; warnings: LintIssue[] }

const covers = (a: Rect, b: Rect): boolean =>
  a.x <= b.x && a.y <= b.y && a.x + a.w >= b.x + b.w && a.y + a.h >= b.y + b.h;

/**
 * The linter judges text against the fill of its TREE ancestors. In free
 * layout the fill behind a part is whatever earlier part covers it (white
 * text on a blue header shape is a sibling, not a child). So Lite lints a
 * copy where each unfilled part borrows the fill of the nearest part under
 * it that covers it completely. Only the lint sees this copy — the export
 * never carries the borrowed fill.
 */
export function lintView(doc: FormatterDocument): FormatterDocument {
  const kids = doc.root.children ?? [];
  const children = kids.map((el, i) => {
    const r = partRect(el);
    if (!r || el.style?.['background-color'] !== undefined || el.style?.background !== undefined) return el;
    for (let j = i - 1; j >= 0; j--) {
      const ur = partRect(kids[j]);
      const fill = kids[j].style?.['background-color'];
      if (ur && fill !== undefined && covers(ur, r)) {
        return { ...el, style: { ...el.style, 'background-color': fill } };
      }
    }
    return el;
  });
  return { ...doc, root: { ...doc.root, children } };
}

/** The JSON to paste into SharePoint, plus what the linter says about it.
 *  Errors block the copy; warnings ride along. */
export function exportCard(doc: FormatterDocument, fields: MockField[]): ExportResult {
  const issues = lintDocument(lintView(doc), fields.map((f) => f.name), Object.fromEntries(fields.map((f) => [f.name, f.type])));
  return {
    json: exportJson(doc),
    errors: issues.filter((i) => i.severity === 'error'),
    warnings: issues.filter((i) => i.severity === 'warning'),
  };
}
