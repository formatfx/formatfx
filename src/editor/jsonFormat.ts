// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Sam Yost

/**
 * editor/jsonFormat.ts — Format-document + typing-ergonomics decisions for
 * the JSON pane (spec docs/superpowers/specs/2026-07-09-json-pane-ide-design.md §2).
 *
 * Pure and DOM-free. Two tiers of Format: a parseable buffer round-trips
 * through the canonical serializer (importJson → exportJson, keepMeta so the
 * view keeps _elmName); a broken one gets a tolerant, string-safe re-indent
 * and carries the parse error out so the caller can teach. Typing assists
 * (Enter indent, pair auto-close, skip-over, quote-wrap, paste re-base) are
 * decisions only — the DOM shell owns splicing and undo.
 *
 * Format is buffer work: it NEVER touches the document or the dirty flag —
 * Apply stays the one write.
 */

import { importJson, exportJson } from '../core/serializer';
import { scanString, tokenizeJson } from './jsonHighlight';

/** One indent level — must match the serializer (JSON.stringify(…, 2)). */
const INDENT = '  ';

export type Assist =
  | { kind: 'splice'; from: number; to: number; insert: string; caret: number }
  | { kind: 'caret'; caret: number };

export function formatDocument(
  text: string,
  opts: { sanitizeWhitespace: boolean },
): { text: string; tier: 'canonical' | 'reindent'; error?: string } {
  try {
    const doc = importJson(text);
    return {
      text: exportJson(doc, { sanitizeWhitespace: opts.sanitizeWhitespace, keepMeta: true }),
      tier: 'canonical',
    };
  } catch (e) {
    return { text: reindentJson(text), tier: 'reindent', error: (e as Error).message };
  }
}

/** Bracket balance of one line, ignoring anything inside strings. Returns the
 *  net depth change and whether the line's first solid char is a closer. */
function lineShape(line: string): { net: number; leadingCloser: boolean } {
  let net = 0;
  let i = 0;
  let leadingCloser: boolean | null = null;
  while (i < line.length) {
    const c = line[i];
    if (c === ' ' || c === '\t') { i++; continue; }
    if (leadingCloser === null) leadingCloser = c === '}' || c === ']';
    if (c === '"') {
      i = scanString(line, i).end; // escapes handled; strings never span lines
      continue;
    }
    if (c === '{' || c === '[') net++;
    else if (c === '}' || c === ']') net--;
    i++;
  }
  return { net, leadingCloser: leadingCloser === true };
}

/** Tolerant re-indent: structural depth only, strings untouched, depth
 *  clamped at zero so over-closed buffers cannot push lines off the left. */
export function reindentJson(text: string): string {
  let depth = 0;
  return text.split('\n').map((line) => {
    const trimmed = line.trim();
    if (trimmed === '') return '';
    const { net, leadingCloser } = lineShape(trimmed);
    const level = Math.max(0, leadingCloser ? depth - 1 : depth);
    depth = Math.max(0, depth + net);
    return INDENT.repeat(level) + trimmed;
  }).join('\n');
}

/** The string token the offset sits strictly inside, or null. An offset ON
 *  the opening quote or just past the closing quote is outside. */
function stringTokenAt(text: string, offset: number) {
  return tokenizeJson(text).find(
    (t) => (t.kind === 'key' || t.kind === 'str' || t.kind === 'expr')
      && t.start < offset && offset < t.end,
  ) ?? null;
}

const startOfLine = (text: string, offset: number): number => text.lastIndexOf('\n', offset - 1) + 1;

function leadingWs(text: string, lineStart: number): string {
  let i = lineStart;
  while (i < text.length && (text[i] === ' ' || text[i] === '\t')) i++;
  return text.slice(lineStart, i);
}

const prevSolid = (text: string, i: number): string => {
  let j = i - 1;
  while (j >= 0 && /\s/.test(text[j])) j--;
  return j >= 0 ? text[j] : '';
};

const nextSolid = (text: string, i: number): string => {
  let j = i;
  while (j < text.length && /\s/.test(text[j])) j++;
  return j < text.length ? text[j] : '';
};

const PAIRS: Record<string, string> = { '{': '}', '[': ']', '"': '"' };

/** What a trigger key should do at [selStart, selEnd) — or null for default
 *  browser behavior. Callers splice through their undo-preserving path. */
export function typingAssist(text: string, selStart: number, selEnd: number, key: string): Assist | null {
  const inString = stringTokenAt(text, selStart) !== null;

  if (key === 'Enter') {
    if (inString || selStart !== selEnd) return null;
    const indent = leadingWs(text, startOfLine(text, selStart));
    const prev = prevSolid(text, selStart);
    if (prev === '{' || prev === '[') {
      const inner = indent + INDENT;
      if (nextSolid(text, selEnd) === PAIRS[prev]) {
        // brace-Enter: the closer drops to its own dedented line
        const insert = `\n${inner}\n${indent}`;
        return { kind: 'splice', from: selStart, to: selEnd, insert, caret: selStart + 1 + inner.length };
      }
      return { kind: 'splice', from: selStart, to: selEnd, insert: `\n${inner}`, caret: selStart + 1 + inner.length };
    }
    return { kind: 'splice', from: selStart, to: selEnd, insert: `\n${indent}`, caret: selStart + 1 + indent.length };
  }

  if (key === '{' || key === '[') {
    if (inString || selStart !== selEnd) return null;
    const next = text[selStart] ?? '';
    const boundary = next === '' || /\s/.test(next) || next === ',' || next === '}' || next === ']';
    if (!boundary) return null;
    return { kind: 'splice', from: selStart, to: selStart, insert: key + PAIRS[key], caret: selStart + 1 };
  }

  if (key === '"') {
    if (selStart !== selEnd) {
      if (inString) return null;
      const sel = text.slice(selStart, selEnd);
      return { kind: 'splice', from: selStart, to: selEnd, insert: `"${sel}"`, caret: selEnd + 2 };
    }
    if (inString) {
      // typing the closer AT the closer: step over it instead of doubling
      return text[selStart] === '"' ? { kind: 'caret', caret: selStart + 1 } : null;
    }
    const next = text[selStart] ?? '';
    const boundary = next === '' || /\s/.test(next) || next === ',' || next === '}' || next === ']';
    return boundary
      ? { kind: 'splice', from: selStart, to: selStart, insert: '""', caret: selStart + 1 }
      : null;
  }

  if (key === '}' || key === ']') {
    if (inString || selStart !== selEnd) return null;
    return text[selStart] === key ? { kind: 'caret', caret: selStart + 1 } : null;
  }

  return null;
}

/** Re-base a multi-line paste to the caret line's indentation: continuation
 *  lines lose their common leading indent and gain the caret line's. The
 *  first line inserts at the caret as-is. Single-line pastes pass through. */
export function pasteReindent(text: string, selStart: number, pasted: string): string {
  if (!pasted.includes('\n')) return pasted;
  const base = leadingWs(text, startOfLine(text, selStart));
  const lines = pasted.split('\n');
  const rest = lines.slice(1);
  const solid = rest.filter((l) => l.trim() !== '');
  const common = solid.length
    ? Math.min(...solid.map((l) => l.length - l.trimStart().length))
    : 0;
  return [
    lines[0],
    ...rest.map((l) => (l.trim() === '' ? '' : base + l.slice(common))),
  ].join('\n');
}
