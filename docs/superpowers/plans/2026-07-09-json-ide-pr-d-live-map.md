# JSON pane PR D — live map, squiggles, hover, breadcrumb Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** While the buffer is hand-edited (dirty), the pane keeps understanding it:
a per-frame-debounced tolerant parse refreshes a *working* path map so the scope
bar and a new breadcrumb strip stay live; positioned parse errors and lint issues
paint wavy squiggles on a separate overlay layer; hovering anything explains it
(decoration message, field/function/@token docs, the unescaped formula x-ray);
lint footer rows flash the lines they point at.

**Architecture:** Pure modules landed in Tasks 1–2 (`core/jsonText.ts` — the
positioned parser, `editor/jsonDecorations.ts` — merge/render decisions,
`editor/jsonHover.ts` — what-to-show-at-offset). Task 3 (this plan) is thin
wiring only: `jsonPanel.ts` owns decision *state* (live ranges/errors, cached
lint issues, the displayed-coordinate decoration list, breadcrumb content);
`jsonIde.ts` owns *geometry* (the `wb-json-sq` overlay layer, the floating
hover card, mousemove→offset math). Caret→canvas selection stays clean-buffer
gated (#218 — a half-typed buffer must not drive selection); everything here is
view work and never touches the document or the undo stack.

**Tech Stack:** Vanilla TypeScript, Vitest (happy-dom), plain CSS. Zero runtime deps.

**Spec:** `docs/superpowers/specs/2026-07-09-json-pane-ide-design.md` §4–5 (+ §6's
breadcrumb, which rides the live path map and ships with PR D per the spec).

## Global constraints

- The squiggle layer carries the buffer text verbatim (transparent glyphs, wavy
  decorations only) — the highlight layer's lossless invariant is never involved.
- `rangesNow()` = live map while dirty, serializer map while clean. View
  affordances read through it; `syncSelectionFromCaret` deliberately does NOT.
- Decorations compute in FULL-text coordinates, then translate through the fold
  view (folds ⇒ clean ⇒ the two systems are never both non-trivial).
- Breadcrumb labels come from the DOC (`state.nodeAt`) — `_elmName ?? elmType`,
  `#n` fallback for paths the doc can't resolve (hand-added elements mid-edit);
  crumb click = `echo.run('code', () => state.select(path))` so the pane never
  flashes itself.
- `wb-` prefix, no new localStorage keys, docs ride the code commit.

---

### Task 3a: live-dirty parse + squiggle layer + scope bar stays live

**Files:** `src/editor/jsonPanel.ts`, `src/editor/jsonIde.ts`, `src/style.css`
**Tests:** rewrite the scope-bar contract in `src/editor/jsonIde.test.ts`
(spec §4 supersedes "hides during hand edits" — it hides at the keystroke,
returns within a frame against the live map); new `src/editor/jsonLiveMap.dom.test.ts`.

- [ ] Panel: `liveRanges`/`liveErrors` + one-rAF-debounced `scheduleLiveParse()`
      from the input listener and `onSplice`; cleared in `regenerate()`.
- [ ] Panel: cached `lintIssues` in `renderLint`; `refreshDecorations()` builds
      the displayed-coordinate list via `decorationsFrom` + fold translation and
      calls `ide.repaintSquiggles()`.
- [ ] Ide: `wb-json-sq` layer (after `wb-json-hl`), scroll-synced, rebuilt in
      `repaint()` and via new `repaintSquiggles()` API from `deps.decorations()`.
- [ ] Panel: `selectionRange` dep reads `rangesNow()` (hidden only while the
      first parse is pending).
- [ ] CSS: `.wb-json-sq` joins the shared metrics rules; `wb-sq-err/-warning/-info`
      wavy underline colors in both themes.

### Task 3b: hover card

**Files:** `src/editor/jsonIde.ts` (geometry), `src/editor/jsonPanel.ts` (content dep)

- [ ] Ide: throttled mousemove (150 ms settle) → monospace col/line → offset
      (beyond-line-end → null) → `deps.hoverAt(offset)`; card floats above the
      pointer's line, `pointer-events: none`; hides on scroll/input/leave/blur.
- [ ] Panel: `hoverAt: (off) => hoverAt(textEl.value, off, decorations,
      state.fields, { ctx })` — same row-0 ctx source as completions.
- [ ] CSS: `.wb-json-hover` card + mono body variant.

### Task 3c: breadcrumb strip

**Files:** `src/editor/jsonPanel.ts`, `src/style.css`

- [ ] Slim `#wb-json-crumbs` strip above the shell: caret's element path as
      clickable `_elmName ?? elmType` segments; refreshed on click/keyup, the
      live parse, fold display swaps, format, and regenerate; hidden on wrapper
      chrome. (Size meter lands on its right edge in PR E.)

### Task 3d: lint-row flash symmetry

**Files:** `src/editor/jsonPanel.ts`

- [ ] Extract the flash-bar creation from `revealSelection` into a shared
      `flashRange(range)`; lint-row `jump()` falls back to it (via `rangesNow()`)
      whenever the selection emit didn't produce a bar (dirty buffer, same-path).

### Task 4: gate, PR, monitor

- [ ] `npm run build && npm test` green (never the full local Playwright suite —
      CI's `e2e` check is the arbiter).
- [ ] Targeted visual evidence: squiggle + hover + breadcrumb screenshot.
- [ ] Push `claude/json-ide-live-map`, `gh pr create` (what/why + test counts),
      arm the persistent gh-polling monitor, auto-fix clear findings, never merge.
