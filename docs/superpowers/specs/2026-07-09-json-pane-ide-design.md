# JSON pane IDE upgrade — design (approved 2026-07-09)

Owner ask: differentiated syntax highlighting inside expressions (column refs
at minimum), folding, auto-format, plus whatever IDE and list-formatting-
specific intelligence makes the pane genuinely developer-grade.

Approved in-session 2026-07-09; folding flavor decided by the owner:
**subtree folding first** (clean-buffer-only, auto-expand on edit).

## Constraints (standing)

- Vanilla TS + Vite, zero runtime dependencies. The textarea-over-overlay
  architecture (#244) stays: native caret/undo/IME, transparent textarea text,
  scroll-synced highlighted `<pre>` underneath.
- No document writes from any of this — **Apply stays the one mutation**.
  Everything here is view/buffer work and never touches the undo stack.
- Pure decision modules + thin geometry wiring in `jsonIde.ts`, each pure
  module pinned by its own test file (tests are contracts).
- Generators/completions stay grounded in `src/core` catalogs; never emit a
  standalone `!` (no logical NOT — `!=` is fine).
- `wb-` CSS prefix and localStorage keys frozen. New syntax colors must not
  collide with the reserved `--wb-shared` violet channel (shared column
  styles own that hue).

## Module map (new files)

| Module | Job | Test file |
|---|---|---|
| `src/editor/exprTokens.ts` | positioned, tolerant sub-lexer for live strings | `exprTokens.test.ts` |
| `src/editor/jsonFold.ts` | fold candidates + FoldMap (folded↔full offset bimap) | `jsonFold.test.ts` |
| `src/core/jsonText.ts` | positioned tolerant JSON parser: path map + parse errors from arbitrary buffer text | `jsonText.test.ts` |
| `src/editor/jsonDecorations.ts` | merge parse/lint ranges into renderable underline spans | `jsonDecorations.test.ts` |
| `src/editor/jsonHover.ts` | what-to-show-at-offset brain (docs, values, x-ray) | `jsonHover.test.ts` |
| `src/editor/exprPreview.ts` | live evaluation chip content | `exprPreview.test.ts` |
| `src/editor/jsonFormat.ts` | format-document + typing-ergonomics decisions | `jsonFormat.test.ts` |

`jsonIde.ts` grows only geometry/event plumbing; `jsonPanel.ts` gains a
buffer-view accessor so every offset consumer reads through the fold layer.

## 1. Expression sub-highlighting

`tokenizeExpr(text, contentStart, contentEnd)` lexes the **raw JSON-escaped
slice** between a live string's quotes (absolute buffer offsets out):

- Kinds: `xfield` (`[$Ref]` / `[!Ref]`, dot-props included), `xtoken`
  (`@word.word`), `xfn` (identifier followed by `(` and known to
  `SP_FUNCTIONS`), `xfn-unknown` (call name the engine lacks — renders with
  the existing `wb-tok-err` treatment: live typo catch), `xstr` (SP string
  literals: `'…'` raw, `"…"` arriving JSON-escaped as `\"…\"`), `xnum`,
  `xop` (`== != <= >= && || + - * / % < > ! ? :`), `xparen`, `xkw`
  (`true`/`false`).
- Tolerant: never throws; unterminated literal runs to `contentEnd`. `\\`
  is an escaped backslash; `\uXXXX` passes through as opaque chars.
- Bare identifiers not followed by `(` (forEach iterators, function-arg
  words) stay unpainted — they inherit the `expr` base color.
- **No field-validity checking in the lexer.** `forEach` iterator scope makes
  ref validity context-dependent; the linter already resolves scope
  correctly, so unknown-ref warnings arrive with the squiggle layer (§5),
  not here. Lexical guessing would false-flag `[$_item]`.

Renderer integration: `renderJsonHtml` emits **nested spans** for `expr`
tokens — `<span class="wb-tok-expr">` wrapping sub-token spans, so
unclassified chars keep the expr base color. The render walk also tracks the
last `key` token: when the key is `forEach`, the (plain-string) value gets a
mini spec lex (`ident`, `in`, then expression tokens), since
`"item in [$Multi]"` doesn't match `isLiveString` but is live.

JSON-level bracket matching is unchanged; paren-matching *inside*
expressions is explicitly out of scope for v1.

Palette: new `--wb-syn-xfield/-xtoken/-xfn/-xstr/-xnum/-xop/-xkw` vars in
both themes. Field refs read loudest (that is the ask). Ship accessible
defaults; the final hue values are an owner contribution point (swatch slots
handed over in PR A review).

## 2. Format document + typing ergonomics (`jsonFormat.ts`)

- **Format document** (Alt+Shift+F + kebab item): if `importJson(buffer)`
  parses, re-emit via the canonical serializer (`keepMeta: true`, matching
  the view) with `preserveCaret`; the buffer **stays dirty** — formatting is
  not Apply. If it doesn't parse: tolerant depth-based re-indent (strings
  untouched), and the parse error surfaces in the existing import-error
  strip. Toast says which tier ran.
- **Auto-indent on Enter**: new line copies current indent, +1 level after
  an opening `{`/`[`; when the next char is the matching closer, the closer
  drops to its own dedented line with the caret between (brace-Enter).
- **Auto-close pairs** `{} [] ""`: close-and-caret-between, skip-over when
  typing a closer already present, wrap-selection on quote. String context
  (via the tolerant scan) suppresses `{`/`[` auto-close inside strings.
- **Paste re-indent**: multi-line pastes re-indent to caret depth
  (conservative — no full format on paste).
- All edits go through the undo-preserving `execCommand('insertText')` path
  already used by completions (`spliceKeepingUndo`), with the plain-splice
  fallback for test DOMs.

## 3. Subtree folding (`jsonFold.ts`) — as decided

Fold units are `jsonMap` node ranges on a **clean buffer only**.

- **Candidates**: any mapped node whose opening and closing brackets sit on
  different lines. Cut = `[end-of-opening-bracket-line, start-of-closer's
  indentation)`, replaced by the sentinel ` ⋯ ` (U+22EF, spaces around).
  The folded line reads `"style": { ⋯ },` — all real text except the
  sentinel; the closer and trailing comma are preserved.
- **FoldMap**: sorted cuts with `toFolded(offset)` / `toFull(offset)`
  (piecewise linear; offsets inside a cut clamp to its start; offsets inside
  a sentinel map to the cut start) and `cutAtFolded(offset)`. The textarea
  holds the folded text; `jsonPanel` exposes one `view` accessor
  (`view.text` = full text, offset translators) that **every** consumer uses:
  Apply, caret→canvas sync, reveal/flash, scope bar, breadcrumb, completions.
- **Gutter**: gains pointer events + a chevron column (widen `GUTTER_W` and
  its CSS twin once): `▾` on foldable open lines, `▸` on folded ones; click
  toggles. Line numbers show **full-coordinate** numbers (gaps across folds).
- **Commands**: *Fold others* (collapse every subtree outside the selected
  element's ancestor path — pairs with canvas selection), *Expand all* (both
  in the kebab); `Ctrl+Shift+[` / `Ctrl+Shift+]` fold/unfold the node at the
  caret. Caret landing inside a sentinel unfolds just that region.
- **Edits never coexist with folds**: on `beforeinput` with folds active —
  `preventDefault()`, expand all, remap the selection through `toFull`, then
  re-apply the edit for the common inputTypes (`insertText`,
  `insertLineBreak`, `insertParagraph`, `deleteContentBackward`/`Forward`,
  `insertFromPaste`, `insertFromDrop` — data recovered from
  `e.data`/`e.dataTransfer`). Unhandled types just expand (the user repeats
  the gesture). `compositionstart` expands preemptively (IME-safe). A
  selection that visually spans a folded placeholder expands to cover the
  hidden interior — WYSIWYG delete semantics (test-pinned).
- **Persistence**: folds are path-keyed; after canvas-driven regenerates,
  re-resolve each path via `rangeForPath` and re-apply (deterministic
  serializer keeps this stable); unresolvable paths drop. Entering the dirty
  state hides chevrons (stale offsets) — the auto-expand already ran.
- Programmatic `.value` swaps clearing native textarea undo is pre-existing
  behavior (regenerate does it today) and acceptable: folds exist only on
  clean buffers, where there is nothing to undo.
- Future upgrade path (not v1): once §4's parser lands, folding could be
  offered on dirty buffers by keying folds to parsed ranges.

## 4. Positioned parser foundation (`core/jsonText.ts`)

`parseJsonWithMap(text)` → `{ ranges, errors, value? }`:

- `ranges` reproduce **exactly** the path/range semantics of
  `exportJsonWithMap` (element-node paths per the serializer's convention).
  Pinned by a property test: for any exported doc,
  `parseJsonWithMap(exportJsonWithMap(doc).text).ranges` equals the
  serializer's own map.
- `errors`: positioned `{ start, end, message }` — unterminated string,
  expected `:`, expected `,` or `}`, unclosed bracket at EOF, bare word.
  Recovery at member boundaries (skip to next `,`/`}`/`]` at frame depth),
  error count capped (20) to avoid cascade noise.
- Wiring: while dirty, a per-frame-debounced parse refreshes the working
  path map → **scope bar and breadcrumb stay live during hand edits**; parse
  errors feed §5 squiggles immediately ("where's the missing comma", while
  typing). Caret→canvas selection stays clean-buffer-gated (the #218 guard
  is deliberate: a half-typed buffer must not drive selection).

## 5. Squiggles + hover cards

- **Decorations** (`jsonDecorations.ts`): parse errors (char-precise, `err`)
  + `lintDocument` issues (path → range via the map; the underline covers
  the element's **opening line only** — clear, not noisy; the lint footer
  stays the detail/keyboard view). Severity classes mirror the lint badges.
  `mergeForRender(tokens, decorations)` splits spans at boundaries,
  max-severity wins; renderer paints `text-decoration: underline wavy` on
  overlay spans.
- **Hover** (`jsonHover.ts` + geometry in `jsonIde.ts`): throttled mousemove
  → monospace col/line → offset (beyond-line-end → null) → priority:
  decoration message, else token docs — field refs (display name, type
  badge, row-0 value), functions (signature + summary from
  `SP_FUNCTION_DOCS`), style props / attributes (`STYLE_PROP_DOCS` /
  `ATTRIBUTE_DOCS`), `@tokens` (fxSuggest catalog docs), class tokens (name
  + any catalog doc), and for whole formula strings the **unescaped x-ray**
  (the `\"`-free expression, monospace). Card floats above the pointer's
  line, `pointer-events: none`, ~150 ms delay, hides on scroll/input/leave.
- Lint footer rows gain click → flash-the-range symmetry (existing flash
  machinery).

## 6. Live eval chip + list-formatting extras (`exprPreview.ts`)

- Caret inside any live string → evaluate through the real engine against
  the sample row (`evaluate` / `parseForEach` + `evaluateForEachList`;
  same row source as completions today — `ctxForRow(0)`, upgrade hook to the
  canvas's active row noted). Result appends to the signature strip:
  `→ "3 days overdue"`, `→ 3 items: Red, Green, …`, or the engine's error
  (`⚠ message`). Truncated ~48 chars, type-badged. Works mid-edit (the
  tolerant scan already powers signature hints on dirty buffers).
- **Occurrence highlighting**: caret on an `xfield`/`xtoken` softly lights
  every same-text occurrence (overlay class, no behavior).
- **Color chips**: style-value tokens matching `#hex` / `rgb()/hsl()` / the
  curated named-color list get a `::before` swatch via a custom property on
  the span. Overlay-only, non-interactive in v1.
- **Breadcrumb bar** (ships with PR D — it rides the live path map): slim
  strip over the editor showing the caret's path as `_elmName ?? elmType`
  segments (`card › badge › style`); fold- and dirty-aware; click a crumb →
  `state.select(path)` echoed as code-origin so the pane doesn't
  flash/scroll itself.
- **Size meter**: breadcrumb-strip right edge, live byte count of what Copy
  would produce (current toggles). Threshold only if the documented SP cap
  is verified via the sharepoint-formatting docs during implementation —
  unverified, it shows size without judgment.
- **iconName glyphs** in completions/hover: only if `iconData.ts`'s
  rendering transfers cheaply (planning checkpoint; skip otherwise).

## 7. Testing

- Every pure module: dedicated test file (see map). Highlights: sub-lexer
  escape/unterminated cases; FoldMap round-trip + edit-boundary math +
  span-a-fold selection semantics; the parser ≡ serializer-map property
  test; decoration merge precedence; format tier selection.
- DOM wiring: extend `jsonPanel.sync.test.ts` patterns (teardown discipline)
  for fold auto-expand, format-preserves-dirty, hover show/hide, chip text.
- One targeted Playwright spec drives the real pane (type a formula → sub
  colors; fold/unfold; format document). Full e2e stays CI's job (standing
  rule).

## 8. Delivery — five PRs, each green + auto-opened + watched

| PR | Branch | Contents |
|---|---|---|
| A | `claude/json-ide-expr-colors` | `exprTokens.ts`, renderer nesting, palette vars (+ this spec) |
| B | `claude/json-ide-format` | `jsonFormat.ts`: format document, Enter/auto-close/paste ergonomics |
| C | `claude/json-ide-folding` | `jsonFold.ts`, gutter chevrons, commands, auto-expand guards |
| D | `claude/json-ide-live-map` | `core/jsonText.ts`, squiggles, hover cards, live scope/breadcrumb |
| E | `claude/json-ide-eval-chip` | `exprPreview.ts` chip, occurrences, color chips, size meter, iconName (if cheap) |

Build + unit tests green before each PR; PR body: what/why + test counts;
CI watched via the persistent monitor (no `subscribe_pr_activity` — poll
`gh`); never merge, never push `main`.
