/**
 * E2E: the ⬡ Components tab — first an INVENTORY of the components in use in
 * the current project ("In this project": usage counts, jump-to-usage rows),
 * then the add-a-component browser (Built-in / Yours / Whole rows / Bring
 * your own). The typed mapping dialog inserts wherever the canvas points —
 * the view, or the OPEN column formatter — always as one undoable step.
 * "Save as component…" (element context menu) derives typed slots and
 * persists to the library across reloads; CFR-carrying subtrees are refused
 * (components are self-contained).
 */
import { test, expect, type Page } from '@playwright/test';
import { freshApp, header } from './helpers';

test.beforeEach(async ({ page }) => { await freshApp(page, { acceptDialogs: true }); });

function treeRow(page: Page, name: string) {
  return page.locator('.wb-tree-row', { has: page.locator('.wb-tree-name', { hasText: name }) });
}

test('the COMPONENTS tab opens the inventory + browser: empty "In this project", built-ins below', async ({ page }) => {
  await page.locator('.wb-fmt-tab-comp').click();
  await expect(page.locator('.wb-fmt-tab-comp')).toHaveClass(/active/);
  // library mode replaces the tree browser; the other tabs read inactive
  await expect(page.locator('.wb-fmt-tab-view')).not.toHaveClass(/active/);
  await expect(page.locator('#wb-tree-body')).toBeHidden();
  const lib = page.locator('#wb-lp-library');
  await expect(lib).toBeVisible();
  // the inventory comes first — empty until something is actually in use
  await expect(lib.locator('.wb-complib-h1').first()).toHaveText('In this project');
  await expect(lib.locator('.wb-complib-empty').first()).toContainText('Nothing in use yet');
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

test('an inserted component appears under "In this project"; its usage row jumps to the instance', async ({ page }) => {
  // insert Deadline chip into the view (grid → a new root column)
  await page.locator('.wb-fmt-tab-comp').click();
  await page.locator('.wb-comp-card', { hasText: 'Deadline chip' }).locator('.wb-comp-add').click();
  await page.locator('.wb-compmap .wb-compmap-insert').click();
  // the library re-renders in place: the chip is now inventory, count 1
  const used = page.locator('.wb-comp-used', { hasText: 'Deadline chip' });
  await expect(used).toBeVisible();
  await expect(used.locator('.wb-comp-count')).toHaveText('used in 1 place');
  // Show usages lists the view instance…
  await used.locator('.wb-comp-showuses').click();
  const row = used.locator('.wb-comp-usage');
  await expect(row).toHaveText('View — Deadline chip');
  // …and clicking it JUMPS there: the instance is selected on the grid canvas
  // (every mock row renders the instance, so each rendered copy highlights)
  await row.click();
  await expect(page.locator('#wb-canvas .wb-selected').first()).toBeVisible();
});

test('with a column formatter open, insertion targets IT — and the inventory shows the column usage', async ({ page }) => {
  // drill into the shared Status column style
  await header(page, 'Status').click();
  await page.locator('.wb-grid-menu button', { hasText: 'Edit the Status style' }).click();
  await expect(page.locator('.wb-doc-pill-name')).toHaveText('Status');
  // the library over an open column formatter: the dialog is honest about the destination
  await page.locator('.wb-fmt-tab-comp').click();
  await page.locator('.wb-comp-card', { hasText: 'Deadline chip' }).locator('.wb-comp-add').click();
  const dlg = page.locator('.wb-compmap');
  await expect(dlg.locator('.wb-compmap-insert')).toHaveText('Add to the Status column formatter');
  await dlg.locator('.wb-compmap-insert').click();
  await expect(page.locator('#wb-toast')).toContainText('Added Deadline chip to the Status column formatter');
  // the insert went INTO the open formatter: the canvas still shows the
  // COLUMN preview (per-row cells, not the grid) and now renders the chip
  // (row 2's due date is 3 days past → Overdue)
  await expect(page.locator('#wb-canvas .wb-mock-cell-fmt').first()).toBeVisible();
  await expect(page.locator('.wb-grid-headrow')).toHaveCount(0);
  await expect(page.locator('#wb-canvas')).toContainText('Overdue');
  // the inventory tracks it as ONE column usage
  const used = page.locator('.wb-comp-used', { hasText: 'Deadline chip' });
  await expect(used.locator('.wb-comp-count')).toHaveText('used in 1 place');
  await used.locator('.wb-comp-showuses').click();
  await expect(used.locator('.wb-comp-usage')).toHaveText('Status — column formatter');
  // one Ctrl+Z removes it from the column formatter
  await page.keyboard.press('Control+z');
  await expect(page.locator('#wb-canvas')).not.toContainText('Overdue');
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

test('the component editor: edit a slot label + a style, pin one usage as-found — one undo reverts the whole apply', async ({ page }) => {
  // package the DueDate cell as a custom component…
  await treeRow(page, 'DueDate').click({ button: 'right' });
  await page.locator('.wb-grid-menu button', { hasText: 'Save as component…' }).click();
  await page.locator('.wb-compmap .wb-compmap-name').fill('My date look');
  await page.locator('.wb-compmap .wb-compmap-insert').click();
  // …and insert it TWICE (two view usages, two new grid columns)
  await page.locator('.wb-fmt-tab-comp').click();
  await page.locator('.wb-comp-card', { hasText: 'My date look' }).locator('.wb-comp-add').click();
  await page.locator('.wb-compmap .wb-compmap-insert').click();
  const used = page.locator('.wb-comp-used', { hasText: 'My date look' });
  await used.locator('.wb-comp-addmore').click();
  await page.locator('.wb-compmap .wb-compmap-insert').click();
  await expect(used.locator('.wb-comp-count')).toHaveText('used in 2 places');

  // open the editor from the inventory card — it covers the canvas pane only,
  // the Left Edit Pane (the library) stays visible behind it
  await used.locator('.wb-comp-edit').click();
  const ce = page.locator('.wb-ce');
  await expect(ce).toBeVisible();
  await expect(page.locator('#wb-lp-library')).toBeVisible();
  // slot KEY is immutable; the LABEL (what the mapping dialog asks) is not
  await expect(ce.locator('.wb-ce-slotkey')).toHaveText('[$DueDate]');
  await ce.locator('.wb-ce-slotlabel').fill('The date to show');
  // staged style edit on the selected root: purple text (nothing else in the
  // default workspace uses #5c2d91, so the canvas assertion below is exact —
  // Chromium serializes the inline style as rgb(92, 45, 145))
  const purple = '[style*="rgb(92, 45, 145)"]';
  await ce.locator('.wb-ce-style .wb-ce-swatch[title="#5c2d91"]').first().click();
  // nothing committed yet — the canvas still has no purple anywhere
  await expect(page.locator(`#wb-canvas ${purple}`)).toHaveCount(0);

  // pin the SECOND usage "keep as-found"; the save button counts honestly
  await expect(ce.locator('.wb-ce-usage')).toHaveCount(2);
  await ce.locator('.wb-ce-usage').nth(1).locator('.wb-ce-pin').check();
  const save = ce.locator('.wb-ce-save');
  await expect(save).toHaveText('Save and apply to 1 place');
  await save.click();
  await expect(page.locator('#wb-toast')).toContainText('kept 1 as-found');

  // the unpinned instance wears the new look (once per mock row), the pinned
  // one keeps the old look — 3 purple elements, not 6
  await expect(page.locator(`#wb-canvas ${purple}`)).toHaveCount(3);
  // the as-found variant nests under its parent card with the one-off tag
  const variant = page.locator('.wb-comp-variantcard', { hasText: 'as-found' });
  await expect(variant).toBeVisible();
  await expect(variant.locator('.wb-comp-vtag')).toHaveText('as-found one-off');
  await expect(variant.locator('.wb-comp-lineage')).toContainText('Kept as-found from “My date look”');
  // the edited slot label is what the mapping dialog now asks (scope to the
  // PARENT card — the variant card's name also contains "My date look")
  const parentCard = page.locator('.wb-comp-used:not(.wb-comp-variantcard)', { hasText: 'My date look' });
  await parentCard.locator('.wb-comp-addmore').click();
  await expect(page.locator('.wb-compmap .wb-compmap-label')).toHaveText('The date to show');
  await page.locator('.wb-compmap .wb-compmap-close').click();

  // ONE Ctrl+Z reverts the WHOLE apply — re-bake and restamp together
  await page.keyboard.press('Control+z');
  await expect(page.locator(`#wb-canvas ${purple}`)).toHaveCount(0);
});

test('editing a built-in offers Save-as-new only and lands the copy under Yours', async ({ page }) => {
  await page.locator('.wb-fmt-tab-comp').click();
  await page.locator('.wb-comp-card', { hasText: 'Deadline chip' }).locator('.wb-comp-edit').click();
  const ce = page.locator('.wb-ce');
  await expect(ce).toBeVisible();
  await expect(ce.locator('.wb-ce-sub')).toContainText('built-ins can\'t be overwritten');
  // no replace/apply button — Save as new component is the ONLY save
  await expect(ce.locator('.wb-ce-foot button', { hasText: 'Save and apply' })).toHaveCount(0);
  await expect(ce.locator('.wb-ce-foot button', { hasText: /^Save$/ })).toHaveCount(0);
  await ce.locator('.wb-ce-name').fill('My chip copy');
  await ce.locator('.wb-ce-savenew').click();
  await expect(page.locator('#wb-toast')).toContainText('Saved “My chip copy” as a new component');
  await expect(page.locator('.wb-comp-card', { hasText: 'My chip copy' })).toBeVisible();
  // the built-in itself is untouched
  await expect(page.locator('.wb-comp-card', { hasText: 'Deadline chip' })).toBeVisible();
});

test('a CFR-carrying subtree is refused with teaching, not silently broken', async ({ page }) => {
  // the Status cell hosts a columnFormatterReference — not self-contained
  await treeRow(page, 'Status').click({ button: 'right' });
  await page.locator('.wb-grid-menu button', { hasText: 'Save as component…' }).click();
  await expect(page.locator('.wb-compmap')).toHaveCount(0); // no dialog
  await expect(page.locator('#wb-toast')).toContainText('must be self-contained');
});
