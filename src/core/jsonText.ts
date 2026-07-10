// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Sam Yost. FormatFX is dual-licensed: AGPL-3.0-only (see LICENSE) or a commercial license (see LICENSING.md).

/**
 * core/jsonText.ts — the positioned, tolerant JSON parser (spec
 * docs/superpowers/specs/2026-07-09-json-pane-ide-design.md §4): the reverse
 * of core/jsonMap. Where exportJsonWithMap records element ranges WHILE
 * serializing a document, parseJsonWithMap recovers the same element→range
 * map from ARBITRARY buffer text — including half-typed text — plus
 * positioned parse errors ("where's the missing comma", while typing).
 *
 * Element identification mirrors jsonMap's structural rules exactly (the
 * property test in jsonText.test.ts pins parse(export(doc)) ≡ export(doc)'s
 * own map): a top-level "rowFormatter" object is the root element (view
 * wrapper); else a top-level "formatter" object (tile wrapper); else the
 * top-level object itself (column payload spread). Children descend by array
 * index under "children"; customCardProps.formatter descends as segment -1
 * (jsonMap's CARD_SEGMENT).
 *
 * Never throws. Recovery is member-level: a bad member skips to the next
 * ',' or closer at its own depth; unclosed containers at EOF close AT the
 * end so mid-edit buffers still yield usable ranges. Errors cap at 20 —
 * a pathological buffer must not flood the UI.
 *
 * The string scanner mirrors editor/jsonHighlight.scanString (core must not
 * import from editor): escape pairs skip, unterminated strings stop at the
 * line end.
 */

import type { NodePath } from './types';
import type { JsonRange } from './jsonMap';

export interface TextParseError { start: number; end: number; message: string }
export interface TextParseResult {
  ranges: JsonRange[];
  errors: TextParseError[];
  /** `_elmName ?? elmType` per element, keyed by `path.join('/')` — read
   *  straight from the BUFFER so a dirty-buffer breadcrumb tells the truth
   *  about what's typed, not what the doc last knew. Absent when the element
   *  carries neither key (yet). */
  labels: Record<string, string>;
}

const CARD_SEGMENT = -1; // mirrors core/jsonMap
const MAX_ERRORS = 20;

interface Ctx { text: string; i: number; errors: TextParseError[] }

type PNode = ObjNode | ArrNode | LitNode;
interface ObjNode { kind: 'obj'; start: number; end: number; members: Array<{ key: string; value: PNode }> }
interface ArrNode { kind: 'arr'; start: number; end: number; items: PNode[] }
interface LitNode { kind: 'lit'; start: number; end: number }

function err(ctx: Ctx, start: number, end: number, message: string): void {
  if (ctx.errors.length < MAX_ERRORS) ctx.errors.push({ start, end, message });
}

function ws(ctx: Ctx): void {
  while (ctx.i < ctx.text.length && /\s/.test(ctx.text[ctx.i])) ctx.i++;
}

/** Scan the string opening at ctx.i (mirrors jsonHighlight.scanString). */
function scanStr(ctx: Ctx): { end: number; closed: boolean } {
  const { text } = ctx;
  let i = ctx.i + 1;
  while (i < text.length) {
    const c = text[i];
    if (c === '\\') { i += 2; continue; }
    if (c === '"') return { end: i + 1, closed: true };
    if (c === '\n') break;
    i++;
  }
  return { end: Math.min(i, text.length), closed: false };
}

/** Advance to the next ',' or closing bracket at the CURRENT depth. */
function skipToBoundary(ctx: Ctx): void {
  let depth = 0;
  while (ctx.i < ctx.text.length) {
    const c = ctx.text[ctx.i];
    if (c === '"') { ctx.i = scanStr(ctx).end; continue; }
    if (c === '{' || c === '[') depth++;
    else if (c === '}' || c === ']') {
      if (depth === 0) return;
      depth--;
    } else if (c === ',' && depth === 0) return;
    ctx.i++;
  }
}

function parseValue(ctx: Ctx): PNode {
  ws(ctx);
  const start = ctx.i;
  const c = ctx.text[start];
  if (c === undefined) {
    err(ctx, start, start, 'unexpected end of JSON');
    return { kind: 'lit', start, end: start };
  }
  if (c === '"') {
    const { end, closed } = scanStr(ctx);
    if (!closed) err(ctx, start, end, 'unterminated string');
    ctx.i = end;
    return { kind: 'lit', start, end };
  }
  if (c === '{') return parseObj(ctx);
  if (c === '[') return parseArr(ctx);
  if (c === '-' || (c >= '0' && c <= '9')) {
    let i = start + 1;
    while (i < ctx.text.length && /[0-9.eE+-]/.test(ctx.text[i])) i++;
    ctx.i = i;
    return { kind: 'lit', start, end: i };
  }
  if (/[A-Za-z_]/.test(c)) {
    let i = start;
    while (i < ctx.text.length && /[A-Za-z0-9_]/.test(ctx.text[i])) i++;
    const word = ctx.text.slice(start, i);
    if (word !== 'true' && word !== 'false' && word !== 'null') {
      err(ctx, start, i, `'${word}' is not valid JSON here`);
    }
    ctx.i = i;
    return { kind: 'lit', start, end: i };
  }
  err(ctx, start, start + 1, `unexpected character '${c}'`);
  ctx.i = start + 1;
  return { kind: 'lit', start, end: start + 1 };
}

function parseObj(ctx: Ctx): ObjNode {
  const start = ctx.i;
  ctx.i++; // past {
  const members: ObjNode['members'] = [];
  for (;;) {
    ws(ctx);
    if (ctx.i >= ctx.text.length) {
      err(ctx, start, ctx.text.length, "unclosed '{' at the end of the text");
      return { kind: 'obj', start, end: ctx.text.length, members };
    }
    if (ctx.text[ctx.i] === '}') { ctx.i++; break; }
    // key
    let key: string | null = null;
    if (ctx.text[ctx.i] === '"') {
      const ks = ctx.i;
      const { end, closed } = scanStr(ctx);
      key = ctx.text.slice(ks + 1, closed ? end - 1 : end);
      if (!closed) err(ctx, ks, end, 'unterminated key string');
      ctx.i = end;
    } else {
      const es = ctx.i;
      skipToBoundary(ctx);
      err(ctx, es, ctx.i, 'expected a "key"');
      if (ctx.text[ctx.i] === ',') ctx.i++;
      continue;
    }
    ws(ctx);
    if (ctx.text[ctx.i] === ':') {
      ctx.i++;
    } else {
      err(ctx, ctx.i, Math.min(ctx.i + 1, ctx.text.length), "expected ':' after the key");
      skipToBoundary(ctx);
      if (ctx.text[ctx.i] === ',') ctx.i++;
      continue;
    }
    const value = parseValue(ctx);
    members.push({ key, value });
    ws(ctx);
    if (ctx.text[ctx.i] === ',') { ctx.i++; continue; }
    if (ctx.text[ctx.i] === '}') { ctx.i++; break; }
    if (ctx.i >= ctx.text.length) {
      err(ctx, start, ctx.text.length, "unclosed '{' at the end of the text");
      return { kind: 'obj', start, end: ctx.text.length, members };
    }
    // recovery: read on as if the comma were there ("where's the missing comma")
    err(ctx, ctx.i, ctx.i + 1, "expected ',' or '}'");
  }
  return { kind: 'obj', start, end: ctx.i, members };
}

function parseArr(ctx: Ctx): ArrNode {
  const start = ctx.i;
  ctx.i++; // past [
  const items: PNode[] = [];
  for (;;) {
    ws(ctx);
    if (ctx.i >= ctx.text.length) {
      err(ctx, start, ctx.text.length, "unclosed '[' at the end of the text");
      return { kind: 'arr', start, end: ctx.text.length, items };
    }
    if (ctx.text[ctx.i] === ']') { ctx.i++; break; }
    items.push(parseValue(ctx));
    ws(ctx);
    if (ctx.text[ctx.i] === ',') { ctx.i++; continue; }
    if (ctx.text[ctx.i] === ']') { ctx.i++; break; }
    if (ctx.i >= ctx.text.length) {
      err(ctx, start, ctx.text.length, "unclosed '[' at the end of the text");
      return { kind: 'arr', start, end: ctx.text.length, items };
    }
    err(ctx, ctx.i, ctx.i + 1, "expected ',' or ']'");
  }
  return { kind: 'arr', start, end: ctx.i, items };
}

const member = (o: ObjNode, key: string): PNode | undefined =>
  o.members.find((m) => m.key === key)?.value;

/** The element's own display label — `_elmName ?? elmType`, if it holds a
 *  closed-quoted string value (mid-edit members without one stay unlabeled). */
function labelOf(el: ObjNode, text: string): string | null {
  for (const key of ['_elmName', 'elmType']) {
    const v = member(el, key);
    if (v?.kind !== 'lit' || text[v.start] !== '"') continue;
    const closed = v.end - v.start >= 2 && text[v.end - 1] === '"';
    const inner = text.slice(v.start + 1, closed ? v.end - 1 : v.end);
    if (inner) return inner;
  }
  return null;
}

/** Emit element ranges per jsonMap's structural rules (post-order). */
function walkElement(el: ObjNode, path: NodePath, out: JsonRange[], text: string, labels: Record<string, string>): void {
  const children = member(el, 'children');
  if (children?.kind === 'arr') {
    children.items.forEach((c, i) => {
      if (c.kind === 'obj') walkElement(c, [...path, i], out, text, labels);
    });
  }
  const card = member(el, 'customCardProps');
  if (card?.kind === 'obj') {
    const formatter = member(card, 'formatter');
    if (formatter?.kind === 'obj') walkElement(formatter, [...path, CARD_SEGMENT], out, text, labels);
  }
  out.push({ path, start: el.start, end: el.end });
  const label = labelOf(el, text);
  if (label) labels[path.join('/')] = label;
}

/**
 * Parse arbitrary buffer text into jsonMap-compatible element ranges plus
 * positioned errors. Never throws; a half-typed buffer yields the best map
 * it can (unclosed containers span to the end of the text).
 */
export function parseJsonWithMap(text: string): TextParseResult {
  const ctx: Ctx = { text, i: 0, errors: [] };
  ws(ctx);
  if (ctx.i >= text.length) {
    err(ctx, 0, text.length, 'empty buffer — nothing to parse');
    return { ranges: [], errors: ctx.errors, labels: {} };
  }
  const root = parseValue(ctx);
  ws(ctx);
  if (ctx.i < text.length) err(ctx, ctx.i, text.length, 'unexpected text after the end of the JSON');

  const ranges: JsonRange[] = [];
  const labels: Record<string, string> = {};
  if (root.kind === 'obj') {
    const rowFormatter = member(root, 'rowFormatter');
    const formatter = member(root, 'formatter');
    const rootEl = rowFormatter?.kind === 'obj' ? rowFormatter
      : formatter?.kind === 'obj' ? formatter
      : root;
    walkElement(rootEl as ObjNode, [], ranges, text, labels);
    // the wrapper kinds map the ROOT element to the inner object; the column
    // spread maps it to the whole payload — exactly jsonMap's convention
    if (rootEl !== root) {
      // wrapper chrome ($schema, hideSelection…) belongs to no element — same
      // as jsonMap, where pathAtOffset returns null on the wrapper lines
    }
  }
  return { ranges, errors: ctx.errors, labels };
}
