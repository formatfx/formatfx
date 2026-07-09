# JSON pane PR C — subtree folding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fold any multi-line element/object/array in the JSON pane to a one-line `"style": { ⋯ },` summary — chevrons, Fold-others/Expand-all, caret-unfold — with the guarantee that folds and hand-edits never coexist.

**Architecture:** A pure fold layer (`editor/jsonFold.ts`): cuts (full-text ranges elided to a ` ⋯ ` sentinel) + a folded↔full offset bimap. `jsonPanel.ts` owns fold state (path-keyed, re-applied across regenerates) and every full-coordinate consumer translates through the active view; `jsonIde.ts` gets an optional `folds` bridge for the chevron column, gapped line numbers, and edit guards. A capture-stage cancelable `beforeinput` (+ `compositionstart`) expands everything before any edit lands — the undo-resurrection bug class is designed out, not handled.

**Tech Stack:** Vanilla TS, Vitest/jsdom. Zero deps. Worktree `C:\dev\formatfx-prb`, branch `claude/json-ide-folding`.

**Spec:** `docs/superpowers/specs/2026-07-09-json-pane-ide-design.md` §3.

## Global Constraints

- Folds exist ONLY on a clean buffer; entering dirty (or any edit intent) expands all first. Apply always reads full text.
- Programmatic `.value` swaps clearing native undo is pre-existing (regenerate does it); folds are reading-mode, nothing to undo.
- Sentinel is ` ⋯ ` (space U+22EF space). Placeholder keeps the real opener, closer, and trailing comma — only interior lines elide, so JSON stays bracket-balanced and the tolerant scanners (completions, signature, assists) keep working on folded text.
- Chevron buttons live OUTSIDE the `aria-hidden` gutter (a11y: interactive content must be exposed) with `aria-label`/`aria-expanded`; keyboard parity via Ctrl+Shift+[ and Ctrl+Shift+].
- Geometry: `GUTTER_W` 38 → **52** (number gutter stays 38px; fold column occupies 38–52px); CSS twins: `#wb-json-text, .wb-json-hl` padding-left 46 → **60**, `.wb-json-scopebar` left 38 → **52**.

---

### Task 1: `jsonFold.ts` — cuts, bimap, placeholders (pure)

**Files:** Create `src/editor/jsonFold.ts`; test `src/editor/jsonFold.test.ts`.

**Produces (later tasks rely on these exact names):**

```ts
export const FOLD_SENTINEL = ' ⋯ ';
export interface FoldCut { start: number; end: number }          // full-text, sorted, non-overlapping
export interface FoldView {
  text: string;                                                   // folded display text
  cuts: FoldCut[];
  toFull(folded: number): number;                                 // sentinel interior → cut start
  toFolded(full: number): number;                                 // inside a cut → clamp to its folded start
  cutIndexAtFolded(folded: number): number;                       // -1 when not inside a sentinel
}
export function cutForRange(text: string, range: { start: number; end: number }): FoldCut | null;
export function outermost(cuts: FoldCut[]): FoldCut[];
export function buildFoldView(fullText: string, cuts: FoldCut[]): FoldView;
export function fullLineOfFoldedLine(view: FoldView, fullText: string, foldedLine: number): number;
```

Semantics to pin with tests:

- `cutForRange`: range covers a node incl. its brackets. Let `openLine` = line of `range.start`, `closeLine` = line of `range.end - 1`. Null when `closeLine <= openLine` (single-line node). Cut = `[end of openLine (the \n offset), first non-ws offset of closeLine)`. Folded rendering therefore reads `"style": { ⋯ }` with any trailing `,` intact.
- `outermost`: sort by start; drop any cut contained in a previous one (nested folds subsume).
- `buildFoldView`: text = splice each cut → sentinel. Bimap is piecewise-linear over sorted cuts; `toFolded(full)` for offsets inside a cut returns the folded offset of the cut start; `toFull(folded)` inside a sentinel returns the cut start. Round-trip law: for any full offset OUTSIDE all cuts, `toFull(toFolded(o)) === o`.
- `fullLineOfFoldedLine`: line number (0-based) in the FULL text of the first char of the given folded line — powers gapped gutter numbers.
- Property test: for random cut sets over a fixture, `view.text.length === fullText.length - Σ(cutLen) + cuts.length * FOLD_SENTINEL.length` and monotonicity of both maps.

TDD steps as usual: failing test → implement → pass → commit `feat: fold cuts + folded↔full offset bimap (pure)`.

### Task 2: panel fold state + full-coordinate translation

**Files:** Modify `src/editor/jsonPanel.ts`; extend `src/editor/jsonPanel.sync.test.ts` only if a sync contract needs the view (prefer Task 4's new DOM file).

Wiring contract (each bullet is an explicit edit):

1. **State**: `let foldedPaths = new Set<string>()` (key = `path.join('/')`), `let foldView: FoldView | null = null`, `let activeFolds: Array<{ key: string; cut: FoldCut }> = []`.
2. **`applyFolds()`**: from `mapRanges`, resolve each foldedPath via `rangeForPath` → `cutForRange` (drop nulls/unresolvable keys), `outermost`, `buildFoldView(fullText, cuts)`; swap `textEl.value` to `view.text` preserving caret through the maps and scroll as-is; set `foldView`. When the set is empty → plain full text, `foldView = null`. Called at the end of `regenerate()` (which now keeps the FULL text in a `fullText` variable) and after every fold/unfold toggle.
3. **`expandAllFolds()`**: if no view → noop; remap selection via `toFull`, `textEl.value = fullText`, restore selection/scroll, `foldView = null`, `ide.repaint()`. Does NOT clear `foldedPaths` — they re-apply on the next clean regenerate.
4. **Full-coordinate translation** (the `view accessor` rule): `syncSelectionFromCaret` maps the caret `toFull` before `pathAtOffset`; `revealSelection` maps the range `toFolded` before line math; `selectionRange` dep (scope bar) likewise; **Apply** parses `fullText` when a view is active, else `textEl.value`.
5. **Edit guards**: `textEl.addEventListener('beforeinput', guard)` registered BEFORE `mountJsonIde` — when `foldView` is active: `preventDefault()`, `expandAllFolds()`, then re-apply via `execCommand('insertText')` for inputTypes `insertText`/`insertLineBreak`/`insertParagraph` (data or '\n') and `insertFromPaste`/`insertFromDrop` (dataTransfer text), and `execCommand('delete')`-equivalent for `deleteContentBackward/Forward` (fallback: manual splice + setDirty path). Other types just expand. `compositionstart` → `expandAllFolds()` preemptively.
6. **Caret-unfold**: in the existing `click` listener path, before `syncSelectionFromCaret`: if `foldView` and `cutIndexAtFolded(caret) >= 0` → remove that fold's key, `applyFolds()`, place caret at the cut start (folded coords of the new view).
7. **Commands**: keydown on textEl — Ctrl+Shift+`[` folds the node at the caret (`pathAtOffset(mapRanges, toFull(caret))`, add key, applyFolds); Ctrl+Shift+`]` unfolds the innermost fold containing the caret. Kebab gains `<button id="wb-json-fold-others">Fold others</button>` (fold every top-level `children` sibling subtree whose path is neither an ancestor nor descendant of `state.selection`; no selection → fold all foldable root children) and `<button id="wb-json-expand-all">Expand all</button>` (clear set + applyFolds).
8. **Dirty interplay**: `setDirty()` also calls `expandAllFolds()` as a defensive last line (the guards should have run already); chevrons hide while dirty (Task 3 consults a `foldsUsable()` = `!dirty`).
9. **ide deps**: pass the `folds` bridge object (Task 3's interface) into `mountJsonIde`.

### Task 3: jsonIde chevron column + gapped numbers + guards

**Files:** Modify `src/editor/jsonIde.ts`, `src/style.css`.

- `JsonIdeDeps` gains optional:

```ts
folds?: {
  usable(): boolean;                       // clean buffer, view machinery ready
  active(): boolean;                       // at least one cut applied
  expandAll(): void;
  foldableFoldedLines(): Array<{ line: number; folded: boolean; label: string }>;
  toggleAtFoldedLine(line: number): void;
  fullLineNumber(foldedLine: number): number; // 0-based → render +1
}
```

- **Gutter numbers**: `refreshGutter` renders `deps.folds ? deps.folds.fullLineNumber(i) + 1 : i + 1` — gaps appear across folds. Cache key must include a folds revision: simplest is to drop the `lastLineCount/lastActiveLine` short-circuit when `deps.folds?.active()`.
- **Fold column**: new absolutely-positioned `div.wb-json-foldcol` (NOT aria-hidden) between gutter and text, `left:38px; width:14px; z-index:4`, populated on repaint from `foldableFoldedLines()`: per entry a `<button class="wb-json-chev" aria-expanded={!folded} aria-label="{folded?'Unfold':'Fold'} {label}">{folded ? '▸' : '▾'}</button>` positioned at `line * lineHeight - scrollTop + padTop`. Click → `toggleAtFoldedLine(line)`. Scroll sync translates the column like the gutter. Hidden entirely when `!usable()`.
- **Assist/paste guards**: at the top of the assist block and the paste handler — `if (deps.folds?.active()) { deps.folds.expandAll(); }` then proceed against the now-full buffer (recompute selection from the textarea, which expandAll already remapped).
- **CSS**: `GUTTER_W = 52`; `#wb-json-text, .wb-json-hl { padding: 8px 8px 8px 60px; }`; `.wb-json-scopebar { left: 52px; }`; new `.wb-json-foldcol` + `.wb-json-chev` (11px, transparent bg, `cursor:pointer`, visible focus ring per house a11y).

### Task 4: DOM tests, gate, PR, monitor

**Files:** Create `src/editor/jsonFold.dom.test.ts` (mountJsonPanel harness, same teardown as jsonFormat.dom.test.ts).

Pinned contracts (each an `it`):
1. Toggling a fold shows the sentinel one-liner and gapped line numbers; Apply still parses the FULL text (doc unchanged by folding, and applying while folded imports the full content).
2. Caret click inside the sentinel unfolds just that region.
3. `beforeinput insertText` while folded expands everything and the typed char lands at the remapped caret (fallback splice path in jsdom) — and the buffer is dirty afterwards.
4. A selection visually spanning a folded placeholder deletes the hidden interior too (WYSIWYG — dispatch `beforeinput` `deleteContentBackward` with a spanning selection).
5. Canvas-driven regenerate (a `state.mutateDocument` style/name change) re-applies surviving folds; a fold whose path vanished is dropped.
6. Fold others: with an element selected, sibling subtrees fold, the selection's ancestor chain stays open. Expand all clears.
7. Sub-token highlighting still paints on folded text (sentinel line renders; lossless flatten of the FOLDED text holds).

Then: full `npm run build && npm test`, push `claude/json-ide-folding`, `gh pr create` (spec §3, what/why, test counts, worktree note), persistent Monitor on the new PR, auto-fix loop. Never merge.
