# Column-Style Legibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the shared-vs-local ownership model legible everywhere: one reserved violet accent for everything owned by a **column style** (a registered column formatter / CFR), a scope chip that always names what an edit will hit, drill-in editing with a banner, an opaque tree stub, and an Office-"style" copy pass.

**Architecture:** A new pure module `src/editor/styleScope.ts` (sibling of `cfr.ts` — node-tested, no DOM) derives scope/banner labels from state-shaped inputs. Everything else is presentation wiring in the existing modules: `gridView.ts` (rails, name-tag, § header mark, double-click drill), `fxBar.ts` (scope chip), `canvas.ts` (drilled banner/frame/dim/Esc), `treeView.ts` (opaque stub, section restyle), plus violet tokens in `style.css`. No serialization, no `cfr.ts` semantics, no schema changes.

**Tech Stack:** Vanilla TypeScript + Vite, zero runtime deps. Unit tests: vitest (`npx vitest run <file>`). E2E: Playwright (`npx playwright test <file>`).

**Spec:** `docs/superpowers/specs/2026-07-02-column-style-legibility-design.md` — read it first.

## Global Constraints

- Branch: `claude/column-style-legibility`. Never push to `main`.
- Zero runtime dependencies; pure modules stay DOM-free.
- One user gesture = one undoable document mutation. Drill-in/out (openColumnRef/openMain) is navigation — **never** an undo step. Do not change this.
- `wb-` CSS prefix for every new class; frozen localStorage keys and the persisted `'basic'`/`wb-basic` values untouched. All CSS strictly additive.
- The class `wb-cfr-link` on the grid-header link badge is KEPT (e2e + muscle memory) — its glyph/color change, its name does not.
- Vocabulary (user-facing copy only): registered column formatter = "**column style**" / "the {Field} style"; the row-owned wrapper = "**host cell**"; the mark is **§**. Internal identifiers (`columnFormatterReference`, `columnRefs`, `cfr.ts`) unchanged.
- Every task that changes user-visible copy updates the Playwright specs that locate by that copy **in the same commit**.
- WCAG: every new violet foreground/background pair must compute ≥ 4.5:1 in BOTH themes (Task 2 has the check script).

---

### Task 1: Pure scope module + state accessor

**Files:**
- Create: `src/editor/styleScope.ts`
- Create: `src/editor/styleScope.test.ts`
- Modify: `src/editor/state.ts` (one getter, after `openMain()` around line 332)
- Modify: `src/editor/state.test.ts` (one test appended)

**Interfaces:**
- Consumes: `cfrBlastRadius(field, mainRoot, columnRefs)` from `./cfr`; `cfrFieldName(ref)` from `../core/refs`; `SPElement` from `../core/types`.
- Produces (later tasks import these exact names):
  - `type Scope = { kind: 'view' } | { kind: 'host'; field: string } | { kind: 'style'; field: string; places: number }`
  - `scopeFor(activeDocKey: string, selected: SPElement | null, mainRoot: SPElement | undefined, columnRefs: Record<string, SPElement>): Scope`
  - `scopeChipLabel(s: Scope, display: (name: string) => string): string`
  - `styleBannerLabel(field: string, places: number): string` (field is already display-resolved by the caller)
  - `state.mainRootForScope: SPElement | undefined` (getter — main root even while drilled)

- [ ] **Step 1: Write the failing test**

Create `src/editor/styleScope.test.ts` (mirror the import style of `src/editor/cfr.test.ts`):

```ts
/**
 * styleScope.ts — pure scope/label derivation for the "violet = shared"
 * legibility work. Chip + banner copy are contracts (e2e locates by them).
 */
import { describe, it, expect } from 'vitest';
import type { SPElement } from '../core/types';
import { scopeFor, scopeChipLabel, styleBannerLabel } from './styleScope';

const mainRoot: SPElement = {
  elmType: 'div',
  children: [
    { elmType: 'div', txtContent: '[$Title]' },
    { elmType: 'div', columnFormatterReference: '[$Status]' },
  ],
};
const refs: Record<string, SPElement> = { Status: { elmType: 'div', txtContent: '@currentField' } };
const display = (n: string) => (n === 'Status' ? 'Status' : n);

describe('scopeFor', () => {
  it('main doc + plain selection → view scope', () => {
    expect(scopeFor('main', mainRoot.children![0], mainRoot, refs)).toEqual({ kind: 'view' });
  });
  it('main doc + no selection → view scope', () => {
    expect(scopeFor('main', null, mainRoot, refs)).toEqual({ kind: 'view' });
  });
  it('main doc + host cell selected → host scope with the field name', () => {
    expect(scopeFor('main', mainRoot.children![1], mainRoot, refs)).toEqual({ kind: 'host', field: 'Status' });
  });
  it('drilled into a style → style scope with blast count', () => {
    expect(scopeFor('Status', null, mainRoot, refs)).toEqual({ kind: 'style', field: 'Status', places: 1 });
  });
  it('drilled, zero references → places clamps to 1 (the style itself)', () => {
    expect(scopeFor('Owner', null, mainRoot, refs)).toEqual({ kind: 'style', field: 'Owner', places: 1 });
  });
});

describe('scopeChipLabel', () => {
  it('view', () => expect(scopeChipLabel({ kind: 'view' }, display)).toBe('This view only'));
  it('host', () => expect(scopeChipLabel({ kind: 'host', field: 'Status' }, display)).toBe('Host cell · this view only'));
  it('style plural', () => expect(scopeChipLabel({ kind: 'style', field: 'Status', places: 3 }, display)).toBe('Status style · 3 places'));
  it('style singular', () => expect(scopeChipLabel({ kind: 'style', field: 'Status', places: 1 }, display)).toBe('Status style · 1 place'));
});

describe('styleBannerLabel', () => {
  it('plural', () => expect(styleBannerLabel('Status', 3))
    .toBe('Editing the Status style — used in 3 places · changes apply everywhere'));
  it('singular', () => expect(styleBannerLabel('Status', 1))
    .toBe("Editing the Status style — changes apply everywhere it's used"));
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/editor/styleScope.test.ts`
Expected: FAIL — cannot resolve `./styleScope`.

- [ ] **Step 3: Implement `src/editor/styleScope.ts`**

```ts
/**
 * editor/styleScope.ts — Pure brain for the "violet = shared" legibility work.
 * Derives WHAT an edit will hit (the fx-bar scope chip) and the drilled-in
 * banner copy from state-shaped inputs. No DOM, no state imports —
 * node-testable, like cfr.ts. The returned strings are UI contracts: e2e
 * specs locate elements by them, so change them test-first.
 */

import type { SPElement } from '../core/types';
import { cfrBlastRadius } from './cfr';
import { cfrFieldName } from '../core/refs';

export type Scope =
  | { kind: 'view' }
  | { kind: 'host'; field: string }
  | { kind: 'style'; field: string; places: number };

/** What the next edit hits: the view, the selected host cell, or (when
 *  drilled) the shared style — with its blast count, clamped to ≥1. */
export function scopeFor(
  activeDocKey: string,
  selected: SPElement | null,
  mainRoot: SPElement | undefined,
  columnRefs: Record<string, SPElement>,
): Scope {
  if (activeDocKey !== 'main') {
    const blast = cfrBlastRadius(activeDocKey, mainRoot, columnRefs);
    return { kind: 'style', field: activeDocKey, places: Math.max(blast.count, 1) };
  }
  if (selected?.columnFormatterReference) {
    return { kind: 'host', field: cfrFieldName(selected.columnFormatterReference) };
  }
  return { kind: 'view' };
}

export function scopeChipLabel(s: Scope, display: (name: string) => string): string {
  switch (s.kind) {
    case 'view': return 'This view only';
    case 'host': return 'Host cell · this view only';
    case 'style': return `${display(s.field)} style · ${s.places} ${s.places === 1 ? 'place' : 'places'}`;
  }
}

/** Banner copy while drilled in. `field` is already display-resolved. */
export function styleBannerLabel(field: string, places: number): string {
  return places > 1
    ? `Editing the ${field} style — used in ${places} places · changes apply everywhere`
    : `Editing the ${field} style — changes apply everywhere it's used`;
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/editor/styleScope.test.ts`
Expected: PASS (all 11).

- [ ] **Step 5: Add the state accessor + its test**

In `src/editor/state.ts`, directly after the `openMain()` method (ends ~line 332), add:

```ts
  /** The main (view) formatter root, even while drilled into a column style —
   *  scope/blast-radius calculations need it and mainDocStash is private. */
  get mainRootForScope(): SPElement | undefined {
    return this.activeDocKey === 'main' ? this.doc.root : this.mainDocStash?.root;
  }
```

In `src/editor/state.test.ts`, append (mirror the file's existing setup helpers for constructing/resetting state — read its first ~40 lines and reuse the same pattern):

```ts
describe('mainRootForScope', () => {
  it('returns the live root on main, and the stashed main root while drilled', () => {
    const s = makeState(); // ← use this file's existing state-construction helper
    const mainRoot = s.doc.root;
    s.columnRefs['Status'] = { elmType: 'div', txtContent: '@currentField' };
    s.openColumnRef('Status');
    expect(s.activeDocKey).toBe('Status');
    expect(s.mainRootForScope).toBe(mainRoot);
    s.openMain();
    expect(s.mainRootForScope).toBe(s.doc.root);
  });
});
```

- [ ] **Step 6: Run the state tests**

Run: `npx vitest run src/editor/state.test.ts src/editor/styleScope.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/editor/styleScope.ts src/editor/styleScope.test.ts src/editor/state.ts src/editor/state.test.ts
git commit -m "feat(style-scope): pure scope/banner derivation + mainRootForScope accessor"
```

---

### Task 2: Violet design tokens (both themes, contrast-verified)

**Files:**
- Modify: `src/style.css` (`:root` block starting line 3; `body.wb-dark` block starting line 46)

**Interfaces:**
- Produces CSS custom properties later tasks style with: `--wb-shared` (the accent itself, used as ink on the app surface and for outlines/rails), `--wb-shared-bg` (tint fill), `--wb-shared-border` (soft border on tinted chrome).

- [ ] **Step 1: Add the tokens**

In `:root` (after `--wb-scroll-thumb-hover`, ~line 17):

```css
  /* ── "violet = shared" channel — reserved EXCLUSIVELY for column-style-owned
        chrome (rails, § marks, scope chip, drilled banner/frame, tree stub).
        Never reuse for anything else; that exclusivity is the feature. */
  --wb-shared: #5c2d91;        /* ink + outlines on app surfaces (≥4.5:1 on --wb-surface) */
  --wb-shared-bg: #f3ecfc;     /* tint fill behind shared chrome */
  --wb-shared-border: #c9b3e8;
```

In `body.wb-dark` (after `--wb-scroll-thumb-hover`, ~line 56):

```css
  --wb-shared: #c5a3f2;        /* lightened for dark surfaces (≥4.5:1 on --wb-surface) */
  --wb-shared-bg: #2b2140;
  --wb-shared-border: #55407c;
```

- [ ] **Step 2: Verify contrast with a throwaway script**

Run (from repo root):

```bash
node -e "
const lum = (hex) => { const c = [1,3,5].map(i => parseInt(hex.slice(i,i+2),16)/255).map(v => v <= 0.03928 ? v/12.92 : ((v+0.055)/1.055)**2.4); return 0.2126*c[0]+0.7152*c[1]+0.0722*c[2]; };
const ratio = (a,b) => { const [x,y] = [lum(a),lum(b)].sort((p,q)=>q-p); return ((x+0.05)/(y+0.05)).toFixed(2); };
console.log('light ink/surface :', ratio('#5c2d91','#ffffff'));
console.log('light ink/tint    :', ratio('#5c2d91','#f3ecfc'));
console.log('dark  ink/surface :', ratio('#c5a3f2','#252423'));
console.log('dark  ink/tint    :', ratio('#c5a3f2','#2b2140'));
"
```

Expected: all four ratios ≥ 4.5. If any pair fails, darken the light ink / lighten the dark ink until it passes, and record the final values in the commit message.

- [ ] **Step 3: Build check**

Run: `npm run build`
Expected: success (CSS-only change).

- [ ] **Step 4: Commit**

```bash
git add src/style.css
git commit -m "feat(css): reserved --wb-shared violet channel for column-style chrome, WCAG-checked in both themes"
```

---

### Task 3: Copy pass — style vocabulary in menus, tooltips, toasts, breadcrumb

**Files:**
- Modify: `src/editor/gridView.ts:527-582` (menu items), `src/editor/gridView.ts:767-777` (header badge tooltip)
- Modify: `src/editor/breadcrumb.ts:38-41` (root crumb label)
- Modify: `e2e/cfr.spec.ts` (locators + comments), plus any other spec the grep in Step 1 finds

**Interfaces:**
- Consumes: nothing new. Produces: the exact user-facing strings later e2e tasks locate by (listed verbatim below — do not improvise variants).

- [ ] **Step 1: Find every site that uses the old copy**

Run: `grep -rn "Format this Column\|Override in this view\|column's format\|Column Formatters\|column format" src e2e --include="*.ts"`

Expected sites (verify; update any extras the grep surfaces): `gridView.ts` (menu + badge tooltip + toasts), `breadcrumb.ts` (root crumb + title), `columnGallery.ts` (gallery heading/labels, if the grep hits), `cfr.spec.ts`, `breadcrumb.spec.ts`, `grid.spec.ts`, `workspace.spec.ts` (if they locate by these strings). Leave `guideContent.ts` and code comments untouched — the guide teaches raw SP JSON on purpose.

- [ ] **Step 2: Rewrite the linked-column menu items (`gridView.ts:530-548`)**

```ts
    if (isLinked) {
      // a linked instance of the column's shared style (the Figma model):
      // edit the shared style for everyone, or detach a local copy into this view.
      const blast = cfrBlastRadius(field.name, state.doc.root, state.columnRefs);
      items.push({
        icon: 'Brush',
        label: `Edit the ${field.name} style`,
        badge: '§ shared',
        title: blast.count > 1
          ? `Edit the shared ${field.name} style — changes all ${blast.count} places it's used (${blast.places.join(', ')})`
          : `Edit the shared ${field.name} style — changes apply everywhere it's used`,
        fn: () => formatColumn(col, field, onToast),
      });
      items.push({
        icon: 'BranchFork2',
        label: 'Detach from style',
        title: `Format just this cell — a local copy that lives only in this view; the ${field.name} style everywhere else is untouched`,
        fn: () => { state.forkCfr(col.path); onToast(`"${label}" is detached from the ${field.name} style — edits stay in this view. Ctrl+Z to relink.`); },
      });
    } else if (registered) {
```

- [ ] **Step 3: Rewrite the registered/unregistered items (`gridView.ts:549-574`)**

`'Edit its formatter'` → label `` `Edit the ${field.name} style` ``, title `` `Open the ${field.name} column style on the canvas` ``.

`` `Save as the ${field.name} column's format` `` → label `` `Save as the ${field.name} column style` ``, title `` `Register this cell's design as the ${field.name} column style and link this cell to it — reuse it anywhere via "+ column" or a reference` ``, and the success toast → `` `Saved as the ${f} column style — this cell now uses it. Ctrl+Z to undo.` `` (failure toast: `'Could not save this cell as a column style.'`). The plain `'Format this column'` (unregistered) item keeps its label — no style exists yet.

- [ ] **Step 4: Rewrite the header badge tooltip (`gridView.ts:774-776`)**

```ts
      badge.title = blast.count > 1
        ? `Uses the ${linkField} style — shared with ${blast.count} places. "Edit the ${linkField} style" changes them all; "Detach from style" makes a copy for this view.`
        : `Uses the ${linkField} style. "Edit the ${linkField} style" changes the shared style; "Detach from style" makes a copy for this view.`;
```

- [ ] **Step 5: Breadcrumb root (`breadcrumb.ts:38-41`)**

```ts
    root.textContent = isColumn ? 'Column Styles ▾' : 'View Formatters ▾';
    root.title = isColumn
      ? 'Browse the columns that have a style, or start one'
      : 'The view formatter on the canvas — rename it or manage views';
```

- [ ] **Step 6: Update every spec the Step-1 grep found**

In `e2e/cfr.spec.ts`: `'Format this Column'` → `'Edit the Status style'` (and `'Edit the Title style'` in the promote test), `'Override in this view'` → `'Detach from style'`, `"Save as the Title column's format"` → `'Save as the Title column style'`, `.wb-crumb-root` assertion `'Column Formatters'` → `'Column Styles'`; refresh the header comment to style vocabulary. Apply the same mechanical substitutions in any other spec the grep surfaced (`breadcrumb.spec.ts` asserts the crumb label — update it).

- [ ] **Step 7: Verify**

Run: `npm run build && npx vitest run && npx playwright test e2e/cfr.spec.ts e2e/breadcrumb.spec.ts e2e/grid.spec.ts`
Expected: all green.

- [ ] **Step 8: Commit**

```bash
git add -A src e2e
git commit -m "feat(copy): Office 'column style' vocabulary — Edit the style / Detach from style / Save as column style"
```

---

### Task 4: Grid at rest — § header mark, violet rails, name-tag, double-click drill

**Files:**
- Modify: `src/editor/gridView.ts` (~line 767 header badge; ~line 872 cell loop)
- Modify: `src/style.css` (new classes, end of file)
- Create: `e2e/styleLegibility.spec.ts`

**Interfaces:**
- Consumes: `--wb-shared*` tokens (Task 2); copy from Task 3; `cfrBlastRadius` (existing import in gridView).
- Produces: classes `.wb-cell-linked`, `.wb-style-nametag`, `.wb-style-mark` used by e2e; the `§` glyph inside the existing `.wb-cfr-link` badge.

- [ ] **Step 1: Write the failing e2e**

Create `e2e/styleLegibility.spec.ts` (reuse `cfr.spec.ts`'s beforeEach and `header()` helper verbatim):

```ts
/**
 * E2E: column-style legibility — "violet = shared". Rails + § marks at rest,
 * the name-tag on a selected linked cell, and double-click drill-in.
 */
import { test, expect, type Page } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  page.on('dialog', (d) => { void d.accept(); });
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
});

function header(page: Page, label: string) {
  return page.locator('.wb-grid-header', { has: page.locator('.wb-grid-header-label', { hasText: label }) });
}

test('linked cells wear the shared rail; plain cells do not', async ({ page }) => {
  await expect(page.locator('.wb-grid-cell.wb-cell-linked').first()).toBeVisible();
  // Status ships linked; Title does not — compare within the first data row
  const firstRow = page.locator('.wb-grid-row').first();
  await expect(firstRow.locator('.wb-cell-linked')).toHaveCount(2); // Status + Progress ship linked
});

test('the header badge shows the § style mark', async ({ page }) => {
  await expect(header(page, 'Status').locator('.wb-cfr-link')).toHaveText('§');
  await expect(header(page, 'Title').locator('.wb-cfr-link')).toHaveCount(0);
});

test('selecting a linked cell reveals its name-tag', async ({ page }) => {
  const cell = page.locator('.wb-grid-cell.wb-cell-linked').first();
  await expect(cell.locator('.wb-style-nametag')).toHaveText('Status style');
  await cell.click();
  await expect(cell.locator('.wb-style-nametag')).toBeVisible();
});

test('double-clicking a linked cell drills into the style', async ({ page }) => {
  await page.locator('.wb-grid-cell.wb-cell-linked').first().dblclick();
  await expect(page.locator('.wb-crumb-root')).toContainText('Column Styles');
  await expect(page.locator('.wb-crumb-tail')).toHaveText('Status');
});
```

Run: `npx playwright test e2e/styleLegibility.spec.ts`
Expected: FAIL (no `.wb-cell-linked`, badge glyph is the Link icon, no name-tag).

- [ ] **Step 2: Swap the header badge glyph to § (`gridView.ts:771-773`)**

Replace the `<i class="ms-Icon ms-Icon--Link wb-cfr-link">` construction with a text mark (class name kept per Global Constraints):

```ts
      const badge = document.createElement('span');
      badge.className = 'wb-cfr-link wb-style-mark';
      badge.textContent = '§';
      badge.setAttribute('aria-hidden', 'true');
```

(The two `badge.title` lines from Task 3 stay as-is.)

- [ ] **Step 3: Rail + name-tag + tooltip + dblclick in the cell loop (`gridView.ts` ~line 872)**

Inside `cols.forEach((col, i) => { ... })` in the row loop, after `cell.dataset.col = String(i);`, add:

```ts
      if (col.el.columnFormatterReference) {
        const linkField = cfrFieldName(col.el.columnFormatterReference);
        const linkDisplay = state.fields.find((f) => f.name === linkField)?.displayName ?? linkField;
        const blast = cfrBlastRadius(linkField, state.doc.root, state.columnRefs);
        cell.classList.add('wb-cell-linked');
        cell.title = `${linkDisplay} style — double-click to edit (used in ${Math.max(blast.count, 1)} place${blast.count === 1 ? '' : 's'})`;
        const tag = document.createElement('span');
        tag.className = 'wb-style-nametag';
        tag.textContent = `${linkDisplay} style`;
        tag.setAttribute('aria-hidden', 'true');
        cell.appendChild(tag);
        cell.addEventListener('dblclick', (e) => {
          e.stopPropagation();
          const field = state.fields.find((f) => f.name === linkField);
          if (field) formatColumn(col, field, onToast);
        });
      }
```

`cfrFieldName` and `cfrBlastRadius` are already imported in gridView.ts. `formatColumn` is defined at line 55 of the same file. If the cell loop's `col` variable shadows differently, adapt names to the surrounding code — the loop at ~line 872 already iterates `cols.forEach((col, i) =>`.

- [ ] **Step 4: The CSS (append to `src/style.css`)**

```css
/* ── "violet = shared" — grid at rest ──────────────────────────────────── */
.wb-cell-linked {
  box-shadow: inset 3px 0 0 var(--wb-shared);
  position: relative;
}
.wb-cell-linked:hover { outline: 1.5px solid var(--wb-shared); outline-offset: -1.5px; }
.wb-style-mark { color: var(--wb-shared); font-weight: 700; font-style: normal; }
.wb-grid-header .wb-cfr-link { color: var(--wb-shared); }
.wb-style-nametag {
  display: none;
  position: absolute;
  top: -8px;
  right: 4px;
  font-size: 9px;
  line-height: 1.4;
  padding: 0 5px;
  border-radius: 3px;
  background: var(--wb-shared-bg);
  border: 1px solid var(--wb-shared-border);
  color: var(--wb-shared);
  pointer-events: none;
  z-index: 2;
}
.wb-cell-linked:hover .wb-style-nametag,
.wb-cell-linked:has(.wb-selected) .wb-style-nametag { display: inline-block; }
```

(`:has()` is fine — the app already targets evergreen Chromium/Firefox; hover is the fallback either way.)

- [ ] **Step 5: Run the e2e**

Run: `npx playwright test e2e/styleLegibility.spec.ts e2e/cfr.spec.ts e2e/grid.spec.ts`
Expected: PASS. If the name-tag visibility assertion is flaky because `wb-selected` lands on a descendant, assert `toHaveCSS('display', 'inline-block')` after click instead.

- [ ] **Step 6: Commit**

```bash
git add src/editor/gridView.ts src/style.css e2e/styleLegibility.spec.ts
git commit -m "feat(grid): violet rails, § header mark, name-tag on linked cells, dblclick drills into the style"
```

---

### Task 5: Scope chip on the fx bar

**Files:**
- Modify: `src/editor/fxBar.ts` (inside `render()`, right after `host.innerHTML = ''` at line 88)
- Modify: `src/style.css` (append)
- Modify: `e2e/styleLegibility.spec.ts` (append tests)

**Interfaces:**
- Consumes: `scopeFor`, `scopeChipLabel` from `./styleScope` (Task 1); `state.mainRootForScope` (Task 1).
- Produces: `.wb-scope-chip` with modifier classes `.wb-scope-view` / `.wb-scope-host` / `.wb-scope-style`.

- [ ] **Step 1: Write the failing e2e (append to `e2e/styleLegibility.spec.ts`)**

```ts
test('the scope chip always names what an edit will hit', async ({ page }) => {
  // nothing selected → view scope
  await expect(page.locator('.wb-scope-chip')).toHaveText('This view only');
  // select the linked Status host cell (its header selects the cell path)
  await header(page, 'Status').click();
  await page.keyboard.press('Escape'); // close the header menu, selection stays
  await expect(page.locator('.wb-scope-chip')).toHaveText('Host cell · this view only');
  // drill in → style scope with blast count
  await page.locator('.wb-grid-cell.wb-cell-linked').first().dblclick();
  await expect(page.locator('.wb-scope-chip')).toContainText('Status style ·');
});
```

Run: `npx playwright test e2e/styleLegibility.spec.ts`
Expected: the new test FAILS (no `.wb-scope-chip`).

- [ ] **Step 2: Implement the chip in `fxBar.ts`**

Add imports at the top: `import { scopeFor, scopeChipLabel } from './styleScope';`

In `render()`, immediately after `host.innerHTML = '';` (line 88) and BEFORE the `if (!node)` early return — the chip must show even with nothing selected:

```ts
    const scope = scopeFor(state.activeDocKey, state.selectedNode, state.mainRootForScope, state.columnRefs);
    const chip = document.createElement('span');
    chip.className = `wb-scope-chip wb-scope-${scope.kind}`;
    chip.textContent = scopeChipLabel(scope, (n) => state.fields.find((f) => f.name === n)?.displayName ?? n);
    chip.title = scope.kind === 'style'
      ? "Edits here change the shared style everywhere it's used"
      : scope.kind === 'host'
        ? 'The host cell is selected — box edits (width, borders, padding) stay in this view; the content inside belongs to the style'
        : 'Edits apply to this view formatter only';
    host.appendChild(chip);
```

Note: `state.selectedNode` is the existing single-selection accessor `fxBar` already uses at line 89 — reuse it, don't add a new one.

- [ ] **Step 3: The CSS (append)**

```css
/* ── scope chip: what will this edit hit ───────────────────────────────── */
.wb-scope-chip {
  flex: none;
  font-size: 10.5px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 4px;
  white-space: nowrap;
}
.wb-scope-view { background: var(--wb-canvas-bg); color: var(--wb-text-2); }
.wb-scope-host { background: var(--wb-lp-selected); color: var(--wb-text); }
.wb-scope-style { background: var(--wb-shared-bg); border: 1px solid var(--wb-shared-border); color: var(--wb-shared); }
```

- [ ] **Step 4: Run the tests**

Run: `npx playwright test e2e/styleLegibility.spec.ts && npx vitest run`
Expected: PASS. If the fx bar's flex layout squeezes the editor, check `.wb-fxbar` in style.css and let the chip sit before the ƒx badge with `order` untouched — adjust only the new class.

- [ ] **Step 5: Commit**

```bash
git add src/editor/fxBar.ts src/style.css e2e/styleLegibility.spec.ts
git commit -m "feat(fxbar): always-on scope chip — host cell vs {Field} style · N places"
```

---

### Task 6: Drilled-in canvas — banner, Done, Esc, violet frame, dimmed context

**Files:**
- Modify: `src/editor/canvas.ts` (the `kind === 'column'` branch at lines 118-151; the unsub block at 256-266)
- Modify: `src/style.css` (append)
- Modify: `e2e/styleLegibility.spec.ts` (append tests)

**Interfaces:**
- Consumes: `styleBannerLabel` from `./styleScope`; `cfrBlastRadius` from `./cfr`; `state.mainRootForScope`; `state.openMain()`.
- Produces: `.wb-style-banner`, `.wb-style-done`, host class `.wb-style-editing`.

- [ ] **Step 1: Write the failing e2e (append)**

```ts
test('drilling in shows the § banner; Done and Esc both return to the view', async ({ page }) => {
  await page.locator('.wb-grid-cell.wb-cell-linked').first().dblclick();
  const banner = page.locator('.wb-style-banner');
  await expect(banner).toContainText('Editing the Status style');
  await expect(banner).toContainText('changes apply everywhere');
  // Done returns
  await banner.locator('.wb-style-done').click();
  await expect(page.locator('.wb-style-banner')).toHaveCount(0);
  await expect(page.locator('.wb-crumb-root')).toContainText('View Formatters');
  // …and Esc returns too
  await page.locator('.wb-grid-cell.wb-cell-linked').first().dblclick();
  await expect(page.locator('.wb-style-banner')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.wb-style-banner')).toHaveCount(0);
});
```

Run: `npx playwright test e2e/styleLegibility.spec.ts`
Expected: new test FAILS.

- [ ] **Step 2: Banner + frame in the `kind === 'column'` branch (`canvas.ts:118`)**

Add imports: `import { styleBannerLabel } from './styleScope';` and `import { cfrBlastRadius } from './cfr';`

At the top of `render()` (after `runtimeIssues = [];`), keep the host class honest on every render:

```ts
    host.classList.toggle('wb-style-editing', state.doc.kind === 'column' && state.activeDocKey !== 'main');
```

Inside the `if (kind === 'column') {` branch, before the `table` is built:

```ts
      if (state.activeDocKey !== 'main') {
        const fieldName = state.activeDocKey;
        const display = state.fields.find((f) => f.name === fieldName)?.displayName ?? fieldName;
        const blast = cfrBlastRadius(fieldName, state.mainRootForScope, state.columnRefs);
        const banner = document.createElement('div');
        banner.className = 'wb-style-banner';
        const mark = document.createElement('span');
        mark.className = 'wb-style-mark';
        mark.textContent = '§';
        const text = document.createElement('span');
        text.textContent = styleBannerLabel(display, Math.max(blast.count, 1));
        const done = document.createElement('button');
        done.type = 'button';
        done.className = 'wb-style-done';
        done.textContent = 'Done';
        done.title = `Back to the ${state.viewName} view formatter`;
        done.addEventListener('click', () => { state.openMain(); onToast(`Back to the ${state.viewName} view formatter`); });
        banner.append(mark, text, done);
        host.appendChild(banner);
      }
```

- [ ] **Step 3: Esc exits the style (`canvas.ts` unsub block, ~line 256)**

Next to the existing `onDocClick` document listener pattern (line 212-216), add:

```ts
  const onDocKeydown = (e: KeyboardEvent) => {
    if (e.key !== 'Escape' || state.activeDocKey === 'main') return;
    const t = e.target as HTMLElement;
    if (t.closest('input, textarea, select, [contenteditable], dialog')) return;
    // an open menu/flyout/float owns its own Escape — don't also navigate
    if (document.querySelector('.wb-menu, .wb-flyout, .wb-fx-float')) return;
    state.openMain();
    onToast(`Back to the ${state.viewName} view formatter`);
  };
  document.addEventListener('keydown', onDocKeydown);
```

and extend the cleanup at line 263-266:

```ts
  (host as any)._unsub = () => {
    unsub();
    document.removeEventListener('click', onDocClick);
    document.removeEventListener('keydown', onDocKeydown);
  };
```

**Verify the guard selectors:** open `src/editor/menu.ts` and the fx float in `fxBar.ts` and confirm the actual class names of the open-menu container and floating editor (`.wb-menu`, `.wb-flyout`, `.wb-fx-float` are the expected names — correct them to what the code really uses before committing).

- [ ] **Step 4: The CSS (append)**

```css
/* ── drilled into a column style ───────────────────────────────────────── */
.wb-style-editing { outline: 2px solid var(--wb-shared); outline-offset: -2px; }
.wb-style-banner {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  font-size: 12px;
  font-weight: 600;
  background: var(--wb-shared-bg);
  color: var(--wb-shared);
  border-bottom: 1px solid var(--wb-shared-border);
}
.wb-style-banner .wb-style-done {
  margin-left: auto;
  font: inherit;
  font-size: 11.5px;
  padding: 2px 10px;
  border-radius: 4px;
  border: 1px solid var(--wb-shared-border);
  background: var(--wb-surface);
  color: var(--wb-shared);
  cursor: pointer;
}
/* the Title context column steps back while a style is edited */
.wb-style-editing .wb-mock-cell:not(.wb-mock-cell-fmt) { opacity: 0.45; }
```

- [ ] **Step 5: Run the tests**

Run: `npx playwright test e2e/styleLegibility.spec.ts e2e/breadcrumb.spec.ts e2e/workspace.spec.ts`
Expected: PASS (breadcrumb/workspace specs exercise open/close paths the Esc handler must not break).

- [ ] **Step 6: Commit**

```bash
git add src/editor/canvas.ts src/style.css e2e/styleLegibility.spec.ts
git commit -m "feat(canvas): drilled-in style editing — § banner with blast count, Done/Esc exit, violet frame, dimmed context"
```

---

### Task 7: Structure tree — opaque stub, host badge, § section headers

**Files:**
- Modify: `src/editor/treeView.ts` (nodeChips lines 49-60; renderNode ~line 340; docHeader call site lines 109-116 and docHeader fn 140-159)
- Modify: `src/style.css` (append)
- Modify: `e2e/styleLegibility.spec.ts` (append test)

**Interfaces:**
- Consumes: `cfrBlastRadius` from `./cfr` (new import), `cfrFieldName` (already imported), `state.mainRootForScope`, existing `jumpToColumn`.
- Produces: `.wb-tree-stylestub`, `.wb-tree-badge-host`, `.wb-doc-style` classes.

- [ ] **Step 1: Write the failing e2e (append)**

```ts
test('the tree shows an opaque style stub under the host cell; opening it drills in', async ({ page }) => {
  const stub = page.locator('.wb-tree-stylestub').first();
  await expect(stub).toContainText('Status style');
  await expect(stub).toContainText('open');
  await stub.click();
  await expect(page.locator('.wb-crumb-root')).toContainText('Column Styles');
  await expect(page.locator('.wb-crumb-tail')).toHaveText('Status');
});
```

Run: `npx playwright test e2e/styleLegibility.spec.ts`
Expected: new test FAILS.

- [ ] **Step 2: Retire the ⤷ chip, add the stub (`treeView.ts`)**

Delete the `if (el.columnFormatterReference) { ... }` branch from `nodeChips` (lines 49-60) — the stub replaces it — and remove the now-unused `onCfr` parameter from `nodeChips` and its call site at line 199 (`jumpToColumn` stays; the stub uses it).

In `renderNode`, right after `wrap.appendChild(row);` (line 340), add:

```ts
    // "violet = shared": the style is a door, not a folder — one opaque,
    // non-expandable stub; opening it drills in (same lesson as the canvas).
    if (el.columnFormatterReference) {
      const name = cfrFieldName(el.columnFormatterReference);
      const registered = name in state.columnRefs;
      const stub = document.createElement('div');
      stub.className = 'wb-tree-stylestub' + (registered ? '' : ' wb-tree-stylestub-missing');
      stub.style.paddingLeft = `${(path.length + 1) * 12 + 8}px`;
      if (registered) {
        const blast = cfrBlastRadius(name, state.mainRootForScope, state.columnRefs);
        const places = Math.max(blast.count, 1);
        stub.textContent = `§ ${name} style · used in ${places} place${places === 1 ? '' : 's'} → open`;
        stub.title = `This element renders the shared ${name} style. Open it to edit — changes apply everywhere it's used.`;
        stub.setAttribute('role', 'button');
        stub.tabIndex = 0;
        const open = (e: Event) => { e.stopPropagation(); jumpToColumn(name); };
        stub.addEventListener('click', open);
        stub.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(e); }
        });
      } else {
        stub.textContent = `§ ${name} style — not in this workspace`;
        stub.title = `The formatter references [$${name}], but that style isn't registered. Import the list export or register it in the Data tab.`;
      }
      wrap.appendChild(stub);
    }
```

Add the import: `import { cfrBlastRadius } from './cfr';`

- [ ] **Step 3: Host badge on the row's label (renderNode, after line 199's `label.append(...)`)**

```ts
    if (el.columnFormatterReference) {
      const hostBadge = document.createElement('span');
      hostBadge.className = 'wb-tree-badge-host';
      hostBadge.textContent = 'host · this view';
      hostBadge.title = 'This box is yours — its size and borders live in this view. Its content comes from the shared style below.';
      label.appendChild(hostBadge);
    }
```

- [ ] **Step 4: § section headers (call site at lines 109-116, docHeader at 140-159)**

At the call site, adopt the vocabulary:

```ts
    for (const name of names) {
      const badge = referenced.has(name) ? 'used in view' : 'unused';
      colsHost.appendChild(docHeader(name, `§ ${name} style`, state.activeDocKey === name, badge));
```

In `docHeader`, mark column headers with the shared class — after `h.className = ...` add:

```ts
    if (key !== 'main') h.classList.add('wb-doc-style');
```

Check `e2e/workspace.spec.ts` and `e2e/breadcrumb.spec.ts` for assertions on the old `[$Status]` header text or `⤷ in view` badge and update them in this commit (the Step-1 grep from Task 3 may have already caught some).

- [ ] **Step 5: The CSS (append)**

```css
/* ── tree: the style is a door, not a folder ───────────────────────────── */
.wb-tree-stylestub {
  display: block;
  margin: 1px 4px 3px 20px;
  padding: 3px 8px;
  font-size: 11px;
  border-radius: 0 4px 4px 0;
  background: var(--wb-shared-bg);
  box-shadow: inset 2px 0 0 var(--wb-shared);
  color: var(--wb-shared);
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.wb-tree-stylestub:hover { filter: brightness(0.97); }
.wb-tree-stylestub-missing { cursor: default; opacity: 0.75; }
.wb-tree-badge-host {
  font-size: 9px;
  padding: 0 5px;
  border-radius: 3px;
  background: var(--wb-canvas-bg);
  color: var(--wb-text-2);
  white-space: nowrap;
}
.wb-doc-header.wb-doc-style { color: var(--wb-shared); }
.wb-doc-header.wb-doc-style.active { background: var(--wb-shared-bg); }
```

- [ ] **Step 6: Run the tests**

Run: `npx playwright test e2e/styleLegibility.spec.ts e2e/workspace.spec.ts && npx vitest run`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/editor/treeView.ts src/style.css e2e/styleLegibility.spec.ts e2e/workspace.spec.ts e2e/breadcrumb.spec.ts
git commit -m "feat(tree): opaque style stub under host cells, host badge, § column-style section headers"
```

---

### Task 8: Full verification + dark-mode sweep

**Files:** none created — verification only (fix regressions where they live).

- [ ] **Step 1: Full unit suite** — Run: `npx vitest run` · Expected: all pass (521 + the new ones).
- [ ] **Step 2: Build** — Run: `npm run build` · Expected: clean.
- [ ] **Step 3: Full Playwright suite** — Run: `npx playwright test` · Expected: all pass. Fix any spec still locating by pre-rename copy (grep the failure text, update the spec, re-run).
- [ ] **Step 4: Dark-mode spot check** — with the dev server (`npm run dev`), toggle dark mode and confirm the rail, chip, banner, stub and name-tag all render with the dark-theme `--wb-shared*` values (no hardcoded hexes escaped into component CSS: `grep -n "#5c2d91\|#c5a3f2\|#f3ecfc\|#2b2140" src/style.css` must only hit the two token blocks).
- [ ] **Step 5: Commit any fixes**

```bash
git add -A src e2e
git commit -m "test: green across unit + e2e after column-style legibility pass"
```

Then follow the repo's end-of-session contract (CLAUDE.md): push the branch, open the PR to `main` with test counts, and start the PR watch loop.

---

## Deviation from the approved mockup (recorded)

The approach-A mockup showed the **whole grid** dimmed behind the drilled-in style. The shipped drill-in surface is the existing column-editor preview (Title context column + the formatted column, per real row), which this plan frames and dims. Rendering the full main grid as a live backdrop while edits target the style document would require the grid renderer to draw one root while selection routes to another — a real refactor with its own risks. The in-context promise (real rows, live updates, visible context) is kept; the "every other view column stays visible" fidelity is not. Flag to the owner at PR time; a full-grid backdrop can be its own follow-up if wanted.
