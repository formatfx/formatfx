/**
 * E2E: the ⬡ Components tab — first an INVENTORY of the components in use in
 * the current project ("In this project": usage-count chips, jump-to-usage
 * rows), then the add-a-component browser (Built-in / From the palette /
 * Yours / Whole rows / Bring your own). The pane speaks the tree's inventory
 * language (owner redesign 2026-07-05): one wb-tree-row-idiom ROW per
 * component with a click-to-expand details drawer — no card list. The typed
 * mapping dialog inserts wherever the canvas points — the view, or the OPEN
 * column formatter — always as one undoable step, and (issue #204) can bind
 * the component as a hover/click card on a candidate division instead.
 * "Save as component…" (element context menu) derives typed slots and
 * persists to the library across reloads; CFR-carrying subtrees are refused
 * (components are self-contained).
 */
import { test, expect, type Page, type Locator } from '@playwright/test';
import { freshApp, header } from './helpers';

test.beforeEach(async ({ page }) => { await freshApp(page, { acceptDialogs: true }); });

function treeRow(page: Page, name: string) {
  return page.locator('#wb-tree-body .wb-tree-row', { has: page.locator('.wb-tree-name', { hasText: name }) });
}

/** Every ⬡ entry is a node: a tree-idiom row + its details drawer. */
function compNode(page: Page, name: string): Locator {
  return page.locator('.wb-comp-node').filter({ has: page.locator('.wb-comp-rowname', { hasText: name }) });
}
/** The same def can appear twice (inventory above, browser below) — the
 *  usage-count chip is what tells the inventory row apart. */
function usedNode(page: Page, name: string): Locator {
  return compNode(page, name).filter({ has: page.locator('.wb-comp-count') });
}
function browseNode(page: Page, name: string): Locator {
  return compNode(page, name).filter({ hasNot: page.locator('.wb-comp-count') });
}
/** Click the row to expand its drawer (the drawer holds preview/slots/actions). */
async function openDrawer(node: Locator): Promise<Locator> {
  await node.locator('.wb-comp-row').click();
  const drawer = node.locator('.wb-comp-details');
  await expect(drawer).toBeVisible();
  return drawer;
}

test('the COMPONENTS tab opens the inventory + browser: rows in the tree idiom, no cards', async ({ page }) => {
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
  // the hand-written built-ins lead; the palette-derived offering follows
  await expect(lib.locator('.wb-complib-group', { hasText: 'Built-in' })).toBeVisible();
  await expect(lib.locator('.wb-complib-group', { hasText: 'From the palette' })).toBeVisible();
  // rows, not cards — the pane speaks the same language as the structure tree
  await expect(lib.locator('.wb-tree-row.wb-comp-row')).not.toHaveCount(0);
  await expect(lib.locator('.wb-comp-card')).toHaveCount(0);
  // the drawer carries what the cards used to: slot chips + live preview
  const drawer = await openDrawer(browseNode(page, 'Deadline chip'));
  await expect(drawer.locator('.wb-comp-slot')).toContainText(['The deadline to track · date']);
  // best-guess preview renders against the mock rows (row 1 has a future date)
  await expect(drawer.locator('.wb-comp-preview')).toContainText(/Due|Overdue/);
  // leaving via the COLUMNS tab (the grid) restores the tree browser
  await page.locator('.wb-fmt-tab-cols').click();
  await expect(page.locator('#wb-lp-library')).toBeHidden();
  await expect(page.locator('#wb-tree-body')).toBeVisible();
});

test('an inserted component appears under "In this project"; its usage row jumps to the instance', async ({ page }) => {
  // insert Deadline chip into the view (grid → a new root column)
  await page.locator('.wb-fmt-tab-comp').click();
  const drawer = await openDrawer(browseNode(page, 'Deadline chip'));
  await drawer.locator('.wb-comp-add').click();
  await page.locator('.wb-compmap .wb-compmap-insert').click();
  // the library re-renders in place: the chip is now inventory, count chip 1
  const used = usedNode(page, 'Deadline chip');
  await expect(used).toBeVisible();
  await expect(used.locator('.wb-comp-count')).toHaveText('1');
  // the drawer lists the view instance…
  const usedDrawer = await openDrawer(used);
  const row = usedDrawer.locator('.wb-comp-usage');
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
  const drawer = await openDrawer(browseNode(page, 'Deadline chip'));
  await drawer.locator('.wb-comp-add').click();
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
  const used = usedNode(page, 'Deadline chip');
  await expect(used.locator('.wb-comp-count')).toHaveText('1');
  const usedDrawer = await openDrawer(used);
  await expect(usedDrawer.locator('.wb-comp-usage')).toHaveText('Status — column formatter');
  // one Ctrl+Z removes it from the column formatter
  await page.keyboard.press('Control+z');
  await expect(page.locator('#wb-canvas')).not.toContainText('Overdue');
});

test('Add to view: the mapping dialog filters columns by slot type and inserts one undoable grid column', async ({ page }) => {
  await page.locator('.wb-fmt-tab-comp').click();
  const drawer = await openDrawer(browseNode(page, 'Deadline chip'));
  await drawer.locator('.wb-comp-add').click();
  const dlg = page.locator('.wb-compmap');
  await expect(dlg).toBeVisible();
  // the picker lists ONLY date columns — DueDate yes, Title no
  const sel = dlg.locator('.wb-compmap-select[data-slot="Due"]');
  await expect(sel.locator('option', { hasText: 'DueDate' })).toHaveCount(1);
  await expect(sel.locator('option', { hasText: 'Title' })).toHaveCount(0);
  await expect(sel).toHaveValue('DueDate'); // best guess prefilled
  // the trigger picker defaults to the plain inline insert (issue #204)
  await expect(dlg.locator('select[data-role="appear"]')).toHaveValue('inline');
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

test('the trigger picker binds a component as a HOVER CARD on a candidate division — one undo unwinds it (issue #204)', async ({ page }) => {
  // a row view gives the canvas a division that can host a card
  const gridHeader = (l: string) => page.locator('.wb-grid-header', { has: page.locator('.wb-grid-header-label', { hasText: l }) });
  await gridHeader('Title').click({ modifiers: ['Control'] });
  await gridHeader('DueDate').click({ modifiers: ['Control'] });
  await page.locator('.wb-areas-bar button', { hasText: 'Make a row view' }).click();
  await expect(page.locator('.wb-mock-viewrow')).toHaveCount(3);

  await page.locator('.wb-fmt-tab-comp').click();
  const drawer = await openDrawer(browseNode(page, 'Deadline chip'));
  await drawer.locator('.wb-comp-add').click();
  const dlg = page.locator('.wb-compmap');
  const appear = dlg.locator('select[data-role="appear"]');
  await appear.selectOption('hover-card');
  // the host + placement rows appear, with the collision fine print
  await expect(dlg.locator('select[data-role="host"]')).toBeVisible();
  await expect(dlg.locator('.wb-compmap-fine')).toContainText('never collide');
  const attach = dlg.locator('.wb-compmap-insert');
  await expect(attach).toHaveText('Attach as a hover card');
  await attach.click();
  await expect(page.locator('#wb-toast')).toContainText('opens as a hover card');
  // the canvas rows now open the card on hover (the ▣ flyout is the renderer's
  // customCardProps emulation) — hover the first row's card host
  await page.locator('.wb-mock-viewrow').first().hover();
  await expect(page.locator('.wb-flyout')).toBeVisible();
  await expect(page.locator('.wb-flyout')).toContainText(/Due|Overdue/);
  // ONE Ctrl+Z unwinds the whole binding (card props + component together)
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+z');
  await page.locator('.wb-mock-viewrow').first().hover();
  await expect(page.locator('.wb-flyout')).toHaveCount(0);
});

test('a two-slot component maps person + date independently', async ({ page }) => {
  await page.locator('.wb-fmt-tab-comp').click();
  const drawer = await openDrawer(browseNode(page, 'Assignee + deadline'));
  await drawer.locator('.wb-comp-add').click();
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
  await expect(browseNode(page, 'My date look')).toBeVisible();
  // …and survives a reload (its own additive storage key)
  await page.reload();
  await page.locator('.wb-fmt-tab-comp').click();
  const mine = browseNode(page, 'My date look');
  await expect(mine).toBeVisible();
  // delete via the row's hover actions removes it
  await mine.locator('.wb-comp-row').hover();
  await mine.locator('.wb-comp-rowdel').click();
  await expect(compNode(page, 'My date look')).toHaveCount(0);
});

test('a whole row saves as a row component and later REPLACES a view\'s layout, one undo', async ({ page }) => {
  // build a CFR-free row view: Ctrl-click plain columns, "make a row view"
  // (a template-built row carries CFR cells, which save correctly refuses —
  // components are self-contained)
  const gridHeader = (l: string) => page.locator('.wb-grid-header', { has: page.locator('.wb-grid-header-label', { hasText: l }) });
  await gridHeader('Title').click({ modifiers: ['Control'] });
  await gridHeader('DueDate').click({ modifiers: ['Control'] });
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

  // back to the grid (the COLUMNS tab — Stage 2 retired the toolbar button),
  // then use the saved row component as the layout again
  await page.locator('.wb-fmt-tab-cols').click();
  await expect(page.locator('.wb-grid-headrow')).toBeVisible();
  await page.locator('.wb-fmt-tab-comp').click();
  const mine = browseNode(page, 'My row shape'); // under Whole rows
  await expect(mine).toBeVisible();
  // a row component's row hints its scope and is NOT a drag source
  await expect(mine.locator('.wb-tree-elmtype-dim')).toHaveText('row layout');
  const drawer = await openDrawer(mine);
  await drawer.locator('.wb-comp-add').click(); // "Use as the row layout…"
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
  const mine = browseNode(page, 'Community row');
  await expect(mine).toBeVisible();
  // the unknown [$Headline] ref became an any-type slot; using the layout maps it
  const drawer = await openDrawer(mine);
  await drawer.locator('.wb-comp-add').click();
  const map = page.locator('.wb-compmap');
  const sel = map.locator('.wb-compmap-select[data-slot="Headline"]');
  await expect(sel.locator('option', { hasText: 'Title' })).toHaveCount(1); // any type ⇒ all columns offered
  await sel.selectOption('Title');
  await map.locator('.wb-compmap-insert').click();
  await expect(page.locator('.wb-mock-viewrow').first()).toContainText('Launch new intranet');
});

test('saving over an existing name replaces the component instead of duplicating it', async ({ page }) => {
  const save = async (name: string) => {
    await treeRow(page, 'DueDate').click({ button: 'right' });
    await page.locator('.wb-grid-menu button', { hasText: 'Save as component…' }).click();
    await page.locator('.wb-compmap .wb-compmap-name').fill(name);
    await page.locator('.wb-compmap .wb-compmap-insert').click();
  };
  await save('Same look');
  await save('Same look');
  await expect(page.locator('#wb-toast')).toContainText('Replaced “Same look”');
  await page.locator('.wb-fmt-tab-comp').click();
  await expect(compNode(page, 'Same look')).toHaveCount(1);
});

test('the component editor: edit a slot label + a style, pin one usage as-found — one undo reverts the whole apply', async ({ page }) => {
  // package the DueDate cell as a custom component…
  await treeRow(page, 'DueDate').click({ button: 'right' });
  await page.locator('.wb-grid-menu button', { hasText: 'Save as component…' }).click();
  await page.locator('.wb-compmap .wb-compmap-name').fill('My date look');
  await page.locator('.wb-compmap .wb-compmap-insert').click();
  // …and insert it TWICE (two view usages, two new grid columns)
  await page.locator('.wb-fmt-tab-comp').click();
  await (await openDrawer(browseNode(page, 'My date look'))).locator('.wb-comp-add').click();
  await page.locator('.wb-compmap .wb-compmap-insert').click();
  // (the library re-rendered — drawers reset, re-open the inventory row)
  await (await openDrawer(usedNode(page, 'My date look'))).locator('.wb-comp-addmore').click();
  await page.locator('.wb-compmap .wb-compmap-insert').click();
  const used = usedNode(page, 'My date look');
  await expect(used.locator('.wb-comp-count')).toHaveText('2');

  // open the editor from the inventory row — it covers the canvas pane only,
  // the Left Edit Pane (the library) stays visible behind it
  await used.locator('.wb-comp-row').hover();
  await used.locator('.wb-comp-rowedit').click();
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
  // the as-found variant nests (indented) under its parent row with the tag
  const variant = page.locator('.wb-comp-variantnode');
  await expect(variant).toBeVisible();
  await expect(variant.locator('.wb-comp-vtag')).toHaveText('as-found');
  const variantDrawer = await openDrawer(variant);
  await expect(variantDrawer.locator('.wb-comp-lineage')).toContainText('Kept as-found from “My date look”');
  // the edited slot label is what the mapping dialog now asks (scope to the
  // PARENT row — the variant's name also contains "My date look")
  const parent = page.locator('.wb-comp-node:not(.wb-comp-variantnode)')
    .filter({ has: page.locator('.wb-comp-rowname', { hasText: 'My date look' }) })
    .filter({ has: page.locator('.wb-comp-count') });
  await (await openDrawer(parent)).locator('.wb-comp-addmore').click();
  await expect(page.locator('.wb-compmap .wb-compmap-label').first()).toHaveText('The date to show');
  await page.locator('.wb-compmap .wb-compmap-close').click();

  // ONE Ctrl+Z reverts the WHOLE apply — re-bake and restamp together
  await page.keyboard.press('Control+z');
  await expect(page.locator(`#wb-canvas ${purple}`)).toHaveCount(0);
});

test('editing a built-in offers Save-as-new only and lands the copy under Yours', async ({ page }) => {
  await page.locator('.wb-fmt-tab-comp').click();
  const drawer = await openDrawer(browseNode(page, 'Deadline chip'));
  await drawer.locator('.wb-comp-edit').click();
  const ce = page.locator('.wb-ce');
  await expect(ce).toBeVisible();
  await expect(ce.locator('.wb-ce-sub')).toContainText('built-ins can\'t be overwritten');
  // no replace/apply button — Save as new component is the ONLY save
  await expect(ce.locator('.wb-ce-foot button', { hasText: 'Save and apply' })).toHaveCount(0);
  await expect(ce.locator('.wb-ce-foot button', { hasText: /^Save$/ })).toHaveCount(0);
  await ce.locator('.wb-ce-name').fill('My chip copy');
  await ce.locator('.wb-ce-savenew').click();
  await expect(page.locator('#wb-toast')).toContainText('Saved “My chip copy” as a new component');
  await expect(browseNode(page, 'My chip copy')).toBeVisible();
  // the built-in itself is untouched
  await expect(browseNode(page, 'Deadline chip')).toBeVisible();
});

test('a CFR-carrying subtree is refused with teaching, not silently broken', async ({ page }) => {
  // the Status cell hosts a columnFormatterReference — not self-contained
  await treeRow(page, 'Status').click({ button: 'right' });
  await page.locator('.wb-grid-menu button', { hasText: 'Save as component…' }).click();
  await expect(page.locator('.wb-compmap')).toHaveCount(0); // no dialog
  await expect(page.locator('#wb-toast')).toContainText('must be self-contained');
});

test('palette components: offered in the library, draggable straight onto the canvas', async ({ page }) => {
  await page.locator('.wb-fmt-tab-comp').click();
  const lib = page.locator('#wb-lp-library');
  // the palette-derived offering sits beside the built-ins, live-previewed
  await expect(lib.locator('.wb-complib-group', { hasText: 'From the palette' })).toBeVisible();
  const faces = browseNode(page, 'Facepile');
  await expect(faces).toBeVisible();
  const drawer = await openDrawer(faces);
  await expect(drawer.locator('.wb-comp-slot')).toContainText(['AssignedTo · multi-person / person']);
  await expect(drawer.locator('.wb-comp-preview img').first()).toBeVisible(); // best-guess preview renders avatars

  // the palette gesture, generalized: drag the ROW onto a grid cell — the
  // best guess completes against the default schema, so it lands right there
  await faces.locator('.wb-comp-row').dragTo(page.locator('.wb-grid-cell[data-col="0"]').first());
  await expect(page.locator('#wb-toast')).toContainText('Added "Facepile"');

  // provenance-stamped on drop → the ⬡ inventory counts the usage
  await page.locator('.wb-fmt-tab-cols').click(); // leave the library (re-enter re-scans)
  await page.locator('.wb-fmt-tab-comp').click();
  await expect(usedNode(page, 'Facepile').locator('.wb-comp-count')).toHaveText('1');

  // back on the grid the instance sits in the tree; one Ctrl+Z reverts the drop
  await page.locator('.wb-fmt-tab-cols').click();
  await expect(treeRow(page, 'Facepile')).toBeVisible();
  await page.keyboard.press('Control+z');
  await expect(treeRow(page, 'Facepile')).toHaveCount(0);
});

test('component editor: modal-local ↶↷ over element edits; text fields stay native', async ({ page }) => {
  await page.locator('.wb-fmt-tab-comp').click();
  const drawer = await openDrawer(browseNode(page, 'Deadline chip'));
  await drawer.locator('.wb-comp-edit').click();
  const ce = page.locator('.wb-ce');
  await expect(ce).toBeVisible();
  await expect(ce.locator('.wb-mu-undo')).toBeDisabled(); // bottoms out at open
  // a style gesture on the selected root = one local step, live in the preview
  const purple = '[style*="rgb(92, 45, 145)"]';
  await ce.locator('.wb-ce-style .wb-ce-swatch[title="#5c2d91"]').first().click();
  await expect(ce.locator(`.wb-ce-preview ${purple}`)).not.toHaveCount(0);
  await ce.locator('.wb-mu-undo').click();
  await expect(ce.locator(`.wb-ce-preview ${purple}`)).toHaveCount(0);
  await ce.locator('.wb-mu-redo').click();
  await expect(ce.locator(`.wb-ce-preview ${purple}`)).not.toHaveCount(0);
  // nothing reached the document or the app stack — staged means staged
  await expect(page.locator('.wb-tool-undo')).toBeDisabled();
  await ce.locator('.wb-ce-close').click(); // dirty → confirm, auto-accepted
  await expect(ce).not.toBeVisible();
});
