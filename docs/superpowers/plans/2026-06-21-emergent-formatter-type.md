# Emergent Formatter Type (Stage 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the upfront "Type" dropdown from the topbar. The formatter type is now *shown*, not *chosen*: a read-only **destination chip** in the topbar derives where the current formatter saves (a column vs. the view) from what's actually being edited. The dropdown's kind-*switching* role (blank tile, manual wrapper switch, explicit grid) relocates into the Studio as an "Advanced: formatter type" control — nothing is stranded.

**Architecture:** Additive, low-risk. A new pure, unit-tested helper `formatterDestination()` produces the chip's text from `(kind, columnField)`. The existing `#wb-kind` `<select>` element and its change handler are **moved** from the topbar into the Studio side pane unchanged (same id, same handler, same `setKind` behavior) — so no kind-creation path is lost; it just lives behind the Studio door (hidden in maker view by Stage 1). The topbar gains the chip. Tile's *proper* home (a view-layout choice) is deferred to Stage 3.

**Tech Stack:** Vanilla TypeScript + Vite, zero runtime dependencies. Vitest (unit, colocated `*.test.ts`). Playwright (`e2e/*.spec.ts`).

## Global Constraints

- Vanilla TypeScript + Vite, **zero runtime dependencies**.
- localStorage keys and the `wb-` CSS prefix are **frozen** — only ADD. New CSS classes `wb-dest-chip`, `wb-side-adv` are additive. The `#wb-kind` DOM id is REUSED (relocated, not renamed) so the existing change handler keeps working.
- One user gesture = one undoable document mutation. The chip is read-only and must NOT mutate anything. `setKind()` already pushes exactly one snapshot — do not change that.
- Click-only safety: a misclick must never corrupt a formatter.
- Do NOT change `setKind()` semantics (it preserves the element tree, only swaps wrapper metadata — `src/editor/state.ts:566`).
- `npm run build` and `npm test` must pass; run `npm run test:ui` (Playwright) when a browser is available. Open a PR (base = `redesign/stage1-maker-shell`, the Stage 1 branch this stacks on); never merge or push to `main`.

**Reference (current line numbers, post Stage-1+main merge):** Type dropdown markup `src/main.ts:40-47`; kind change handler + `kindSel.value` sync `src/main.ts:460-471`; `kindSel.disabled` gate `src/main.ts:489`; example loader `src/main.ts:516-527`; side pane markup `#wb-pane-side` `src/main.ts:127-137`. Match on the quoted text, not raw line numbers — they may shift.

---

### Task 1: `formatterDestination` pure helper

**Files:**
- Create: `src/editor/formatterDestination.ts`
- Test: `src/editor/formatterDestination.test.ts`

**Interfaces:**
- Produces: `formatterDestination(kind: DocumentKind, columnField: string | null): { label: string; title: string }`. `DocumentKind` is imported from `../core/types`. `label` is the short chip text; `title` is the hover tooltip explaining the destination (and, for view formatters, the clobber warning).

- [ ] **Step 1: Write the failing test**

```ts
// src/editor/formatterDestination.test.ts
import { describe, it, expect } from 'vitest';
import { formatterDestination } from './formatterDestination';

describe('formatterDestination', () => {
  it('a column formatter with a known field names the column', () => {
    const d = formatterDestination('column', '[$Status]');
    expect(d.label).toBe('Saves to the [$Status] column');
    expect(d.title).toMatch(/column's CustomFormatter/);
  });
  it('a column formatter with no known field is generic', () => {
    expect(formatterDestination('column', null).label).toBe('Saves to a column');
  });
  it('grid saves to the view', () => {
    const d = formatterDestination('grid', null);
    expect(d.label).toBe('Saves to the view');
    expect(d.title).toMatch(/replac/i); // warns it replaces the view's formatting
  });
  it('row saves to the view', () => {
    expect(formatterDestination('row', null).label).toBe('Saves to the view');
  });
  it('tile names the tile layout', () => {
    expect(formatterDestination('tile', null).label).toBe('Saves to the view (tile layout)');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/editor/formatterDestination.test.ts`
Expected: FAIL — cannot find module `./formatterDestination`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/editor/formatterDestination.ts
import type { DocumentKind } from '../core/types';

/**
 * Where the formatter currently being edited will be saved — derived from its
 * kind, not chosen up front. `columnField` is the field internal-name (e.g.
 * "[$Status]") when a column formatter's target is known, else null.
 */
export function formatterDestination(
  kind: DocumentKind,
  columnField: string | null,
): { label: string; title: string } {
  if (kind === 'column') {
    return {
      label: columnField ? `Saves to the ${columnField} column` : 'Saves to a column',
      title: "This is a column formatter — it paints every row of one column and saves to that column's CustomFormatter.",
    };
  }
  const viewTitle =
    "This is a view formatter — it lays out the whole row and saves to the view's CustomFormatter, replacing any formatting the view already has.";
  if (kind === 'tile') {
    return { label: 'Saves to the view (tile layout)', title: viewTitle };
  }
  // 'row' and 'grid' both export as a view formatter
  return { label: 'Saves to the view', title: viewTitle };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/editor/formatterDestination.test.ts`
Expected: PASS (5 passing).

- [ ] **Step 5: Verify build + unit suite**

Run: `npm run build && npm test`
Expected: build clean; full unit suite passes (existing count + 5).

- [ ] **Step 6: Commit**

```bash
git add src/editor/formatterDestination.ts src/editor/formatterDestination.test.ts
git commit -m "feat(type): pure formatterDestination helper for the emergent destination chip"
```

---

### Task 2: Replace the topbar dropdown with the chip; relocate kind control to Studio

**Files:**
- Modify: `src/main.ts` — remove the Type `<label>` (markup ~`40-47`); add the chip to the topbar; add the relocated `#wb-kind` select into the side pane (`#wb-pane-side` ~`127-137`); add `updateDestChip()` and wire it into the existing subscribe(s)
- Modify: `src/style.css` — add `.wb-dest-chip` and `.wb-side-adv` rules

**Interfaces:**
- Consumes: `formatterDestination` from Task 1.
- Produces: a `#wb-dest-chip` element in the topbar; the `#wb-kind` select now lives inside `#wb-pane-side`.

- [ ] **Step 1: Import the helper**

In `src/main.ts`, add to the editor imports:

```ts
import { formatterDestination } from './editor/formatterDestination';
```

- [ ] **Step 2: Remove the Type dropdown from the topbar**

Delete the entire topbar `<label>` block that contains `Type` and `<select id="wb-kind">` (the block with options `grid`/`column`/`row`/`tile`, currently `src/main.ts:40-47`). In its place put the chip:

```html
      <span id="wb-dest-chip" class="wb-dest-chip" title=""></span>
```

- [ ] **Step 3: Relocate the kind select into the Studio side pane**

In the `#wb-pane-side` markup (currently `src/main.ts:127-137`), immediately AFTER the `<nav class="wb-tabs">…</nav>` block and BEFORE `<div id="wb-tab-inspector" …>`, insert the relocated control (same `#wb-kind` id and same options as the deleted dropdown):

```html
      <div class="wb-side-adv" title="Advanced: change the wrapper this formatter compiles to. Normally the type follows what you build; use this to start a tile/gallery layout or switch the wrapper without rebuilding.">
        <span>Formatter type</span>
        <select id="wb-kind">
          <option value="grid">Grid — view columns</option>
          <option value="column">Column formatter</option>
          <option value="row">View (row) formatter</option>
          <option value="tile">Tile / Gallery</option>
        </select>
      </div>
```

- [ ] **Step 4: Add `updateDestChip` and wire it into the existing subscribe**

The existing kind handler and subscribe block (currently `src/main.ts:460-471`) selects `#wb-kind` into `kindSel` and, on `'load'`/`'kind'`, runs `kindSel.value = state.doc.kind`. Keep the handler and the `kindSel.value` sync (the Studio select must still reflect the current kind). Add a chip updater next to it:

```ts
const destChip = document.getElementById('wb-dest-chip')!;
const updateDestChip = () => {
  // a registered column formatter is keyed by its field name; the main doc's
  // field (if it is a column kind) is not separately tracked, so pass null there.
  const columnField = state.activeDocKey !== 'main' ? state.activeDocKey : null;
  const d = formatterDestination(state.doc.kind, columnField);
  destChip.textContent = `→ ${d.label}`;
  destChip.title = d.title;
};
updateDestChip();
```

Then, in EVERY `state.subscribe(...)` callback that already runs on `'load'`/`'kind'` and the one that rebuilds the active-doc label (currently `src/main.ts:475-488`, which reacts to active-doc changes), add a call to `updateDestChip()`. The chip must refresh whenever kind changes, a document loads, or the active document switches (column ⇄ main).

- [ ] **Step 5: Style the chip and the advanced row**

Append to `src/style.css` (near the topbar control rules, after the `.wb-topbar-controls button` block ~line 73):

```css
/* emergent destination chip — read-only; replaces the old Type dropdown */
.wb-dest-chip {
  font-size: 12px; color: var(--wb-text-2);
  border: 1px solid var(--wb-border); border-radius: 11px;
  padding: 3px 10px; white-space: nowrap; cursor: help;
}
/* Studio: the relocated "Advanced: formatter type" control */
.wb-side-adv {
  display: flex; align-items: center; gap: 6px; margin-bottom: 8px;
  font-size: 11px; color: var(--wb-text-2);
}
.wb-side-adv select {
  flex: 1 1 auto; font-size: 12px; padding: 3px 6px;
  border: 1px solid var(--wb-border); border-radius: 3px;
  background: var(--wb-bg); color: var(--wb-text);
}
```

- [ ] **Step 6: Verify build + unit suite**

Run: `npm run build && npm test`
Expected: build clean; unit suite passes (count unchanged from Task 1 — no new unit tests here).

- [ ] **Step 7: Manual sanity reasoning**

Confirm by reading the wired code: default doc (kind `grid`) → chip reads "→ Saves to the view"; the `#wb-kind` select is inside `#wb-pane-side` (so hidden in maker view, visible in Studio); the kind change handler still fires `setKind` and the chip + select both refresh on `'kind'`.

- [ ] **Step 8: Commit**

```bash
git add src/main.ts src/style.css
git commit -m "feat(type): emergent destination chip in topbar; relocate kind control to Studio"
```

---

### Task 3: e2e contracts for the emergent type

**Files:**
- Modify: `e2e/maker.spec.ts` (add chip + relocation assertions)
- Modify: any spec that drives `#wb-kind` (find via grep in Step 1)

**Interfaces:**
- Consumes: `#wb-dest-chip` (topbar), `#wb-kind` now inside `.wb-pane-side`, the `openStudio(page)` helper added in Stage 1.

- [ ] **Step 1: Find every spec that drives the kind select**

Run: `rg -n "#wb-kind|wb-kind" e2e`
Expected: a list of specs that `selectOption('#wb-kind', …)` or assert on it. The select is now in the Studio side pane (hidden by default), so each such test must call `openStudio(page)` before touching `#wb-kind`.

- [ ] **Step 2: Add the emergent-type assertions to maker.spec.ts**

Append these tests to `e2e/maker.spec.ts` (it already has the `beforeEach` that goes to `/`, clears localStorage, reloads):

```ts
test('topbar shows the emergent destination chip, not a Type dropdown', async ({ page }) => {
  // the old upfront Type dropdown is gone from the topbar
  await expect(page.locator('.wb-topbar #wb-kind')).toHaveCount(0);
  // default doc is a grid → saves to the view
  await expect(page.locator('#wb-dest-chip')).toContainText('Saves to the view');
});

test('the kind control lives in the Studio, and loading a column example updates the chip', async ({ page }) => {
  // the kind select moved into the side pane (revealed only in Studio)
  await openStudio(page);
  await expect(page.locator('.wb-pane-side #wb-kind')).toBeVisible();
  // a column-kind example flips the chip to a column destination
  await page.selectOption('#wb-example', 'status-pill');
  await expect(page.locator('#wb-dest-chip')).toContainText('Saves to a column');
});
```

(`e2e/maker.spec.ts` already defines `openStudio`; do not redefine it.)

- [ ] **Step 3: Gate any other #wb-kind-driving spec with openStudio**

For each spec from Step 1 (other than maker.spec.ts), add `await openStudio(page);` before the first `#wb-kind` interaction. If that spec lacks an `openStudio` helper, add the same 3-line helper used in the Stage 1 specs:

```ts
async function openStudio(page: import('@playwright/test').Page): Promise<void> {
  await page.click('#wb-studio-toggle');
}
```

- [ ] **Step 4: Run the full e2e suite**

Run: `npm run test:ui`
Expected: all specs pass, including the two new maker tests.

- [ ] **Step 5: Commit**

```bash
git add e2e/maker.spec.ts
git commit -m "test(e2e): emergent destination chip + kind control relocated to Studio"
```

(Include any other spec files you modified in the `git add`.)

---

### Task 4: Verify, document, and hand off for PR

**Files:**
- Modify: `docs/HANDOFF.md`

- [ ] **Step 1: Full verification**

Run: `npm run build && npm test && npm run test:ui`
Expected: all green. Record unit + e2e counts.

- [ ] **Step 2: Document the change**

In `docs/HANDOFF.md`, near the shell/maker section added in Stage 1, add one line: the topbar no longer has a "Type" dropdown — the formatter type is shown by a read-only **destination chip** (`#wb-dest-chip`, derived via `formatterDestination()`); the kind-switching `#wb-kind` select moved into the Studio side pane as "Advanced: formatter type" (`setKind` semantics unchanged).

- [ ] **Step 3: Commit the doc**

```bash
git add docs/HANDOFF.md
git commit -m "docs: record emergent destination chip and relocated kind control"
```

- [ ] **Step 4: Stop for controller**

Do NOT open the PR. Report DONE; the controller runs the final whole-branch review and opens the PR (base `redesign/stage1-maker-shell`).

---

## Self-Review

- **Spec coverage:** remove topbar Type dropdown (Task 2), emergent destination chip (Tasks 1+2), relocate kind switching to Studio without stranding paths (Task 2 — same `#wb-kind` id + handler, just moved), e2e contracts (Task 3). Covered.
- **Out of scope (correctly deferred):** tile-as-a-view-layout-choice and the grid→row promotion UX (Stage 3); CFR linked-instance UX (Stage 4); deploy clobber guard (Stage 5). The chip's `title` already names the view-clobber risk as teaching copy; the enforcing guard is Stage 5.
- **Placeholder scan:** none — all steps carry real code/commands.
- **Type consistency:** `formatterDestination(kind, columnField)` signature identical across Tasks 1–2. `#wb-dest-chip`, `#wb-kind`, `wb-side-adv` consistent between Task 2 (created) and Task 3 (asserted).
- **Frozen-key check:** no localStorage key touched; `wb-dest-chip`/`wb-side-adv` are new `wb-` classes; `#wb-kind` reused, not renamed.
- **Stranding check:** every kind-creation path from the machinery map (examples, JSON apply, import, column drilling, reset) is untouched; the manual switch survives in the Studio. Confirmed nothing lost.
