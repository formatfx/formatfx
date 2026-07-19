// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Sam Yost

/**
 * editor/exprTokens.ts — the positioned sub-lexer for live strings (spec
 * docs/superpowers/specs/2026-07-09-json-pane-ide-design.md §1).
 *
 * Input is the raw JSON-escaped slice between a live string's quotes —
 * offsets are absolute buffer offsets, so the renderer can nest these
 * straight into the overlay. Tolerant like the JSON lexer above it: never
 * throws, unterminated anything runs to the slice end.
 *
 * Two escape realities meet here: SP string literals may be single-quoted
 * (raw in the JSON buffer) or double-quoted (arriving JSON-escaped as \").
 * `\\` is an escaped backslash; other `\X` pairs pass through unpainted.
 *
 * Deliberately NOT here: field-ref validity (forEach iterators make that
 * scope-dependent — the linter owns it) and paren matching. Bare non-call
 * identifiers (iterator names) stay unpainted and inherit the expr base.
 */

import { SP_FUNCTIONS } from '../core/schema';

export type ExprTokKind =
  | 'xfield'      // [$Due], [!Owner.Title]
  | 'xtoken'      // @now, @currentField.email
  | 'xfn'         // a call name the engine knows
  | 'xfn-unknown' // a call name it doesn't — rendered as an error
  | 'xstr'        // 'literal' or \"literal\" (JSON-escaped double quotes)
  | 'xnum'
  | 'xop'         // = == != <= >= && || + - * / % < > ! ? :
  | 'xparen'
  | 'xkw';        // true / false / forEach's `in`

export interface ExprToken { kind: ExprTokKind; start: number; end: number }

const FN_SET = new Set<string>(SP_FUNCTIONS);
const TWO_CHAR_OPS = ['==', '!=', '<=', '>=', '&&', '||'];
// '=' alone only ever appears as the formula prefix — paint it as an operator
const ONE_CHAR_OPS = new Set(['=', '+', '-', '*', '/', '%', '<', '>', '!', '?', ':']);

/** Lex text[start, end) as SP expression content. Offsets absolute. */
export function tokenizeExpr(text: string, start: number, end: number): ExprToken[] {
  const toks: ExprToken[] = [];
  let i = start;
  while (i < end) {
    const c = text[i];
    if (c === '\\' && i + 1 < end) {
      if (text[i + 1] === '"') {
        // a JSON-escaped double-quoted SP literal: scan to its closing \"
        let j = i + 2;
        while (j < end) {
          if (text[j] === '\\' && j + 1 < end) {
            if (text[j + 1] === '"') { j += 2; break; }
            j += 2; // \\ or another escape pair inside the literal
            continue;
          }
          j++;
        }
        toks.push({ kind: 'xstr', start: i, end: Math.min(j, end) });
        i = Math.min(j, end);
        continue;
      }
      i += 2; // \\, \n, \uXXXX prefix — opaque, unpainted
      continue;
    }
    if (c === "'") {
      let j = i + 1;
      while (j < end && text[j] !== "'") j++;
      toks.push({ kind: 'xstr', start: i, end: Math.min(j + 1, end) });
      i = Math.min(j + 1, end);
      continue;
    }
    if (c === '[') {
      let j = i + 1;
      while (j < end && text[j] !== ']') j++;
      toks.push({ kind: 'xfield', start: i, end: Math.min(j + 1, end) });
      i = Math.min(j + 1, end);
      continue;
    }
    if (c === '@') {
      let j = i + 1;
      while (j < end && /[A-Za-z0-9_.]/.test(text[j])) j++;
      toks.push({ kind: 'xtoken', start: i, end: j });
      i = j;
      continue;
    }
    if (c >= '0' && c <= '9') {
      let j = i + 1;
      while (j < end && /[0-9.]/.test(text[j])) j++;
      toks.push({ kind: 'xnum', start: i, end: j });
      i = j;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i + 1;
      while (j < end && /[A-Za-z0-9_]/.test(text[j])) j++;
      const word = text.slice(i, j);
      if (word === 'true' || word === 'false') {
        toks.push({ kind: 'xkw', start: i, end: j });
      } else {
        let k = j;
        while (k < end && (text[k] === ' ' || text[k] === '\t')) k++;
        if (text[k] === '(') {
          toks.push({ kind: FN_SET.has(word) ? 'xfn' : 'xfn-unknown', start: i, end: j });
        }
        // bare non-call identifiers (forEach iterators): unpainted
      }
      i = j;
      continue;
    }
    const two = text.slice(i, i + 2);
    if (TWO_CHAR_OPS.includes(two)) {
      toks.push({ kind: 'xop', start: i, end: i + 2 });
      i += 2;
      continue;
    }
    if (ONE_CHAR_OPS.has(c)) {
      toks.push({ kind: 'xop', start: i, end: i + 1 });
      i++;
      continue;
    }
    if (c === '(' || c === ')') {
      toks.push({ kind: 'xparen', start: i, end: i + 1 });
      i++;
      continue;
    }
    i++; // spaces, commas, anything else — unpainted (inherits the expr base)
  }
  return toks;
}

/** Lex a forEach spec ("item in [$Field]"): the iterator stays unpainted,
 *  `in` reads as a keyword, the list part is ordinary expression content.
 *  A slice without the `ident in ` shape lexes as a plain expression. */
export function tokenizeForEach(text: string, start: number, end: number): ExprToken[] {
  const m = /^\s*[A-Za-z_$][A-Za-z0-9_$]*\s+in\s/.exec(text.slice(start, end));
  if (!m) return tokenizeExpr(text, start, end);
  const inStart = start + m[0].length - 3; // back over 'in' + the trailing space
  return [
    { kind: 'xkw', start: inStart, end: inStart + 2 },
    ...tokenizeExpr(text, inStart + 2, end),
  ];
}
