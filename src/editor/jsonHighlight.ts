// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Sam Yost. FormatFX is dual-licensed: AGPL-3.0-only (see LICENSE) or a commercial license (see LICENSING.md).

/**
 * editor/jsonHighlight.ts — the lexical half of the IDE-style JSON pane
 * (#244): a tolerant JSON tokenizer, the HTML renderer behind the highlight
 * overlay, and caret-adjacent bracket matching.
 *
 * Pure and DOM-free (jsonHighlight.test.ts pins it). The tokenizer is
 * LEXICAL, not a parser: it never throws, and a half-typed buffer (the whole
 * point of an editor) still paints sensibly — an unterminated string simply
 * runs to the end of its line, garbage words get the error tint. Formula
 * strings (values starting with `=`) get their own token kind so the SP
 * expression layer reads distinctly from plain string data.
 *
 * The structural half (what to SUGGEST at the caret) lives in
 * jsonComplete.ts; the DOM shell that paints all of this is jsonIde.ts.
 */

export type JsonTokenKind =
  | 'key'    // "elmType" (a string in key position — `:` follows)
  | 'str'    // "div" (a plain string value)
  | 'expr'   // "=if(…)" (a string value carrying an SP formula)
  | 'num'
  | 'bool'
  | 'null'
  | 'punct'  // { } [ ] : ,  (one token per character for the bracket matcher)
  | 'err';   // anything JSON has no word for (bare identifiers, stray chars)

export interface JsonToken {
  kind: JsonTokenKind;
  /** Offset of the token's first character. */
  start: number;
  /** Offset just past the token's last character (half-open, like jsonMap). */
  end: number;
}

const isDigit = (c: string): boolean => c >= '0' && c <= '9';
const isWordChar = (c: string): boolean => /[A-Za-z0-9_$]/.test(c);

/**
 * Scan a JSON string token starting at the opening quote. Returns the offset
 * just past the closing quote, or — unterminated — the end of the line/text
 * (a mid-edit buffer must never swallow the rest of the document into one
 * "string"). `closed` tells the two apart.
 */
export function scanString(text: string, start: number): { end: number; closed: boolean } {
  let i = start + 1;
  while (i < text.length) {
    const c = text[i];
    if (c === '\\') { i += 2; continue; }
    if (c === '"') return { end: i + 1, closed: true };
    if (c === '\n') break;
    i++;
  }
  return { end: Math.min(i, text.length), closed: false };
}

/** Mirrors core/expressions.evaluate's string rules: `=` formulas, bare
 *  `[$Field]`/`[!Field]` refs and bare `@tokens` all resolve LIVE on SP —
 *  paint them as expressions, not data. Anything else is a literal. */
export function isLiveString(content: string): boolean {
  if (content.startsWith('=')) return true;
  const t = content.trim();
  return /^\[[$!][A-Za-z0-9_. ]+\]$/.test(t) || /^@[A-Za-z]+(\.[A-Za-z]+)*$/.test(t);
}

/** Tokenize the whole buffer. Whitespace is not tokenized (it renders as-is). */
export function tokenizeJson(text: string): JsonToken[] {
  const tokens: JsonToken[] = [];
  const n = text.length;
  let i = 0;
  while (i < n) {
    const c = text[i];
    if (c === '"') {
      const { end, closed } = scanString(text, i);
      // key vs value: a closed string directly followed (spaces aside) by `:`
      let j = end;
      while (j < n && (text[j] === ' ' || text[j] === '\t')) j++;
      const kind: JsonTokenKind = closed && text[j] === ':'
        ? 'key'
        : isLiveString(text.slice(i + 1, closed ? end - 1 : end)) ? 'expr' : 'str';
      tokens.push({ kind, start: i, end });
      i = end;
      continue;
    }
    if (c === '-' || isDigit(c)) {
      const start = i;
      i++;
      while (i < n && /[0-9.eE+-]/.test(text[i])) i++;
      tokens.push({ kind: 'num', start, end: i });
      continue;
    }
    if (/[A-Za-z_$]/.test(c)) {
      const start = i;
      while (i < n && isWordChar(text[i])) i++;
      const word = text.slice(start, i);
      tokens.push({
        kind: word === 'true' || word === 'false' ? 'bool' : word === 'null' ? 'null' : 'err',
        start,
        end: i,
      });
      continue;
    }
    if (c === '{' || c === '}' || c === '[' || c === ']' || c === ':' || c === ',') {
      tokens.push({ kind: 'punct', start: i, end: i + 1 });
      i++;
      continue;
    }
    i++; // whitespace and anything unclassifiable stays unpainted
  }
  return tokens;
}

const OPENERS: Record<string, string> = { '{': '}', '[': ']' };
const CLOSERS: Record<string, string> = { '}': '{', ']': '[' };

/**
 * The bracket pair the caret is touching — the start offsets of the opening
 * and closing bracket — or null. "Touching" prefers the character just BEFORE
 * the caret (the IDE convention: the bracket you just typed matches), falling
 * back to the character AT the caret. Brackets inside strings never match —
 * they're part of `str` tokens, not `punct` ones, so the token walk skips
 * them structurally rather than by guesswork.
 */
export function matchBracketAt(text: string, tokens: JsonToken[], caret: number): [number, number] | null {
  const brackets = tokens.filter(
    (t) => t.kind === 'punct' && (text[t.start] === '{' || text[t.start] === '}' || text[t.start] === '[' || text[t.start] === ']'),
  );
  const at = brackets.find((t) => t.start === caret - 1) ?? brackets.find((t) => t.start === caret);
  if (!at) return null;
  const ch = text[at.start];
  if (OPENERS[ch]) {
    // forward scan for the balancing closer
    let depth = 0;
    for (const t of brackets) {
      if (t.start < at.start) continue;
      const b = text[t.start];
      if (b === ch) depth++;
      else if (b === OPENERS[ch] && --depth === 0) return [at.start, t.start];
    }
    return null;
  }
  if (CLOSERS[ch]) {
    // backward scan for the balancing opener
    let depth = 0;
    for (let k = brackets.length - 1; k >= 0; k--) {
      const t = brackets[k];
      if (t.start > at.start) continue;
      const b = text[t.start];
      if (b === ch) depth++;
      else if (b === CLOSERS[ch] && --depth === 0) return [t.start, at.start];
    }
    return null;
  }
  return null;
}

const HTML_ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;' };
const escapeHtml = (s: string): string => s.replace(/[&<>]/g, (c) => HTML_ESCAPES[c]);

/**
 * Render the buffer as highlight-overlay HTML: every token wrapped in
 * `<span class="wb-tok-KIND">`, untokenized gaps (whitespace) emitted
 * verbatim, everything HTML-escaped. `match` — a matchBracketAt result —
 * additionally stamps `wb-tok-match` on the two bracket tokens.
 *
 * A trailing newline gets a trailing space appended so the overlay's last
 * (empty) line still has height — otherwise the <pre> would be one line
 * shorter than the textarea and the layers would shear on the final line.
 */
export function renderJsonHtml(text: string, tokens: JsonToken[], match?: readonly [number, number] | null): string {
  const out: string[] = [];
  let pos = 0;
  for (const t of tokens) {
    if (t.start > pos) out.push(escapeHtml(text.slice(pos, t.start)));
    const matched = match && (t.start === match[0] || t.start === match[1]);
    out.push(
      `<span class="wb-tok-${t.kind}${matched ? ' wb-tok-match' : ''}">`,
      escapeHtml(text.slice(t.start, t.end)),
      '</span>',
    );
    pos = t.end;
  }
  if (pos < text.length) out.push(escapeHtml(text.slice(pos)));
  if (text.endsWith('\n') || text === '') out.push(' ');
  return out.join('');
}
