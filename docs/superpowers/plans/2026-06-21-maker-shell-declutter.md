# Maker Shell Declutter (Stage 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the default landing a grid-first "maker" surface — the list grid full-bleed with the fx bar, header menus, and data dock — folding the Palette, Structure, and Properties/JSON panes behind a single "Studio" toggle, and replacing the theme button's ambiguous icon with destination-semantic glasses/sun glyphs.

**Architecture:** Pure additive change to the existing shell in `src/main.ts` + `src/style.css`. No panes are deleted (that is Stage 5); they are hidden by a new `wb-maker` layout class driven by one new persisted pref (`studioOpen`, default `false`). The theme-toggle icon/label mapping is extracted to a tiny pure module so it is unit-testable. Existing e2e specs that touch studio-only UI (palette, tree, JSON tab) are updated to open the studio first — they are contracts, so they change before the behavior does.

**Tech Stack:** Vanilla TypeScript + Vite, zero runtime dependencies. Vitest (unit, colocated `*.test.ts`). Playwright (`e2e/*.spec.ts`).

## Global Constraints

- Vanilla TypeScript + Vite, **zero runtime dependencies** — keep it that way.
- localStorage keys and the `wb-` CSS prefix are **frozen** — only ADD keys/classes, never rename. New pref key `studioOpen` is additive to the existing `wb-ui-prefs` object.
- One user gesture = one undoable document mutation (N/A here — these are UI prefs, not document mutations, and must NOT push undo entries).
- Click-only safety: a misclick must never corrupt a formatter (N/A to document; just don't wire these toggles to document state).
- Chrome icons should use the Fluent icon font (`ms-Icon--*`), not emoji. Confirmed-available glyphs: `Glasses`, `Sunny`, `ClearNight`, `DeveloperTools`.
- `npm run build` and `npm test` must pass; run `npm run test:ui` (Playwright) when a browser is available. Open a PR to `main` when green; never merge or push to `main`.

---

### Task 1: Destination-semantic theme toggle icon

**Files:**
- Create: `src/editor/themeToggle.ts`
- Test: `src/editor/themeToggle.test.ts`
- Modify: `src/main.ts:65` (topbar button markup), `src/main.ts:427-433` (`applyAppTheme` label/icon wiring)

**Interfaces:**
- Produces: `themeToggleView(mode: 'light' | 'dark'): { icon: string; label: string }` — `icon` is a Fluent glyph name (no `ms-Icon--` prefix), `label` is the action text. Mapping uses **destination semantics**: the button shows the mode it will switch *to*. In `light` mode it offers dark (`ClearNight`, "Switch to dark mode"); in `dark` mode it offers light (`Sunny`, "Switch to light mode").

- [ ] **Step 1: Write the failing test**

```ts
// src/editor/themeToggle.test.ts
import { describe, it, expect } from 'vitest';
import { themeToggleView } from './themeToggle';

describe('themeToggleView', () => {
  it('in light mode, offers the dark destination', () => {
    expect(themeToggleView('light')).toEqual({ icon: 'ClearNight', label: 'Switch to dark mode' });
  });
  it('in dark mode, offers the light destination', () => {
    expect(themeToggleView('dark')).toEqual({ icon: 'Sunny', label: 'Switch to light mode' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/editor/themeToggle.test.ts`
Expected: FAIL — cannot find module `./themeToggle`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/editor/themeToggle.ts
/** The theme button shows the mode it will switch TO (destination semantics). */
export function themeToggleView(mode: 'light' | 'dark'): { icon: string; label: string } {
  return mode === 'light'
    ? { icon: 'ClearNight', label: 'Switch to dark mode' }
    : { icon: 'Sunny', label: 'Switch to light mode' };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/editor/themeToggle.test.ts`
Expected: PASS (2 passing).

- [ ] **Step 5: Wire the helper into the shell**

In `src/main.ts`, add to the existing editor imports near the top:

```ts
import { themeToggleView } from './editor/themeToggle';
```

Change the topbar theme button markup (currently `src/main.ts:65`) so its icon has an id and the label has the existing id:

```html
          <button id="wb-theme" title="Toggle light/dark theme emulation"><i class="ms-Icon" id="wb-theme-icon"></i> <span id="wb-theme-label"></span></button>
```

Replace the label line inside `applyAppTheme` (currently `src/main.ts:431-432`) with:

```ts
  const tv = themeToggleView(state.themeMode);
  document.getElementById('wb-theme-icon')!.className = `ms-Icon ms-Icon--${tv.icon}`;
  document.getElementById('wb-theme-label')!.textContent = tv.label;
```

- [ ] **Step 6: Verify build + unit suite**

Run: `npm run build && npm test`
Expected: build succeeds; full unit suite passes (existing count + 2 new).

- [ ] **Step 7: Commit**

```bash
git add src/editor/themeToggle.ts src/editor/themeToggle.test.ts src/main.ts
git commit -m "feat(shell): destination-semantic theme toggle icon (sun/night)"
```

---

### Task 2: The single "Studio" toggle — grid-first by default

**Files:**
- Modify: `src/main.ts` — `UiPrefs` interface (`src/main.ts:144-158`), defaults (`src/main.ts:159-171`), topbar markup (`src/main.ts:35-73`), `applyLayout` (`src/main.ts:177-198`)
- Modify: `src/style.css` — add a `.wb-layout.wb-maker` rule block

**Interfaces:**
- Consumes: `themeToggleView` is unrelated; this task adds `uiPrefs.studioOpen: boolean`.
- Produces: a `#wb-studio-toggle` button and a `wb-maker` class on `#wb-layout` (present when `studioOpen` is `false`).

- [ ] **Step 1: Add the pref field and default**

In the `UiPrefs` interface (`src/main.ts:144-158`), add:

```ts
  /** When false (default), the studio panes are hidden — grid-first maker view. */
  studioOpen: boolean;
```

In the `uiPrefs` defaults object (`src/main.ts:159-171`), add before the spread of stored prefs:

```ts
  studioOpen: false,
```

- [ ] **Step 2: Add the topbar toggle button**

In the topbar controls, immediately before the `<div class="wb-menu" id="wb-menu">` line (`src/main.ts:60`), insert:

```html
      <button id="wb-studio-toggle" title="Show the studio: Palette, Structure, and the Properties/JSON pane"><i class="ms-Icon ms-Icon--DeveloperTools"></i> Studio</button>
```

- [ ] **Step 3: Teach `applyLayout` about maker view**

In `applyLayout` (`src/main.ts:177-198`), replace the single `layout.style.gridTemplateColumns = ...` line (`src/main.ts:186`) with:

```ts
  layout.classList.toggle('wb-maker', !uiPrefs.studioOpen);
  document.getElementById('wb-studio-toggle')!.classList.toggle('active', uiPrefs.studioOpen);
  layout.style.gridTemplateColumns = uiPrefs.studioOpen
    ? `${p}px 5px ${tree}px 5px 1fr 5px ${side}px`
    : '1fr';
```

- [ ] **Step 4: Wire the toggle click (no undo entry)**

After the palette-toggle click handler (`src/main.ts:234-238`), add:

```ts
document.getElementById('wb-studio-toggle')!.addEventListener('click', () => {
  uiPrefs.studioOpen = !uiPrefs.studioOpen;
  applyLayout();
  saveUiPrefs();
});
```

- [ ] **Step 5: Add the CSS to hide studio panes in maker view**

Append to `src/style.css` (after the `.wb-layout` block near line 105):

```css
/* maker view: grid full-bleed, studio panes (palette/structure/side) + their resizers hidden */
.wb-layout.wb-maker > .wb-pane-palette,
.wb-layout.wb-maker > .wb-pane-tree,
.wb-layout.wb-maker > .wb-pane-side,
.wb-layout.wb-maker > .wb-resizer { display: none; }
.wb-topbar-controls #wb-studio-toggle.active { border-color: var(--wb-accent); color: var(--wb-accent); }
```

- [ ] **Step 6: Verify build + unit suite**

Run: `npm run build && npm test`
Expected: build succeeds; unit suite passes (no unit tests cover the shell, so count is unchanged from Task 1).

- [ ] **Step 7: Commit**

```bash
git add src/main.ts src/style.css
git commit -m "feat(shell): grid-first maker view with a single Studio toggle"
```

---

### Task 3: Update e2e contracts + add the maker-landing spec

**Files:**
- Create: `e2e/maker.spec.ts`
- Modify: existing specs that assume studio-open default — at minimum `e2e/sandbox.spec.ts` and `e2e/workspace.spec.ts` (find all via grep in Step 1)

**Interfaces:**
- Consumes: `#wb-studio-toggle` (Task 2), the `wb-maker` class, and existing selectors `.wb-grid`, `.wb-pane-palette`, `.wb-doc-header`, `.wb-palette-item`, `.wb-tabs button[data-tab]`.

- [ ] **Step 1: Find every studio-dependent assertion**

Run: `npx playwright test --list` then grep the specs:
`rg -l "wb-doc-header|wb-palette-item|data-tab=|wb-tree-row|wb-pane-side|wb-pane-tree" e2e`
Expected: a list of spec files (includes `sandbox.spec.ts`, `workspace.spec.ts`). These touch studio-only UI and will fail under the new default.

- [ ] **Step 2: Write the failing maker-landing spec**

```ts
// e2e/maker.spec.ts
import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
});

test('first load is grid-first: studio panes hidden, grid full-bleed', async ({ page }) => {
  await expect(page.locator('#wb-layout')).toHaveClass(/wb-maker/);
  await expect(page.locator('.wb-grid')).toBeVisible();
  await expect(page.locator('.wb-pane-palette')).toBeHidden();
  await expect(page.locator('.wb-pane-tree')).toBeHidden();
  await expect(page.locator('.wb-pane-side')).toBeHidden();
  await expect(page.locator('#wb-studio-toggle')).toBeVisible();
});

test('Studio toggle reveals the panes and persists', async ({ page }) => {
  await page.click('#wb-studio-toggle');
  await expect(page.locator('.wb-pane-palette')).toBeVisible();
  await expect(page.locator('.wb-pane-side')).toBeVisible();
  await expect(page.locator('#wb-layout')).not.toHaveClass(/wb-maker/);
  await page.reload();
  await expect(page.locator('.wb-pane-palette')).toBeVisible();
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npx playwright test e2e/maker.spec.ts`
Expected: FAIL if Task 2 is not yet merged in the working tree; PASS if it is. (When running the plan in order, Task 2 is already in the tree, so this should PASS — if it does, that confirms the contract. The "failing" check is satisfied by temporarily commenting the `applyLayout` change; skip that if confident.)

- [ ] **Step 4: Repair studio-dependent specs**

In each spec found in Step 1, add this helper near the top and call it in the relevant `beforeEach` or at the start of each studio-touching test, immediately after the `page.reload()`:

```ts
async function openStudio(page) {
  await page.click('#wb-studio-toggle');
}
```

For `e2e/sandbox.spec.ts`: the test "first load shows the grid-first workspace…" asserts `.wb-doc-header` (Structure pane) — add `await openStudio(page);` after the grid assertions and before the `.wb-doc-header` assertions. The tests "palette click inserts an element…" and any `openTab(page, ...)` test need `await openStudio(page);` as their first line.

For `e2e/workspace.spec.ts` and any other file from Step 1: prepend `await openStudio(page);` to each test that locates `.wb-doc-header`, `.wb-tree-row`, `.wb-palette-item`, or a `[data-tab]` tab.

- [ ] **Step 5: Run the full e2e suite**

Run: `npm run test:ui`
Expected: all specs pass, including the new `maker.spec.ts`.

- [ ] **Step 6: Commit**

```bash
git add e2e/maker.spec.ts e2e/sandbox.spec.ts e2e/workspace.spec.ts
git commit -m "test(e2e): grid-first landing contract; open studio in studio-dependent specs"
```

---

### Task 4: Verify, document, and open the PR

**Files:**
- Modify: `docs/HANDOFF.md` (note the maker/studio default in the shell section)

- [ ] **Step 1: Full verification**

Run: `npm run build && npm test && npm run test:ui`
Expected: all three green. Record the unit and e2e test counts for the PR body.

- [ ] **Step 2: Document the new default**

In `docs/HANDOFF.md`, find the shell/"Basic/advanced mode" section and add one line: the unified surface now defaults to a grid-first **maker view**; the Palette, Structure, and Properties/JSON panes are hidden behind the topbar **Studio** toggle (pref `studioOpen`, default `false`; panes are not removed).

- [ ] **Step 3: Commit the doc**

```bash
git add docs/HANDOFF.md
git commit -m "docs: record grid-first maker default and Studio toggle"
```

- [ ] **Step 4: Open the PR to main**

Create a branch if not already on one, push, and open a PR (do not merge). PR body: what changed (grid-first maker default, single Studio toggle, destination-semantic theme icon), why (declutter — one collapse control instead of five idioms; restore the maker thesis), and the recorded test counts.

---

## Self-Review

- **Spec coverage:** Stage 1 roadmap items — grid-first landing (Task 2), theme icon (Task 1), fold panes behind one door (Task 2), unify collapse controls (Task 2 hides the per-pane peek/rail/min/max in maker view by hiding the panes entirely; full removal of those controls is deferred to Stage 5 deletion). Covered.
- **Out of scope (correctly deferred):** deleting palette/structure/inspector (Stage 5), emergent type / Type-dropdown removal (Stage 2), areas editor (Stage 3), CFR linked-instance UX (Stage 4), deploy clobber guard (Stage 5).
- **Placeholder scan:** none — all steps carry real code/commands.
- **Type consistency:** `themeToggleView` signature and `studioOpen` field used identically across tasks. `wb-maker` class name consistent between Task 2 (set) and Task 3 (asserted).
- **Frozen-key check:** `studioOpen` is added to the existing `wb-ui-prefs` object (additive); no rename. `wb-maker`, `wb-studio-toggle` are new `wb-`-prefixed names (additive).
