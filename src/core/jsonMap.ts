// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Sam Yost. FormatFX is dual-licensed: AGPL-3.0-only (see LICENSE) or a commercial license (see LICENSING.md).

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

export interface MappedJson {
  text: string;
  ranges: JsonRange[];
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

interface WriteCtx {
  chunks: string[];
  len: number;
  ranges: JsonRange[];
  paths: Map<object, NodePath>;
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
  if (Array.isArray(value)) {
    if (value.length === 0) { push(ctx, '[]'); return; }
    push(ctx, '[\n');
    value.forEach((item, i) => {
      push(ctx, pad);
      writeValue(ctx, isSkipped(item) ? null : item, depth + 1);
      push(ctx, i < value.length - 1 ? ',\n' : '\n');
    });
    push(ctx, `${close}]`);
    return;
  }
  const path = ctx.paths.get(value);
  const start = ctx.len;
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
  const ctx: WriteCtx = { chunks: [], len: 0, ranges: [], paths };
  writeValue(ctx, payload, 0);
  return { text: ctx.chunks.join(''), ranges: ctx.ranges };
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
