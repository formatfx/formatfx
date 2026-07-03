/**
 * E2E: the ⬡ Components library — packaged formatting without a column to
 * call home. The COMPONENTS tab browses built-ins + saved components with
 * live best-guess previews; "Add to view…" opens the typed mapping dialog
 * (one type-filtered column picker per slot) and inserts the bound component
 * as one undoable step; "Save as component…" (element context menu) derives
 * typed slots and persists to the library across reloads; CFR-carrying
 * subtrees are refused (components are self-contained).
 */
import { test, expect, type Page } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  page.on('dialog', (d) => { void d.accept(); });
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
});

function treeRow(page: Page, name: string) {
  return page.locator('.wb-tree-row', { has: page.locator('.wb-tree-name', { hasText: name }) });
}

test('the COMPONENTS tab opens the library: built-ins with slot chips and live previews', async ({ page }) => {
  await page.locator('.wb-fmt-tab-comp').click();
  await expect(page.locator('.wb-fmt-tab-comp')).toHaveClass(/active/);
  // library mode replaces the tree browser; the other tabs read inactive
  await expect(page.locator('.wb-fmt-tab-view')).not.toHaveClass(/active/);
  await expect(page.locator('#wb-tree-body')).toBeHidden();
  const lib = page.locator('#wb-lp-library');
  await expect(lib).toBeVisible();
  await expect(lib.locator('.wb-comp-card')).toHaveCount(3); // the built-ins
  const deadline = lib.locator('.wb-comp-card', { hasText: 'Deadline chip' });
  await expect(deadline.locator('.wb-comp-slot')).toContainText(['The deadline to track · date']);
  // best-guess preview renders against the mock rows (row 1 has a future date)
  await expect(deadline.locator('.wb-comp-preview')).toContainText(/Due|Overdue/);
  // leaving via the VIEW tab restores the tree browser
  await page.locator('.wb-fmt-tab-view').click();
  await expect(page.locator('#wb-lp-library')).toBeHidden();
  await expect(page.locator('#wb-tree-body')).toBeVisible();
});

test('Add to view: the mapping dialog filters columns by slot type and inserts one undoable grid column', async ({ page }) => {
  await page.locator('.wb-fmt-tab-comp').click();
  await page.locator('.wb-comp-card', { hasText: 'Deadline chip' })
    .locator('.wb-comp-add').click();
  const dlg = page.locator('.wb-compmap');
  await expect(dlg).toBeVisible();
  // the picker lists ONLY date columns — DueDate yes, Title no
  const sel = dlg.locator('.wb-compmap-select[data-slot="Due"]');
  await expect(sel.locator('option', { hasText: 'DueDate' })).toHaveCount(1);
  await expect(sel.locator('option', { hasText: 'Title' })).toHaveCount(0);
  await expect(sel).toHaveValue('DueDate'); // best guess prefilled
  const headersBefore = await page.locator('.wb-grid-header-label').count();
  await dlg.locator('.wb-compmap-insert').click();
  await expect(dlg).toHaveCount(0);
  // arrived as a new grid column, rendering the bound expressions
  await expect(page.locator('.wb-grid-header-label')).toHaveCount(headersBefore + 1);
  await expect(page.locator('.wb-grid-row').first()).toContainText(/Due |Overdue/);
  // one Ctrl+Z removes it
  await page.keyboard.press('Control+z');
  await expect(page.locator('.wb-grid-header-label')).toHaveCount(headersBefore);
});

test('a two-slot component maps person + date independently', async ({ page }) => {
  await page.locator('.wb-fmt-tab-comp').click();
  await page.locator('.wb-comp-card', { hasText: 'Assignee + deadline' })
    .locator('.wb-comp-add').click();
  const dlg = page.locator('.wb-compmap');
  const person = dlg.locator('.wb-compmap-select[data-slot="Person"]');
  // person slot accepts person AND multi-person columns
  await expect(person.locator('option', { hasText: 'Owner' })).toHaveCount(1);
  await expect(person.locator('option', { hasText: 'AssignedTo' })).toHaveCount(1);
  await person.selectOption('Owner');
  await dlg.locator('.wb-compmap-insert').click();
  // the first mock row's owner renders by name
  await expect(page.locator('.wb-grid-row').first()).toContainText('Ada Lovelace');
});

test('Save as component: derives typed slots, lands in "Yours", persists across reload', async ({ page }) => {
  // the DueDate grid cell is a plain [$DueDate] element — package it
  await treeRow(page, 'DueDate').click({ button: 'right' });
  await page.locator('.wb-grid-menu button', { hasText: 'Save as component…' }).click();
  const dlg = page.locator('.wb-compmap');
  await expect(dlg).toBeVisible();
  // the derived slot is typed from the schema
  await expect(dlg.locator('.wb-comp-slot')).toContainText(['DueDate · date']);
  await dlg.locator('.wb-compmap-name').fill('My date look');
  await dlg.locator('.wb-compmap-insert').click();
  await expect(page.locator('#wb-toast')).toContainText('Saved “My date look”');
  // it shows under Yours…
  await page.locator('.wb-fmt-tab-comp').click();
  const yours = page.locator('.wb-comp-card', { hasText: 'My date look' });
  await expect(yours).toBeVisible();
  // …and survives a reload (its own additive storage key)
  await page.reload();
  await page.locator('.wb-fmt-tab-comp').click();
  await expect(page.locator('.wb-comp-card', { hasText: 'My date look' })).toBeVisible();
  // delete removes it
  await page.locator('.wb-comp-card', { hasText: 'My date look' }).locator('.wb-comp-del').click();
  await expect(page.locator('.wb-comp-card', { hasText: 'My date look' })).toHaveCount(0);
});

test('a whole row saves as a row component and later REPLACES a view\'s layout, one undo', async ({ page }) => {
  // build a CFR-free row view: Ctrl-click plain columns, "make a row view"
  // (a template-built row carries CFR cells, which save correctly refuses —
  // components are self-contained)
  const header = (l: string) => page.locator('.wb-grid-header', { has: page.locator('.wb-grid-header-label', { hasText: l }) });
  await header('Title').click({ modifiers: ['Control'] });
  await header('DueDate').click({ modifiers: ['Control'] });
  await page.locator('.wb-areas-bar button', { hasText: 'Make a row view' }).click();
  await expect(page.locator('.wb-mock-viewrow')).toHaveCount(3);

  // save the ROOT row as a component — right-click the tree's root row
  await page.locator('#wb-tree-body .wb-tree-row').first().click({ button: 'right' });
  await page.locator('.wb-grid-menu button', { hasText: 'Save as component…' }).click();
  const dlg = page.locator('.wb-compmap');
  await expect(dlg.locator('.wb-compmap-note')).toContainText('WHOLE row layout');
  await dlg.locator('.wb-compmap-name').fill('My row shape');
  await dlg.locator('.wb-compmap-insert').click();
  await expect(page.locator('#wb-toast')).toContainText('Saved “My row shape”');

  // back to the grid, then use the saved row component as the layout again
  await page.locator('.wb-rowview-bar-btn', { hasText: 'Back to grid' }).click();
  await expect(page.locator('.wb-grid-headrow')).toBeVisible();
  await page.locator('.wb-fmt-tab-comp').click();
  const card = page.locator('.wb-comp-card', { hasText: 'My row shape' });
  await expect(card).toBeVisible(); // under Whole rows
  await card.locator('.wb-comp-add').click(); // "Use as the row layout…"
  await page.locator('.wb-compmap .wb-compmap-insert').click();
  await expect(page.locator('.wb-mock-viewrow')).toHaveCount(3);
  // one Ctrl+Z restores the grid
  await page.keyboard.press('Control+z');
  await expect(page.locator('.wb-grid-headrow')).toBeVisible();
});

test('Import from formatter JSON: a pasted rowFormatter becomes a mappable row component; bad JSON teaches', async ({ page }) => {
  await page.locator('.wb-fmt-tab-comp').click();
  await page.locator('.wb-comp-rowlink', { hasText: 'Import from formatter JSON' }).click();
  const dlg = page.locator('.wb-compmap');
  // refuse-and-teach on junk
  await dlg.locator('.wb-compmap-json').fill('{not json');
  await dlg.locator('.wb-compmap-insert').click();
  await expect(dlg.locator('.wb-compmap-error')).toContainText('Invalid JSON');
  // a real pnp-style rowFormatter imports with derived slots
  await dlg.locator('.wb-compmap-name').fill('Community row');
  await dlg.locator('.wb-compmap-json').fill(JSON.stringify({
    rowFormatter: {
      elmType: 'div',
      style: { display: 'flex' },
      children: [{ elmType: 'span', txtContent: '=[$Headline]' }],
    },
  }));
  await dlg.locator('.wb-compmap-insert').click();
  await expect(page.locator('#wb-toast')).toContainText('Imported “Community row” — a whole-row layout');
  const card = page.locator('.wb-comp-card', { hasText: 'Community row' });
  await expect(card).toBeVisible();
  // the unknown [$Headline] ref became an any-type slot; using the layout maps it
  await card.locator('.wb-comp-add').click();
  const map = page.locator('.wb-compmap');
  const sel = map.locator('.wb-compmap-select[data-slot="Headline"]');
  await expect(sel.locator('option', { hasText: 'Title' })).toHaveCount(1); // any type ⇒ all columns offered
  await sel.selectOption('Title');
  await map.locator('.wb-compmap-insert').click();
  await expect(page.locator('.wb-mock-viewrow').first()).toContainText('Launch new intranet');
});

test('saving over an existing name replaces the component instead of duplicating it', async ({ page }) => {
  const save = async (name: string) => {
    await page.locator('.wb-tree-row', { has: page.locator('.wb-tree-name', { hasText: 'DueDate' }) })
      .click({ button: 'right' });
    await page.locator('.wb-grid-menu button', { hasText: 'Save as component…' }).click();
    await page.locator('.wb-compmap .wb-compmap-name').fill(name);
    await page.locator('.wb-compmap .wb-compmap-insert').click();
  };
  await save('Same look');
  await save('Same look');
  await expect(page.locator('#wb-toast')).toContainText('Replaced “Same look”');
  await page.locator('.wb-fmt-tab-comp').click();
  await expect(page.locator('.wb-comp-card', { hasText: 'Same look' })).toHaveCount(1);
});

test('a CFR-carrying subtree is refused with teaching, not silently broken', async ({ page }) => {
  // the Status cell hosts a columnFormatterReference — not self-contained
  await treeRow(page, 'Status').click({ button: 'right' });
  await page.locator('.wb-grid-menu button', { hasText: 'Save as component…' }).click();
  await expect(page.locator('.wb-compmap')).toHaveCount(0); // no dialog
  await expect(page.locator('#wb-toast')).toContainText('must be self-contained');
});
