# JSON pane PR B — format document + typing ergonomics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Format-document command (canonical when the buffer parses, tolerant re-indent when it doesn't) plus live typing ergonomics — auto-indent on Enter, auto-close pairs with skip-over and quote-wrap, paste re-indent — all undo-preserving and never touching the document.

**Architecture:** One new pure module (`editor/jsonFormat.ts`) makes every decision; `jsonIde.ts` wires keydown/beforeinput through the existing `spliceKeepingUndo` path; `jsonPanel.ts` owns the Format command (kebab button + Alt+Shift+F) because it holds the sanitize toggle, error strip, toast, and `preserveCaret`. Apply remains the only document write; Format never clears the dirty state.

**Tech Stack:** Vanilla TypeScript, Vitest (jsdom for DOM tests), zero runtime dependencies.

**Spec:** `docs/superpowers/specs/2026-07-09-json-pane-ide-design.md` §2 (PR B row of §8). Working tree: `C:\dev\formatfx-prb` (worktree on `claude/json-ide-format`).

## Global Constraints

- Pure decision module, DOM-free, never throws on any input; wiring is geometry/event plumbing only.
- Serializer indent is **2 spaces** (`serializer.ts:143`, `opts.indent ?? 2`) — Enter/re-indent must match.
- Buffer edits ride `spliceKeepingUndo` (execCommand) with the plain-splice + `deps.onSplice()` fallback for test DOMs.
- Format = buffer work: importJson→exportJson round-trip with `keepMeta: true` (the view always shows `_elmName`), honoring the panel's sanitize toggle; **stays dirty**.
- Spec discipline: no auto-escape of `"` inside strings, no bracket wrap-selection (quotes only) — neither is in the spec.
- Commits end with the standing co-author + session trailer.

---

### Task 1: `jsonFormat.ts` — the pure decisions

**Files:**
- Create: `C:\dev\formatfx-prb\src\editor\jsonFormat.ts`
- Test: `C:\dev\formatfx-prb\src\editor\jsonFormat.test.ts`

**Interfaces:**
- Consumes: `importJson`, `exportJson` from `../core/serializer`; `scanString`, `tokenizeJson` from `./jsonHighlight`.
- Produces (Task 2 relies on these exact names):
  - `export type Assist = { kind: 'splice'; from: number; to: number; insert: string; caret: number } | { kind: 'caret'; caret: number }`
  - `export function formatDocument(text: string, opts: { sanitizeWhitespace: boolean }): { text: string; tier: 'canonical' | 'reindent'; error?: string }`
  - `export function reindentJson(text: string): string`
  - `export function typingAssist(text: string, selStart: number, selEnd: number, key: string): Assist | null`
  - `export function pasteReindent(text: string, selStart: number, pasted: string): string`

- [ ] **Step 1: Write the failing test**

`src/editor/jsonFormat.test.ts`:

```ts
/**
 * jsonFormat.test.ts — Format-document + typing-ergonomics decisions (spec
 * 2026-07-09 §2). Contract: canonical tier iff the buffer parses; re-indent
 * is tolerant and string-safe; assists are pure, undo-agnostic decisions
 * that never fire inside strings (except quote skip-over/wrap).
 */
import { describe, it, expect } from 'vitest';
import { formatDocument, reindentJson, typingAssist, pasteReindent } from './jsonFormat';
import { importJson } from '../core/serializer';

describe('formatDocument', () => {
  it('canonical tier: a parseable buffer round-trips through the serializer', () => {
    const messy = '{"elmType":"div","txtContent":"=if([$x], 1, 2)"}';
    const res = formatDocument(messy, { sanitizeWhitespace: true });
    expect(res.tier).toBe('canonical');
    expect(res.error).toBeUndefined();
    expect(res.text).toContain('\n  "elmType": "div"'); // 2-space pretty
    // same document, not just similar text
    expect(importJson(res.text).root).toEqual(importJson(messy).root);
  });

  it('reindent tier: a broken buffer gets indentation only, plus the parse error', () => {
    const broken = '{\n"elmType": "div"\n"txtContent": "x"\n}'; // missing comma
    const res = formatDocument(broken, { sanitizeWhitespace: true });
    expect(res.tier).toBe('reindent');
    expect(res.error).toBeTruthy();
    expect(res.text).toBe('{\n  "elmType": "div"\n  "txtContent": "x"\n}');
  });
});

describe('reindentJson', () => {
  it('re-indents by structural depth, closers dedent their own line', () => {
    const text = '{\n"a": {\n"b": 1\n},\n"c": [\n1\n]\n}';
    expect(reindentJson(text)).toBe('{\n  "a": {\n    "b": 1\n  },\n  "c": [\n    1\n  ]\n}');
  });

  it('brackets inside strings never move the depth', () => {
    const text = '{\n"t": "a } b [ c",\n"u": 1\n}';
    expect(reindentJson(text)).toBe('{\n  "t": "a } b [ c",\n  "u": 1\n}');
  });

  it('escaped quotes inside strings are handled (the string does not end early)', () => {
    const text = '{\n"t": "say \\"hi\\" {",\n"u": 1\n}';
    expect(reindentJson(text)).toBe('{\n  "t": "say \\"hi\\" {",\n  "u": 1\n}');
  });

  it('depth never goes negative on over-closed input', () => {
    expect(reindentJson('}\n{\n"a": 1\n}')).toBe('}\n{\n  "a": 1\n}');
  });
});

describe('typingAssist — Enter', () => {
  it('copies the current line indent', () => {
    const text = '{\n  "a": 1,\n  "b": 2\n}';
    const caret = text.indexOf('1,') + 2;
    const a = typingAssist(text, caret, caret, 'Enter');
    expect(a).toEqual({ kind: 'splice', from: caret, to: caret, insert: '\n  ', caret: caret + 3 });
  });

  it('adds one level after an opening brace', () => {
    const text = '{\n  "style": {';
    const caret = text.length;
    const a = typingAssist(text, caret, caret, 'Enter');
    expect(a).toEqual({ kind: 'splice', from: caret, to: caret, insert: '\n    ', caret: caret + 5 });
  });

  it('brace-Enter: expands between a pair, closer on its own dedented line', () => {
    const text = '{\n  "style": {}\n}';
    const caret = text.indexOf('{}') + 1; // between the braces
    const a = typingAssist(text, caret, caret, 'Enter');
    expect(a).toEqual({
      kind: 'splice', from: caret, to: caret,
      insert: '\n    \n  ',
      caret: caret + 5, // end of the indented middle line
    });
  });

  it('inside a string: no assist (default newline behavior)', () => {
    const text = '{"a": "hello"}';
    const caret = text.indexOf('hello') + 2;
    expect(typingAssist(text, caret, caret, 'Enter')).toBeNull();
  });
});

describe('typingAssist — auto-close and skip-over', () => {
  it('auto-closes { [ " at a boundary, caret between', () => {
    const text = '{"a": }';
    const caret = 6; // before the closing }
    expect(typingAssist(text, caret, caret, '{')).toEqual({ kind: 'splice', from: caret, to: caret, insert: '{}', caret: caret + 1 });
    expect(typingAssist(text, caret, caret, '[')).toEqual({ kind: 'splice', from: caret, to: caret, insert: '[]', caret: caret + 1 });
    expect(typingAssist(text, caret, caret, '"')).toEqual({ kind: 'splice', from: caret, to: caret, insert: '""', caret: caret + 1 });
  });

  it('never auto-closes brackets inside a string', () => {
    const text = '{"a": "x y"}';
    const caret = text.indexOf('x') + 1;
    expect(typingAssist(text, caret, caret, '{')).toBeNull();
    expect(typingAssist(text, caret, caret, '[')).toBeNull();
  });

  it('no auto-close directly before a word character', () => {
    const text = '{"a": x}';
    const caret = 6; // before x
    expect(typingAssist(text, caret, caret, '{')).toBeNull();
  });

  it('typing the closing quote at a closing quote skips over instead of inserting', () => {
    const text = '{"a": "xy"}';
    const caret = text.indexOf('xy') + 2; // right before the closing "
    expect(typingAssist(text, caret, caret, '"')).toEqual({ kind: 'caret', caret: caret + 1 });
  });

  it('typing " mid-string (not at the closer) stays default', () => {
    const text = '{"a": "xy"}';
    const caret = text.indexOf('xy') + 1;
    expect(typingAssist(text, caret, caret, '"')).toBeNull();
  });

  it('quote-wraps a selection outside strings', () => {
    const text = '{"a": stuff}';
    const from = text.indexOf('stuff');
    const to = from + 5;
    expect(typingAssist(text, from, to, '"')).toEqual({ kind: 'splice', from, to, insert: '"stuff"', caret: to + 2 });
  });

  it('} and ] skip over a matching next char, insert otherwise', () => {
    const text = '{"a": []}';
    const inBrackets = text.indexOf('[') + 1;
    expect(typingAssist(text, inBrackets, inBrackets, ']')).toEqual({ kind: 'caret', caret: inBrackets + 1 });
    expect(typingAssist(text, inBrackets, inBrackets, '}')).toBeNull(); // next char is ], not }
  });
});

describe('pasteReindent', () => {
  it('single-line pastes pass through unchanged', () => {
    expect(pasteReindent('{\n  "a": 1\n}', 4, '"x": 2,')).toBe('"x": 2,');
  });

  it('re-bases continuation lines to the caret line indent', () => {
    const text = '{\n    "a": 1\n}';
    const caret = text.indexOf('"a"');
    const pasted = '"b": {\n  "c": 1\n},';
    expect(pasteReindent(text, caret, pasted)).toBe('"b": {\n      "c": 1\n    },');
  });

  it('strips the common leading indent before re-basing', () => {
    const text = '{\n  "a": 1\n}';
    const caret = text.indexOf('"a"');
    const pasted = 'x\n        deep\n      shallow';
    // common indent of continuation lines (6) stripped, caret indent (2) applied
    expect(pasteReindent(text, caret, pasted)).toBe('x\n    deep\n  shallow');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `C:\dev\formatfx-prb`): `npx vitest run src/editor/jsonFormat.test.ts`
Expected: FAIL — cannot resolve `./jsonFormat`.

- [ ] **Step 3: Write the implementation**

`src/editor/jsonFormat.ts`:

```ts
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Sam Yost. FormatFX is dual-licensed: AGPL-3.0-only (see LICENSE) or a commercial license (see LICENSING.md).

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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/editor/jsonFormat.test.ts`
Expected: PASS (18 tests).

- [ ] **Step 5: Commit**

```bash
git add src/editor/jsonFormat.ts src/editor/jsonFormat.test.ts
git commit  # message: "feat: format-document + typing-assist decisions (pure)" + standing trailer
```

---

### Task 2: wiring — jsonIde assists + jsonPanel Format command

**Files:**
- Modify: `C:\dev\formatfx-prb\src\editor\jsonIde.ts` (keydown listener + new beforeinput listener + header comment)
- Modify: `C:\dev\formatfx-prb\src\editor\jsonPanel.ts` (kebab button, Format command, Alt+Shift+F)
- Test: `C:\dev\formatfx-prb\src\editor\jsonFormat.dom.test.ts` (new)

**Interfaces:**
- Consumes: `typingAssist`, `pasteReindent` (jsonIde); `formatDocument` (jsonPanel); existing `spliceKeepingUndo`, `preserveCaret`, `clearFlash`, `importErrorEl`, `sanitizeEl`, `ide.repaint()`.
- Produces: kebab button `#wb-json-format`; Alt+Shift+F on the textarea; Enter/pair/paste assists live in the pane.

- [ ] **Step 1: Write the failing DOM tests**

`src/editor/jsonFormat.dom.test.ts`:

```ts
/**
 * jsonFormat.dom.test.ts — wiring contracts for Format + typing assists:
 * the kebab command formats the buffer WITHOUT applying (stays dirty), and
 * keydown assists splice through the pane's dirty-marking path. Same
 * teardown discipline as jsonPanel.sync.test.ts.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mountJsonPanel } from './jsonPanel';
import { state } from './state';

afterEach(() => {
  document.querySelectorAll<HTMLElement>('body > *').forEach((el) => {
    (el as unknown as { _unsub?: () => void })._unsub?.();
    el.remove();
  });
  state.resetAll();
});

beforeEach(() => {
  state.resetAll();
});

function mountPanel() {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const toasts: string[] = [];
  mountJsonPanel(host, (m) => toasts.push(m));
  const textEl = host.querySelector('#wb-json-text') as HTMLTextAreaElement;
  return { host, textEl, toasts };
}

describe('Format document', () => {
  it('the kebab has a Format button; formatting a hand-edited buffer keeps it dirty and does not touch the doc', () => {
    const { host, textEl } = mountPanel();
    const btn = host.querySelector('#wb-json-format') as HTMLButtonElement;
    expect(btn).not.toBeNull();

    const before = JSON.stringify(state.doc);
    textEl.value = '{"elmType":"div","txtContent":"hi"}'; // messy hand-edit
    textEl.dispatchEvent(new Event('input', { bubbles: true }));
    btn.click();

    expect(textEl.value).toContain('\n  "elmType": "div"'); // canonical 2-space
    expect(textEl.classList.contains('wb-json-dirty')).toBe(true); // NOT applied
    expect(JSON.stringify(state.doc)).toBe(before); // document untouched
  });

  it('a broken buffer re-indents and surfaces the parse error without toasting success', () => {
    const { host, textEl } = mountPanel();
    textEl.value = '{\n"elmType": "div"\n"txtContent": "x"\n}'; // missing comma
    textEl.dispatchEvent(new Event('input', { bubbles: true }));
    (host.querySelector('#wb-json-format') as HTMLButtonElement).click();

    expect(textEl.value).toBe('{\n  "elmType": "div"\n  "txtContent": "x"\n}');
    const err = host.querySelector('#wb-json-import-error') as HTMLDivElement;
    expect(err.hidden).toBe(false);
    expect(err.textContent).toContain('Format is re-indent only');
  });

  it('Alt+Shift+F triggers the same command', () => {
    const { textEl } = mountPanel();
    textEl.value = '{"elmType":"div"}';
    textEl.dispatchEvent(new Event('input', { bubbles: true }));
    textEl.dispatchEvent(new KeyboardEvent('keydown', { key: 'F', altKey: true, shiftKey: true, bubbles: true }));
    expect(textEl.value).toContain('\n  "elmType": "div"');
  });
});

describe('typing assists (wired)', () => {
  it('Enter after an opening brace splices an indented line through the dirty-marking path', () => {
    const { textEl } = mountPanel();
    textEl.value = '{\n  "style": {';
    textEl.dispatchEvent(new Event('input', { bubbles: true }));
    const caret = textEl.value.length;
    textEl.setSelectionRange(caret, caret);
    const e = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    textEl.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(true);
    expect(textEl.value).toBe('{\n  "style": {\n    ');
    expect(textEl.selectionStart).toBe(textEl.value.length);
    expect(textEl.classList.contains('wb-json-dirty')).toBe(true);
  });

  it('quote skip-over moves the caret without editing', () => {
    const { textEl } = mountPanel();
    textEl.value = '{"a": "xy"}';
    textEl.dispatchEvent(new Event('input', { bubbles: true }));
    const caret = textEl.value.indexOf('xy') + 2;
    textEl.setSelectionRange(caret, caret);
    const before = textEl.value;
    const e = new KeyboardEvent('keydown', { key: '"', bubbles: true, cancelable: true });
    textEl.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(true);
    expect(textEl.value).toBe(before);
    expect(textEl.selectionStart).toBe(caret + 1);
  });
});
```

- [ ] **Step 2: Run to verify the new file fails**

Run: `npx vitest run src/editor/jsonFormat.dom.test.ts`
Expected: FAIL — `#wb-json-format` null, assists inert.

- [ ] **Step 3: Wire jsonIde.ts**

Import at top: `import { typingAssist, pasteReindent } from './jsonFormat';`

Inside the existing `keydown` listener, insert BETWEEN the Ctrl+Space block and `if (!ac) return;`:

```ts
    // #PR-B typing assists. The menu owns its navigation keys while open;
    // everything else (brackets, quotes — and Enter when no menu is up)
    // flows to the pure decision layer. Splices ride the same undo path
    // as accepted completions.
    const MENU_KEYS = new Set(['Enter', 'Tab', 'ArrowDown', 'ArrowUp', 'Escape']);
    if (!e.defaultPrevented && (!ac || !MENU_KEYS.has(e.key))) {
      const a = typingAssist(textEl.value, textEl.selectionStart ?? 0, textEl.selectionEnd ?? 0, e.key);
      if (a) {
        e.preventDefault();
        if (a.kind === 'caret') {
          textEl.setSelectionRange(a.caret, a.caret);
        } else {
          if (!spliceKeepingUndo(a.from, a.to, a.insert)) {
            const v = textEl.value;
            textEl.value = v.slice(0, a.from) + a.insert + v.slice(a.to);
            deps.onSplice();
          }
          textEl.setSelectionRange(a.caret, a.caret);
        }
        repaint();
        return;
      }
    }
```

Add a `beforeinput` listener next to the existing `input` listener:

```ts
  textEl.addEventListener('beforeinput', (e) => {
    if (e.inputType !== 'insertFromPaste') return;
    const raw = e.dataTransfer?.getData('text/plain') ?? e.data ?? '';
    if (!raw.includes('\n')) return;
    const selStart = textEl.selectionStart ?? 0;
    const adjusted = pasteReindent(textEl.value, selStart, raw);
    if (adjusted === raw) return;
    e.preventDefault();
    if (!spliceKeepingUndo(selStart, textEl.selectionEnd ?? selStart, adjusted)) {
      const v = textEl.value;
      textEl.value = v.slice(0, selStart) + adjusted + v.slice(textEl.selectionEnd ?? selStart);
      deps.onSplice();
    }
    const pos = selStart + adjusted.length;
    textEl.setSelectionRange(pos, pos);
    repaint();
  });
```

Header comment: add one line after the completions sentence — `Typing assists
(Enter indent, pair auto-close, paste re-base) ride jsonFormat.ts decisions
through the same splice path.`

- [ ] **Step 4: Wire jsonPanel.ts**

Import: `import { formatDocument } from './jsonFormat';`

Kebab markup — in `menuHost.innerHTML`, directly before `<hr>`:

```html
        <button id="wb-json-format" title="Pretty-print the buffer: canonical when it parses (Alt+Shift+F). Does not Apply.">Format document</button>
```

After the `ide` mount (so `ide.repaint` exists), add the command + bindings:

```ts
  // ── #PR-B Format document: buffer-only pretty print, never an Apply ──
  const formatCmd = (): void => {
    const res = formatDocument(textEl.value, { sanitizeWhitespace: sanitizeEl.checked });
    if (res.text !== textEl.value) {
      const selStart = textEl.selectionStart ?? 0;
      const selEnd = textEl.selectionEnd ?? selStart;
      const { scrollTop, scrollLeft } = textEl;
      const prev = textEl.value;
      textEl.value = res.text;
      textEl.setSelectionRange(preserveCaret(prev, res.text, selStart), preserveCaret(prev, res.text, selEnd));
      textEl.scrollTop = scrollTop;
      textEl.scrollLeft = scrollLeft;
      clearFlash();
      ide.repaint();
    }
    if (res.tier === 'reindent') {
      importErrorEl.textContent = `Format is re-indent only until the JSON parses — ${res.error}`;
      importErrorEl.hidden = false;
      onToast('Re-indented. Fix the parse error for canonical formatting.');
    } else {
      clearImportError();
      onToast('Formatted');
    }
  };
  menuHost.querySelector('#wb-json-format')!.addEventListener('click', formatCmd);
  textEl.addEventListener('keydown', (e) => {
    if (e.altKey && e.shiftKey && (e.key === 'F' || e.key === 'f')) {
      e.preventDefault();
      formatCmd();
    }
  });
```

Note: `formatCmd` deliberately never touches `dirty` — a formatted hand-edit
still needs Apply, and formatting a clean buffer produces byte-identical
canonical text (the serializer is deterministic), so the swap is a no-op.

- [ ] **Step 5: Run all affected tests**

Run: `npx vitest run src/editor/jsonFormat.test.ts src/editor/jsonFormat.dom.test.ts src/editor/jsonPanel.sync.test.ts src/editor/jsonIde.test.ts src/editor/jsonHighlight.test.ts`
Expected: ALL PASS (assists must not break sync contracts or menu handling).

- [ ] **Step 6: Commit**

```bash
git add src/editor/jsonIde.ts src/editor/jsonPanel.ts src/editor/jsonFormat.dom.test.ts
git commit  # message: "feat: wire Format document + typing assists into the JSON pane" + standing trailer
```

---

### Task 3: gate, PR, monitor

- [ ] **Step 1: Full gate** — `npm run build && npm test` in `C:\dev\formatfx-prb`. Expected: clean build, full suite green. No local Playwright suite (standing rule).
- [ ] **Step 2: Push + PR** — `git push -u origin claude/json-ide-format`; `gh pr create` with what/why, test counts, spec §2 reference, and the note that Format never Applies. Body via temp file.
- [ ] **Step 3: Monitor** — persistent Monitor on the new PR number for checks + review comments (same script shape as PR #265's). Auto-fix clear findings; never merge.
