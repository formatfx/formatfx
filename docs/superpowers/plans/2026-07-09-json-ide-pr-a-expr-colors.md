# JSON pane PR A — expression sub-highlighting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Inside every live string in the JSON pane, paint field refs, @tokens, function names, string literals, numbers and operators distinctly — with unknown function names getting the error treatment.

**Architecture:** A new pure positioned sub-lexer (`exprTokens.ts`) runs over the raw JSON-escaped content of live strings; `renderJsonHtml` (in `jsonHighlight.ts`) nests sub-token spans inside the existing `wb-tok-expr` span and tracks the last key so `forEach` values (plain strings, but live) get lexed too. CSS adds `--wb-syn-x*` slots. `tokenizeJson`, `jsonIde.ts`, and the panel are untouched.

**Tech Stack:** Vanilla TypeScript, Vitest, plain CSS. Zero runtime dependencies.

**Spec:** `docs/superpowers/specs/2026-07-09-json-pane-ide-design.md` §1 (PR A row of §8).

## Global Constraints

- Zero runtime dependencies; pure modules, DOM-free, never throw on any input (tolerant lexing — half-typed buffers are the point).
- The overlay's flattened text must equal the buffer text exactly (alignment invariant — the transparent textarea sits over it).
- No field-validity checking in the lexer (forEach iterator scope — the linter owns that; spec §1).
- Never emit or suggest a standalone `!`; `!=` paints as one operator.
- `wb-` CSS prefix; new hues must not collide with the reserved `--wb-shared` violet channel.
- No `font-weight` on sub-token spans — bold glyph metrics could shear overlay↔textarea alignment in fallback monospace fonts; loudness comes from a background tint pill instead.
- Every commit message ends with the standing co-author + session trailer.

---

### Task 1: `exprTokens.ts` — the positioned sub-lexer

**Files:**
- Create: `src/editor/exprTokens.ts`
- Test: `src/editor/exprTokens.test.ts`

**Interfaces:**
- Consumes: `SP_FUNCTIONS` from `src/core/schema.ts` (a `readonly string[]` of engine function names).
- Produces (Task 2 relies on these exact names):
  - `export type ExprTokKind = 'xfield' | 'xtoken' | 'xfn' | 'xfn-unknown' | 'xstr' | 'xnum' | 'xop' | 'xparen' | 'xkw'`
  - `export interface ExprToken { kind: ExprTokKind; start: number; end: number }` (absolute offsets, half-open)
  - `export function tokenizeExpr(text: string, start: number, end: number): ExprToken[]`
  - `export function tokenizeForEach(text: string, start: number, end: number): ExprToken[]`

- [ ] **Step 1: Write the failing test**

`src/editor/exprTokens.test.ts`:

```ts
/**
 * exprTokens.test.ts — the positioned sub-lexer for live strings (spec
 * 2026-07-09 §1). Contract: tolerant (never throws, unterminated anything
 * runs to the slice end), JSON-escape-aware (the buffer holds \" for SP
 * double-quoted literals), and unknown function names read as errors.
 */
import { describe, it, expect } from 'vitest';
import { tokenizeExpr, tokenizeForEach } from './exprTokens';

const lex = (s: string): Array<[string, string]> =>
  tokenizeExpr(s, 0, s.length).map((t) => [t.kind, s.slice(t.start, t.end)]);

describe('tokenizeExpr', () => {
  it('paints refs, tokens, functions, strings, numbers and operators distinctly', () => {
    const s = "=if([$Due] <= @now, 'Late', toString(3))";
    expect(lex(s)).toEqual([
      ['xop', '='], ['xfn', 'if'], ['xparen', '('],
      ['xfield', '[$Due]'], ['xop', '<='], ['xtoken', '@now'],
      ['xstr', "'Late'"], ['xfn', 'toString'], ['xparen', '('], ['xnum', '3'], ['xparen', ')'],
      ['xparen', ')'],
    ]);
  });

  it('flags unknown function names as xfn-unknown (live typo catch)', () => {
    expect(lex('=iff([$x], 1, 2)')).toContainEqual(['xfn-unknown', 'iff']);
    expect(lex('=if([$x], 1, 2)')).toContainEqual(['xfn', 'if']);
  });

  it('JSON-escaped double-quoted SP literals stay one xstr token', () => {
    // buffer chars: =if([$T] == \"Done\", 1, 0)
    const s = '=if([$T] == \\"Done\\", 1, 0)';
    expect(lex(s)).toContainEqual(['xstr', '\\"Done\\"']);
  });

  it('a double quote inside a single-quoted literal is just content', () => {
    // buffer chars: ='he said \"hi\"'
    const s = "='he said \\\"hi\\\"'";
    expect(lex(s)).toEqual([['xop', '='], ['xstr', "'he said \\\"hi\\\"'"]]);
  });

  it('dotted refs and dotted @tokens tokenize whole', () => {
    expect(lex('=[!Owner.Title] == @currentField.email')).toEqual([
      ['xop', '='], ['xfield', '[!Owner.Title]'], ['xop', '=='], ['xtoken', '@currentField.email'],
    ]);
  });

  it('!= is one operator; a standalone ! is also painted (the linter flags it, not us)', () => {
    expect(lex('=[$a] != 1')).toContainEqual(['xop', '!=']);
    expect(lex('=![$a]')).toContainEqual(['xop', '!']);
  });

  it('true/false are keywords; bare non-call identifiers stay unpainted', () => {
    const toks = lex("=if([$Done], true, _x)");
    expect(toks).toContainEqual(['xkw', 'true']);
    expect(toks.some(([, text]) => text === '_x')).toBe(false);
  });

  it('unterminated refs and literals run to the slice end (tolerant, never throws)', () => {
    expect(lex('=if([$Due')).toEqual([
      ['xop', '='], ['xfn', 'if'], ['xparen', '('], ['xfield', '[$Due'],
    ]);
    expect(lex("='oops")).toEqual([['xop', '='], ['xstr', "'oops"]]);
    expect(lex('=\\"oops')).toEqual([['xop', '='], ['xstr', '\\"oops']]);
  });

  it('bare whole-string refs and tokens (no = prefix) lex fine', () => {
    expect(lex('[$Title]')).toEqual([['xfield', '[$Title]']]);
    expect(lex('@thumbnail')).toEqual([['xtoken', '@thumbnail']]);
  });

  it('respects slice bounds (absolute offsets in, absolute offsets out)', () => {
    const s = 'XX[$Due]YY';
    const toks = tokenizeExpr(s, 2, 8);
    expect(toks).toEqual([{ kind: 'xfield', start: 2, end: 8 }]);
  });
});

describe('tokenizeForEach', () => {
  it('paints the in keyword and the list expression', () => {
    const s = 'item in [$Colors]';
    expect(tokenizeForEach(s, 0, s.length).map((t) => [t.kind, s.slice(t.start, t.end)])).toEqual([
      ['xkw', 'in'], ['xfield', '[$Colors]'],
    ]);
  });

  it('falls back to plain expression lexing when the spec shape is absent', () => {
    const s = '[$Colors]';
    expect(tokenizeForEach(s, 0, s.length)).toEqual([{ kind: 'xfield', start: 0, end: 9 }]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/editor/exprTokens.test.ts`
Expected: FAIL — `Cannot find module './exprTokens'` (or equivalent resolve error).

- [ ] **Step 3: Write the implementation**

`src/editor/exprTokens.ts`:

```ts
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Sam Yost. FormatFX is dual-licensed: AGPL-3.0-only (see LICENSE) or a commercial license (see LICENSING.md).

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
            j += 2; // \\ or other pair inside the literal
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/editor/exprTokens.test.ts`
Expected: PASS (12 tests).

- [ ] **Step 5: Commit**

```bash
git add src/editor/exprTokens.ts src/editor/exprTokens.test.ts
git commit -F <tempfile with:>
"feat: positioned sub-lexer for SP expression strings

Tolerant, JSON-escape-aware lexer painting field refs, @tokens, function
names (unknown ones as errors), literals, numbers and operators inside
live strings. Spec 2026-07-09 §1, PR A.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01RFWLY16FP8Ha3Yp11retBT"
```

---

### Task 2: renderer nesting + forEach key tracking

**Files:**
- Modify: `src/editor/jsonHighlight.ts` (the `renderJsonHtml` function, lines ~159-188, and the header comment)
- Test: `src/editor/jsonHighlight.test.ts` (append a describe block)

**Interfaces:**
- Consumes: `tokenizeExpr`, `tokenizeForEach` from `./exprTokens` (Task 1).
- Produces: `renderJsonHtml(text, tokens, match?)` — same signature, richer HTML: `expr` tokens (and `str` tokens whose key is `forEach`) become `<span class="wb-tok-expr">…nested sub-token spans…</span>`. Sub-token classes are `wb-tok-<kind>`, except `xfn-unknown` which emits `wb-tok-err` (reusing the existing error styling). Task 3 styles these classes.

- [ ] **Step 1: Write the failing tests**

Append to `src/editor/jsonHighlight.test.ts`:

```ts
describe('renderJsonHtml — expression sub-tokens', () => {
  /** The overlay must carry EXACTLY the buffer text once tags are stripped —
   *  the transparent textarea sits over it, so any drift shears alignment. */
  const flat = (html: string): string => html
    .replace(/<[^>]*>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

  it('nests sub-token spans inside the expr span', () => {
    const text = '{"txtContent": "=if([$Due] <= @now, \'Late\', \'\')"}';
    const html = renderJsonHtml(text, tokenizeJson(text), null);
    expect(html).toContain('<span class="wb-tok-xfield">[$Due]</span>');
    expect(html).toContain('<span class="wb-tok-xtoken">@now</span>');
    expect(html).toContain('<span class="wb-tok-xfn">if</span>');
    expect(html).toContain("<span class=\"wb-tok-xstr\">'Late'</span>");
    expect(flat(html)).toBe(text);
  });

  it('bare whole-string refs sub-paint too', () => {
    const text = '{"a": "[$Title]"}';
    const html = renderJsonHtml(text, tokenizeJson(text), null);
    expect(html).toContain('<span class="wb-tok-xfield">[$Title]</span>');
    expect(flat(html)).toBe(text);
  });

  it('forEach values are live: spec lex inside an expr span', () => {
    const text = '{"forEach": "item in [$Colors]", "x": "item in a sentence"}';
    const html = renderJsonHtml(text, tokenizeJson(text), null);
    expect(html).toContain('<span class="wb-tok-xkw">in</span>');
    expect(html).toContain('<span class="wb-tok-xfield">[$Colors]</span>');
    // the same-shaped string under a DIFFERENT key stays a plain string
    expect(html).toContain('<span class="wb-tok-str">"item in a sentence"</span>');
    expect(flat(html)).toBe(text);
  });

  it('unknown function names render with the error class', () => {
    const text = '{"txtContent": "=iff([$x], 1, 2)"}';
    const html = renderJsonHtml(text, tokenizeJson(text), null);
    expect(html).toContain('<span class="wb-tok-err">iff</span>');
  });

  it('HTML inside expression strings stays escaped', () => {
    const text = '{"txtContent": "=if([$a] < 3, \'<b>\', \'\')"}';
    const html = renderJsonHtml(text, tokenizeJson(text), null);
    expect(html).not.toContain('<b>');
    expect(flat(html)).toBe(text);
  });

  it('an unterminated expression string still paints and stays lossless', () => {
    const text = '{"txtContent": "=if([$Due';
    const html = renderJsonHtml(text, tokenizeJson(text), null);
    expect(html).toContain('<span class="wb-tok-xfield">[$Due</span>');
    expect(flat(html)).toBe(text);
  });

  it('a bracket-matched expr token keeps its match class on the outer span', () => {
    const text = '{"a": "=1"}';
    const toks = tokenizeJson(text);
    const expr = toks.find((t) => t.kind === 'expr')!;
    const html = renderJsonHtml(text, toks, [expr.start, expr.start] as const);
    // match stamping is punct-only in practice; the expr path must not crash
    expect(flat(html)).toBe(text);
  });
});
```

- [ ] **Step 2: Run tests to verify the new block fails**

Run: `npx vitest run src/editor/jsonHighlight.test.ts`
Expected: the new describe block FAILS (no `wb-tok-xfield` spans in output); all pre-existing tests still PASS.

- [ ] **Step 3: Rewrite `renderJsonHtml`**

Replace the existing `renderJsonHtml` in `src/editor/jsonHighlight.ts` with:

```ts
import { tokenizeExpr, tokenizeForEach, type ExprToken } from './exprTokens';
```

(import goes at the top of the file, after the header comment)

```ts
/** [contentStart, contentEnd) between a string token's quotes, or null for
 *  a token too small to have content (a lone opening quote, an empty string). */
function innerOf(text: string, t: JsonToken): [number, number] | null {
  const closed = t.end - t.start >= 2 && text[t.end - 1] === '"';
  const s = t.start + 1;
  const e = closed ? t.end - 1 : t.end;
  return e > s ? [s, e] : null;
}

/** Emit one live string: the outer expr span with sub-token spans nested. */
function renderLiveString(text: string, t: JsonToken, subs: ExprToken[], cls: string): string {
  const out: string[] = [`<span class="${cls}">`];
  const inner = innerOf(text, t);
  if (!inner) {
    out.push(escapeHtml(text.slice(t.start, t.end)), '</span>');
    return out.join('');
  }
  const [cs, ce] = inner;
  out.push(escapeHtml(text.slice(t.start, cs)));
  let p = cs;
  for (const s of subs) {
    if (s.start > p) out.push(escapeHtml(text.slice(p, s.start)));
    const subCls = s.kind === 'xfn-unknown' ? 'wb-tok-err' : `wb-tok-${s.kind}`;
    out.push(`<span class="${subCls}">`, escapeHtml(text.slice(s.start, s.end)), '</span>');
    p = s.end;
  }
  if (p < ce) out.push(escapeHtml(text.slice(p, ce)));
  out.push(escapeHtml(text.slice(ce, t.end)), '</span>');
  return out.join('');
}

export function renderJsonHtml(text: string, tokens: JsonToken[], match?: readonly [number, number] | null): string {
  const out: string[] = [];
  let pos = 0;
  // the key a value token hangs under — set by a key token, kept through its
  // ':', consumed by the next value token (so forEach values can be promoted)
  let pendingKey: string | null = null;
  for (const t of tokens) {
    if (t.start > pos) out.push(escapeHtml(text.slice(pos, t.start)));
    const matched = match && (t.start === match[0] || t.start === match[1]);
    const matchCls = matched ? ' wb-tok-match' : '';
    const forEachValue = t.kind === 'str' && pendingKey === 'forEach';
    if (t.kind === 'expr' || forEachValue) {
      const inner = innerOf(text, t);
      const subs = inner
        ? (forEachValue ? tokenizeForEach : tokenizeExpr)(text, inner[0], inner[1])
        : [];
      out.push(renderLiveString(text, t, subs, `wb-tok-expr${matchCls}`));
    } else {
      out.push(
        `<span class="wb-tok-${t.kind}${matchCls}">`,
        escapeHtml(text.slice(t.start, t.end)),
        '</span>',
      );
    }
    // key tracking (after emission — this token's own class never depends on it)
    if (t.kind === 'key') {
      pendingKey = text.slice(t.start + 1, t.end - 1);
    } else if (!(t.kind === 'punct' && text[t.start] === ':')) {
      pendingKey = null; // any value or structural move consumes/clears it
    }
    pos = t.end;
  }
  if (pos < text.length) out.push(escapeHtml(text.slice(pos)));
  if (text.endsWith('\n') || text === '') out.push(' ');
  return out.join('');
}
```

Also update the file's header comment: after the sentence about formula
strings getting their own token kind, add one line — `exprTokens.ts sub-lexes
INSIDE those strings (and forEach values) so refs/functions/literals read
distinctly; the renderer nests its spans.`

Note: a `key` token is always closed-with-colon by construction (that is the
tokenizer's definition of `key`), so `t.end - 1` safely strips its closing
quote. The trailing-newline pad and the lossless-flatten invariant are pinned
by the tests.

- [ ] **Step 4: Run tests to verify everything passes**

Run: `npx vitest run src/editor/jsonHighlight.test.ts src/editor/exprTokens.test.ts`
Expected: PASS, including all pre-existing jsonHighlight tests (the flatten invariant proves overlay alignment survives).

- [ ] **Step 5: Commit**

```bash
git add src/editor/jsonHighlight.ts src/editor/jsonHighlight.test.ts
git commit -m "feat: nest expression sub-token spans in the JSON overlay" # + standing trailer via -F tempfile
```

---

### Task 3: the palette — CSS slots for sub-token classes

**Files:**
- Modify: `src/style.css` (the token palette block, lines ~1564-1588)

**Interfaces:**
- Consumes: class names from Task 2 (`wb-tok-xfield`, `wb-tok-xtoken`, `wb-tok-xfn`, `wb-tok-xstr`, `wb-tok-xnum`, `wb-tok-xop`, `wb-tok-xparen`, `wb-tok-xkw`; `xfn-unknown` already lands on the existing `wb-tok-err`).
- Produces: `--wb-syn-x*` custom-property slots the owner retunes later (the agreed contribution point).

- [ ] **Step 1: Extend the palette block**

In `src/style.css`, extend the `:root` / `body.wb-dark` palette and add classes after `.wb-tok-punct`:

```css
:root {
  --wb-syn-key: #0451a5; --wb-syn-str: #a31515; --wb-syn-expr: #795e26;
  --wb-syn-num: #098658; --wb-syn-kw: #0c46bd; --wb-syn-err: #d13438;
  /* expression sub-tokens (spec 2026-07-09 §1) — owner-tunable slots.
     Field refs are the loudest voice: distinct teal + a tint pill (no bold —
     bold glyph metrics could shear the overlay off the transparent textarea).
     Steers clear of the reserved --wb-shared violet channel. */
  --wb-syn-xfield: #267f99; --wb-syn-xtoken: var(--wb-syn-kw);
  --wb-syn-xfn: var(--wb-syn-expr); --wb-syn-xstr: var(--wb-syn-str);
  --wb-syn-xnum: var(--wb-syn-num); --wb-syn-xop: var(--wb-text);
  --wb-syn-xkw: var(--wb-syn-kw);
}
body.wb-dark {
  --wb-syn-key: #9cdcfe; --wb-syn-str: #ce9178; --wb-syn-expr: #dcdcaa;
  --wb-syn-num: #b5cea8; --wb-syn-kw: #569cd6; --wb-syn-err: #f1707b;
  --wb-syn-xfield: #4ec9b0;
}
```

(the existing `--wb-syn-*` lines stay byte-identical; only the new slots are added)

```css
.wb-tok-xfield {
  color: var(--wb-syn-xfield);
  background: color-mix(in srgb, var(--wb-syn-xfield) 12%, transparent);
  border-radius: 3px;
}
.wb-tok-xtoken { color: var(--wb-syn-xtoken); font-style: italic; }
.wb-tok-xfn { color: var(--wb-syn-xfn); }
.wb-tok-xstr { color: var(--wb-syn-xstr); }
.wb-tok-xnum { color: var(--wb-syn-xnum); }
.wb-tok-xop { color: var(--wb-syn-xop); }
.wb-tok-xparen { color: var(--wb-text-2); }
.wb-tok-xkw { color: var(--wb-syn-xkw); }
```

Italic caveat check: Consolas italic keeps monospace advance widths, so
`@token` italics are alignment-safe; if visual inspection in Step 2 shows any
shear on the `@` tokens, drop the `font-style` line rather than shipping it.

- [ ] **Step 2: Build + visual sanity**

Run: `npm run build`
Expected: clean build.

Then load the app (dev server or preview skill), paste a formatter with a
formula (`=if([$Due] <= @now, 'Late', '')`), and confirm in BOTH themes:
refs read as teal pills, `@now` italic, `if` gold, `'Late'` string-red,
caret sits exactly on the glyphs (no shear anywhere on the line — type at
the line end after a pill to confirm).

- [ ] **Step 3: Commit**

```bash
git add src/style.css
git commit -m "feat: sub-token palette slots for expression highlighting" # + standing trailer
```

---

### Task 4: gate, PR, monitor

**Files:** none new (verification + delivery).

- [ ] **Step 1: Full local gate**

Run: `npm run build && npm test`
Expected: build clean, entire unit suite green. Do NOT run the full
Playwright suite locally (standing rule — CI's `e2e` check is the arbiter).

- [ ] **Step 2: Targeted visual evidence**

One screenshot of the pane showing a sub-highlighted formula (light or dark),
saved for the PR body. Use the preview skill / existing chrome-debug flow.

- [ ] **Step 3: Push and open the PR**

```bash
git push -u origin claude/json-ide-expr-colors
gh pr create --title "JSON pane: expression sub-token highlighting (spec §1, PR A)" --body-file <tempfile>
```

PR body: what changed (sub-lexer + renderer nesting + palette slots), why
(flat expr color hid structure — owner ask), test counts (new + total), the
spec path, and the owner contribution note: `--wb-syn-x*` slots are yours to
retune. PowerShell note: write bodies via temp file, not heredoc.

- [ ] **Step 4: Watch CI + reviews**

Start the persistent monitor (Monitor tool polling `gh pr checks` /
`gh api` for review comments — `subscribe_pr_activity` does not exist).
Auto-fix clear findings; ask on anything architectural; never merge.
