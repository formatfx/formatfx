// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Sam Yost

/**
 * core/jsonMap.ts — the character-offset ↔ element-path map for serialized
 * formatter JSON (#218: bi-directional code/canvas sync).
 *
 * exportJsonWithMap() renders EXACTLY the text exportJson() produces for the
 * same options (same payload assembly via exportPayload, same
 * `JSON.stringify(payload, null, 2)` formatting — the tracked stringifier
 * below replicates it byte-for-byte, leaning on JSON.stringify for every
 * leaf so string escaping can never drift) while recording the character
 * range of every ELEMENT object in the tree: `start` is the opening `{` and
 * `end` is the offset just PAST the closing `}`, so the half-open span
 * [start, end) covers exactly the element's characters. Caret mapping is
 * deliberately end-INCLUSIVE, though — pathAtOffset resolves a caret resting
 * right after the closing `}` (offset === end) to that element, which reads
 * naturally when the caret sits at a line's end. Keep both sides in step:
 * ranges stay half-open, caret lookups stay inclusive. That yields a
 * deterministic mapping both ways:
 *
 *     caret offset  → innermost element path   (pathAtOffset)
 *     element path  → its range in the text    (rangeForPath)
 *
 * No regex guessing — the map is a byproduct of the serialization walk, and
 * jsonMap.test.ts pins the byte-identity against exportJson as a contract.
 *
 * Scope: the split-view editor text only — always indent 2, never csomSafe
 * (that variant regex-rewrites the final text, which would shift offsets;
 * the JSON pane's textarea never shows it).
 */

import type { FormatterDocument, SPElement, NodePath } from './types';
import { exportPayload, type ExportOptions } from './serializer';

/** Path segment that descends into customCardProps.formatter — mirrors
 *  editor/state.ts CARD_SEGMENT (core must not import from editor). */
const CARD_SEGMENT = -1;

export interface JsonRange {
  path: NodePath;
  /** Offset of the element's opening `{` in the text. */
  start: number;
  /** Offset just past the element's closing `}`. */
  end: number;
}

/** A WRAPPER-side object/array's text range — the sections the element-path
 *  map can't address (groupProps and its header/footerFormatter trees,
 *  commandBarProps and its commands, top-level footerFormatter …). Keyed by
 *  their '/'-joined wrapper path so the IDE's fold layer can fold them the
 *  way it folds elements (#279 owner ask). */
export interface JsonSection {
  key: string;
  start: number;
  end: number;
}

/** The text range of an element's `children` ARRAY (`[` through past `]`),
 *  keyed by the PARENT element's path — so the fold layer can collapse a
 *  whole children list without hiding the parent's own properties (owner
 *  ask 2026-07-16: "fold at the children:[ level"). Only non-empty arrays
 *  are recorded (an empty `[]` renders on one line and can never fold). */
export interface JsonChildrenRange {
  path: NodePath;
  start: number;
  end: number;
}

export interface MappedJson {
  text: string;
  ranges: JsonRange[];
  /** Foldable wrapper sections (viewExtras subtrees) — empty for column/tile
   *  payloads, which carry no unmodeled wrapper keys. */
  sections: JsonSection[];
  /** Foldable `children` arrays, keyed by their parent element's path. */
  childrenRanges: JsonChildrenRange[];
}

/** The options the map supports — the JSON pane's exact export shape. */
export type MapExportOptions = Pick<ExportOptions, 'sanitizeWhitespace' | 'keepMeta'>;

function samePath(a: NodePath, b: NodePath): boolean {
  return a.length === b.length && a.every((v, i) => b[i] === v);
}

/** Register every element object (by identity) with its node path. */
function registerPaths(el: SPElement, path: NodePath, map: Map<object, NodePath>): void {
  map.set(el as unknown as object, path);
  (el.children ?? []).forEach((c, i) => registerPaths(c, [...path, i], map));
  if (el.customCardProps?.formatter) {
    registerPaths(el.customCardProps.formatter, [...path, CARD_SEGMENT], map);
  }
}

/** Register every element's non-empty `children` ARRAY (by identity) with the
 *  parent element's path. Same identity trick as registerPaths: exportPayload
 *  embeds the cloned root by reference, so the arrays it carries are the very
 *  objects the stringifier walks. */
function registerChildrenArrays(el: SPElement, path: NodePath, map: Map<object, NodePath>): void {
  if (el.children?.length) map.set(el.children as unknown as object, path);
  (el.children ?? []).forEach((c, i) => registerChildrenArrays(c, [...path, i], map));
  if (el.customCardProps?.formatter) {
    registerChildrenArrays(el.customCardProps.formatter, [...path, CARD_SEGMENT], map);
  }
}

/** Register every object/array under a wrapper extra (by identity) with its
 *  '/'-joined key path — exportPayload spreads viewExtras by REFERENCE, so
 *  identity survives into the written payload. Every registered node the
 *  stringifier renders multi-line becomes foldable. */
function registerSections(value: unknown, key: string, map: Map<object, string>): void {
  if (value === null || typeof value !== 'object') return;
  map.set(value as object, key);
  if (Array.isArray(value)) {
    value.forEach((v, i) => registerSections(v, `${key}/${i}`, map));
  } else {
    for (const [k, v] of Object.entries(value)) registerSections(v, `${key}/${k}`, map);
  }
}

interface WriteCtx {
  chunks: string[];
  len: number;
  ranges: JsonRange[];
  paths: Map<object, NodePath>;
  sections: JsonSection[];
  sectionKeys: Map<object, string>;
  childrenRanges: JsonChildrenRange[];
  childrenPaths: Map<object, NodePath>;
}

function push(ctx: WriteCtx, s: string): void {
  ctx.chunks.push(s);
  ctx.len += s.length;
}

/** JSON.stringify's own skip rule for object members. */
function isSkipped(v: unknown): boolean {
  return v === undefined || typeof v === 'function' || typeof v === 'symbol';
}

/** Write `value` exactly as `JSON.stringify(value, null, 2)` would at `depth`,
 *  recording a JsonRange whenever the value is a registered element object. */
function writeValue(ctx: WriteCtx, value: unknown, depth: number): void {
  if (value === null || typeof value !== 'object') {
    // leaves delegate to JSON.stringify so numbers (incl. NaN → null) and
    // string escaping (quotes, \n, unicode, surrogates) can never diverge
    push(ctx, JSON.stringify(value) ?? 'null');
    return;
  }
  const pad = '  '.repeat(depth + 1);
  const close = '  '.repeat(depth);
  const start = ctx.len;
  if (Array.isArray(value)) {
    if (value.length === 0) { push(ctx, '[]'); return; }
    push(ctx, '[\n');
    value.forEach((item, i) => {
      push(ctx, pad);
      writeValue(ctx, isSkipped(item) ? null : item, depth + 1);
      push(ctx, i < value.length - 1 ? ',\n' : '\n');
    });
    push(ctx, `${close}]`);
    const sk = ctx.sectionKeys.get(value);
    if (sk) ctx.sections.push({ key: sk, start, end: ctx.len });
    const cp = ctx.childrenPaths.get(value);
    if (cp) ctx.childrenRanges.push({ path: cp, start, end: ctx.len });
    return;
  }
  const path = ctx.paths.get(value);
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => !isSkipped(v));
  if (entries.length === 0) {
    push(ctx, '{}');
  } else {
    push(ctx, '{\n');
    entries.forEach(([k, v], i) => {
      push(ctx, `${pad}${JSON.stringify(k)}: `);
      writeValue(ctx, v, depth + 1);
      push(ctx, i < entries.length - 1 ? ',\n' : '\n');
    });
    push(ctx, `${close}}`);
  }
  if (path) ctx.ranges.push({ path, start, end: ctx.len });
  const sk = ctx.sectionKeys.get(value);
  if (sk) ctx.sections.push({ key: sk, start, end: ctx.len });
}

/**
 * Serialize `doc` exactly like exportJson(doc, opts) (indent 2, no csomSafe)
 * AND return the text range of every element, keyed by node path.
 *
 * Column payloads spread the root into the wrapper (`{ $schema, ...root }`),
 * so there the ROOT's range is the whole payload — clicking the $schema line
 * of a column formatter selects the root, which is what it wraps.
 */
export function exportJsonWithMap(doc: FormatterDocument, opts: MapExportOptions = {}): MappedJson {
  const { payload, root } = exportPayload(doc, opts);
  const paths = new Map<object, NodePath>();
  registerPaths(root, [], paths);
  const payloadRoot = doc.kind === 'row' || doc.kind === 'grid' ? payload.rowFormatter
    : doc.kind === 'tile' ? payload.formatter
    : payload; // column: the spread copy IS the in-payload root
  paths.set(payloadRoot as object, []);
  // wrapper extras (groupProps, commandBarProps, footerFormatter …) become
  // foldable SECTIONS — every object/array under them, keyed by wrapper path
  const sectionKeys = new Map<object, string>();
  if (doc.kind === 'row' || doc.kind === 'grid') {
    for (const [k, v] of Object.entries(doc.viewExtras ?? {})) registerSections(v, k, sectionKeys);
  }
  // `children` arrays fold independently of their parent element (the array
  // object rides into the payload by reference — the column-kind spread copies
  // the PROPERTY, which still points at the same array)
  const childrenPaths = new Map<object, NodePath>();
  registerChildrenArrays(root, [], childrenPaths);
  const ctx: WriteCtx = {
    chunks: [], len: 0, ranges: [], paths, sections: [], sectionKeys,
    childrenRanges: [], childrenPaths,
  };
  writeValue(ctx, payload, 0);
  return { text: ctx.chunks.join(''), ranges: ctx.ranges, sections: ctx.sections, childrenRanges: ctx.childrenRanges };
}

/** The INNERMOST element whose text range contains `offset` (end-inclusive,
 *  so a caret right after a closing `}` still counts), or null when the
 *  offset sits outside every element (e.g. a view wrapper's $schema line). */
export function pathAtOffset(ranges: JsonRange[], offset: number): NodePath | null {
  let best: JsonRange | null = null;
  for (const r of ranges) {
    if (offset < r.start || offset > r.end) continue;
    // element ranges nest strictly — the innermost is the latest-starting
    if (!best || r.start > best.start) best = r;
  }
  return best ? best.path : null;
}

/** The text range of the element at `path`, or null if it isn't in the map
 *  (stale path, or a selection cleared to nothing). */
export function rangeForPath(ranges: JsonRange[], path: NodePath): JsonRange | null {
  return ranges.find((r) => samePath(r.path, path)) ?? null;
}

/** The `children` array range of the element at `path`, or null (no children,
 *  or the path is stale). */
export function childrenRangeForPath(ranges: JsonChildrenRange[], path: NodePath): JsonChildrenRange | null {
  return ranges.find((r) => samePath(r.path, path)) ?? null;
}
