/**
 * E2E: the ⬡ Components library — ALWAYS visible in the left pane (the old
 * tab-swap mode died with the formatter tabs): first the project INVENTORY
 * ("In this project": usage-count chips, jump-to-usage rows — column LOOKS
 * count as usages), then the add-a-component browser (Built-in / From the
 * palette / Yours / Whole rows / Bring your own). One wb-tree-row-idiom ROW
 * per component with a click-to-expand details drawer. The typed mapping
 * dialog inserts into the active view (a new grid column on the grid), can
 * bind the component as a hover/click card on a candidate division, and
 * saving over an existing name replaces the def AND re-bakes every column
 * wearing it. "Save as component…" (element context menu / column header
 * menu) derives typed slots and persists across reloads; imported JSON
 * carrying a columnFormatterReference is refused (components are
 * self-contained — nothing resolves references anymore).
 */
import { test, expect, type Page, type Locator } from '@playwright/test';
import { freshApp, header, canvasTab, openGridTab, makeRowView, expectAppUndoDisabled, stageWorkshopColor } from './helpers';

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

test('the library is always on: inventory first, then the browser — rows in the tree idiom, no cards', async ({ page }) => {
  const lib = page.locator('#wb-lp-library');
  // no tab to click — the library is a standing left-pane section, beside the
  // tree (which keeps rendering the active surface)
  await expect(lib).toBeVisible();
  await expect(page.locator('#wb-tree-body')).toBeVisible();
  // the inventory comes first — the showcase columns wear looks, so their
  // components already count as usages
  await expect(lib.locator('.wb-complib-foldhead .wb-lp-sec-title').first()).toHaveText('In this project');
  await expect(usedNode(page, 'Status pill').locator('.wb-comp-count')).toHaveText('2');
  // the hand-written built-ins lead the browser; the palette offering follows
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
});

test('an inserted component appears under "In this project"; its usage row jumps to the instance', async ({ page }) => {
  // insert Deadline chip into the view (grid → a new root column)
  const drawer = await openDrawer(browseNode(page, 'Deadline chip'));
  await drawer.locator('.wb-comp-add').click();
  await page.locator('.wb-compmap .wb-compmap-insert').click();
  await expect(page.locator('#wb-toast')).toContainText('Added Deadline chip as a new grid column');
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

test('a column LOOK counts as a usage; its inventory row says so and jumps to the grid column', async ({ page }) => {
  // dress DueDate by applying Deadline chip from its header menu
  await header(page, 'DueDate').click();
  await page.locator('.wb-grid-menu button', { hasText: 'Apply a component…' }).click();
  await page.locator('.wb-grid-menu button', { hasText: 'Deadline chip' }).click();
  await expect(header(page, 'DueDate').locator('.wb-grid-look')).toHaveCount(1);
  // the inventory tracks the dressed column TWICE while the grid is up: the
  // look store entry AND the floor cell that embeds a stamped clone of it —
  // the placed cell IS an instance in the document (§1: looks are embedded)
  const used = usedNode(page, 'Deadline chip');
  await expect(used.locator('.wb-comp-count')).toHaveText('2');
  const usedDrawer = await openDrawer(used);
  await expect(usedDrawer.locator('.wb-comp-usage', { hasText: 'DueDate — column look' })).toHaveCount(1);
  // the column-look jump row selects the dressed grid column
  await usedDrawer.locator('.wb-comp-usage', { hasText: 'column look' }).click();
  await expect(page.locator('#wb-canvas .wb-selected').first()).toBeVisible();
  // one Ctrl+Z takes the look off again — the inventory row empties out
  await page.keyboard.press('Control+z');
  await expect(usedNode(page, 'Deadline chip')).toHaveCount(0);
});

test('Add to view: the mapping dialog filters columns by slot type and inserts one undoable grid column', async ({ page }) => {
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
  await makeRowView(page, ['Title', 'DueDate']);
  await expect(page.locator('.wb-mock-viewrow')).toHaveCount(3);

  const drawer = await openDrawer(browseNode(page, 'Deadline chip'));
  await drawer.locator('.wb-comp-add').click();
  const dlg = page.locator('.wb-compmap');
  const appear = dlg.locator('select[data-role="appear"]');
  await appear.selectOption('hover-card');
  // the host + placement rows appear, with the collision fine print
  await expect(dlg.locator('select[data-role="host"]')).toBeVisible();
  await expect(dlg.locator('.wb-compmap-fine')).toContainText('never collide');
  // the drop-target gesture: point at the host on the CANVAS — the dialog
  // steps aside, candidates glow teal, a click picks one
  await dlg.locator('.wb-compmap-pick').click();
  await expect(dlg).toBeHidden();
  const candidate = page.locator('#wb-canvas .wb-trigger-candidate').first();
  await expect(candidate).toBeVisible();
  await candidate.click();
  await expect(dlg).toBeVisible();
  await expect(page.locator('.wb-trigger-candidate')).toHaveCount(0);
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
  // it shows under Yours, and survives a reload (its own additive storage key)
  await expect(browseNode(page, 'My date look')).toBeVisible();
  await page.reload();
  const mine = browseNode(page, 'My date look');
  await expect(mine).toBeVisible();
  // delete via the row's hover actions removes it
  await mine.locator('.wb-comp-row').hover();
  await mine.locator('.wb-comp-rowdel').click();
  await expect(compNode(page, 'My date look')).toHaveCount(0);
});

test('a whole row saves as a row component and later REPLACES a view\'s layout, one undo', async ({ page }) => {
  await makeRowView(page, ['Title', 'DueDate']);
  await expect(page.locator('.wb-mock-viewrow')).toHaveCount(3);

  // save the ROOT row as a component — right-click the tree's root row
  await page.locator('#wb-tree-body .wb-tree-row').first().click({ button: 'right' });
  await page.locator('.wb-grid-menu button', { hasText: 'Save as component…' }).click();
  const dlg = page.locator('.wb-compmap');
  await expect(dlg.locator('.wb-compmap-note')).toContainText('WHOLE row layout');
  await dlg.locator('.wb-compmap-name').fill('My row shape');
  await dlg.locator('.wb-compmap-insert').click();
  await expect(page.locator('#wb-toast')).toContainText('Saved “My row shape”');

  // back to the grid (the standing tab), then use the saved row component
  await openGridTab(page);
  await expect(page.locator('.wb-grid-headrow')).toBeVisible();
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

test('Import from formatter JSON: a pasted rowFormatter becomes a mappable row component; bad JSON and CFRs teach', async ({ page }) => {
  await page.locator('.wb-comp-rowlink', { hasText: 'Import from formatter JSON' }).click();
  const dlg = page.locator('.wb-compmap');
  // refuse-and-teach on junk
  await dlg.locator('.wb-compmap-json').fill('{not json');
  await dlg.locator('.wb-compmap-insert').click();
  await expect(dlg.locator('.wb-compmap-error')).toContainText('Invalid JSON');
  // refuse-and-teach on a columnFormatterReference — components are
  // self-contained, and nothing resolves references anymore
  await dlg.locator('.wb-compmap-json').fill(JSON.stringify({
    rowFormatter: {
      elmType: 'div',
      children: [{ elmType: 'div', columnFormatterReference: '[$Ghost]' }],
    },
  }));
  await dlg.locator('.wb-compmap-insert').click();
  await expect(dlg.locator('.wb-compmap-error')).toContainText('self-contained');
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

test('saving over an existing name replaces the component and re-bakes every column wearing it', async ({ page }) => {
  // package Status's look as "My pill", then dress Status in it
  await header(page, 'Status').click();
  await page.locator('.wb-grid-menu button', { hasText: 'Save as component…' }).click();
  await page.locator('.wb-compmap .wb-compmap-name').fill('My pill');
  await page.locator('.wb-compmap .wb-compmap-insert').click();
  await header(page, 'Status').click();
  await page.locator('.wb-grid-menu button', { hasText: 'Remove the look' }).click();
  await header(page, 'Status').click();
  await page.locator('.wb-grid-menu button', { hasText: 'Apply a component…' }).click();
  await page.locator('.wb-grid-menu button', { hasText: 'My pill' }).click();
  await expect(header(page, 'Status').locator('.wb-grid-look')).toHaveAttribute('title', /My pill/);

  // saving the (restyled) look under the SAME name replaces the def and
  // re-bakes the wearing column — one toast says exactly that
  await header(page, 'Status').click();
  await page.locator('.wb-grid-menu button', { hasText: 'Save as component…' }).click();
  await page.locator('.wb-compmap .wb-compmap-name').fill('My pill');
  await page.locator('.wb-compmap .wb-compmap-insert').click();
  await expect(page.locator('#wb-toast')).toContainText('Replaced “My pill” and re-baked the 1 column wearing it');
  // still exactly one "My pill" DEF — replaced, not duplicated (it renders
  // once in the inventory and once in the Yours browser group)
  await expect(usedNode(page, 'My pill')).toHaveCount(1);
  await expect(browseNode(page, 'My pill')).toHaveCount(1);
});

test('the workshop: edit a slot label + a style, pin one usage as-found — one undo reverts the whole apply', async ({ page }) => {
  // package the DueDate cell as a custom component…
  await treeRow(page, 'DueDate').click({ button: 'right' });
  await page.locator('.wb-grid-menu button', { hasText: 'Save as component…' }).click();
  await page.locator('.wb-compmap .wb-compmap-name').fill('My date look');
  await page.locator('.wb-compmap .wb-compmap-insert').click();
  // …and insert it TWICE (two view usages, two new grid columns)
  await (await openDrawer(browseNode(page, 'My date look'))).locator('.wb-comp-add').click();
  await page.locator('.wb-compmap .wb-compmap-insert').click();
  // (the library re-rendered — drawers reset, re-open the inventory row)
  await (await openDrawer(usedNode(page, 'My date look'))).locator('.wb-comp-addmore').click();
  await page.locator('.wb-compmap .wb-compmap-insert').click();
  const used = usedNode(page, 'My date look');
  await expect(used.locator('.wb-comp-count')).toHaveText('2');

  // open the WORKSHOP from the inventory row — it covers the canvas as a tab;
  // the left pane (the library) stays visible beside it
  await used.locator('.wb-comp-row').hover();
  await used.locator('.wb-comp-rowedit').click();
  const ce = page.locator('#wb-workshop .wb-ce');
  await expect(ce).toBeVisible();
  await expect(canvasTab(page, 'My date look')).toHaveClass(/active/);
  await expect(page.locator('#wb-lp-library')).toBeVisible();
  // slot KEY is immutable; the LABEL (what the mapping dialog asks) is not
  await expect(ce.locator('.wb-ce-slotkey')).toHaveText('[$DueDate]');
  await ce.locator('.wb-ce-slotlabel').fill('The date to show');
  // staged style edit on the selected root: purple text (nothing else in the
  // default workspace uses #5c2d91, so the canvas assertion below is exact —
  // Chromium serializes the inline style as rgb(92, 45, 145))
  const purple = '[style*="rgb(92, 45, 145)"]';
  await stageWorkshopColor(page, '#5c2d91');

  // pin the SECOND usage "keep as-found"; the save button counts honestly
  await expect(ce.locator('.wb-ce-usage')).toHaveCount(2);
  await ce.locator('.wb-ce-usage').nth(1).locator('.wb-ce-pin').check();
  const save = ce.locator('.wb-ce-save');
  await expect(save).toHaveText('Save and apply to 1 place');
  await save.click();
  await expect(page.locator('#wb-toast')).toContainText('kept 1 as-found');

  // back on the grid: the unpinned instance wears the new look (once per mock
  // row), the pinned one keeps the old look — 3 purple elements, not 6
  await openGridTab(page);
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

test('live nesting cascade (#225): saving a CHILD re-bakes every parent that embeds it on the canvas, one undo', async ({ page }) => {
  // package two plain grid cells as custom components — a CHILD and a PARENT
  await treeRow(page, 'DueDate').click({ button: 'right' });
  await page.locator('.wb-grid-menu button', { hasText: 'Save as component…' }).click();
  await page.locator('.wb-compmap .wb-compmap-name').fill('Childlook');
  await page.locator('.wb-compmap .wb-compmap-insert').click();
  await expect(page.locator('#wb-toast')).toContainText('Saved “Childlook”');

  await treeRow(page, 'Title').click({ button: 'right' });
  await page.locator('.wb-grid-menu button', { hasText: 'Save as component…' }).click();
  await page.locator('.wb-compmap .wb-compmap-name').fill('Parentlook');
  await page.locator('.wb-compmap .wb-compmap-insert').click();
  await expect(page.locator('#wb-toast')).toContainText('Saved “Parentlook”');

  // embed the child INSIDE the parent (composition at the definition layer),
  // then Save (the parent has no usages yet — the replace-only path)
  await (await openDrawer(browseNode(page, 'Parentlook'))).locator('.wb-comp-edit').click();
  let ce = page.locator('#wb-workshop .wb-ce');
  await expect(ce).toBeVisible();
  await ce.locator('.wb-ce-embedpick').selectOption({ label: 'Childlook' });
  await ce.locator('.wb-ce-embedadd').click();
  await expect(page.locator('#wb-toast')).toContainText('Embedded “Childlook”');
  await ce.locator('.wb-ce-save').click();
  await expect(page.locator('#wb-toast')).toContainText('Saved “Parentlook”');

  // apply the PARENT to the grid — one new column whose cells render the
  // embedded child too (best-guess fills the parent's Title slot AND the
  // child's surfaced, namespaced date slot)
  await openGridTab(page);
  await (await openDrawer(browseNode(page, 'Parentlook'))).locator('.wb-comp-add').click();
  const dlg = page.locator('.wb-compmap');
  await expect(dlg).toBeVisible();
  await dlg.locator('.wb-compmap-insert').click();
  await expect(dlg).toHaveCount(0);

  // nothing purple on the canvas yet
  const purple = '[style*="rgb(92, 45, 145)"]';
  await expect(page.locator(`#wb-canvas ${purple}`)).toHaveCount(0);

  // edit the CHILD — purple its text — and Save. The child has NO direct usages
  // (only the parent embeds it), so the save runs the replace-only path, whose
  // cascade must still reach the parent instance living on the grid
  await (await openDrawer(browseNode(page, 'Childlook'))).locator('.wb-comp-edit').click();
  ce = page.locator('#wb-workshop .wb-ce');
  await expect(ce).toBeVisible();
  await stageWorkshopColor(page, '#5c2d91');
  await ce.locator('.wb-ce-save').click();
  await expect(page.locator('#wb-toast')).toContainText('refreshed 1 place');

  // the parent column re-baked LIVE — its cells now wear the child's new purple
  // look (once per mock row), without ever reopening the parent
  await openGridTab(page);
  await expect(page.locator(`#wb-canvas ${purple}`)).not.toHaveCount(0);

  // ONE Ctrl+Z reverts the whole cascade
  await page.keyboard.press('Control+z');
  await expect(page.locator(`#wb-canvas ${purple}`)).toHaveCount(0);
});

test('editing a built-in offers Save-as-new only; the tab swaps onto the copy under Yours', async ({ page }) => {
  const drawer = await openDrawer(browseNode(page, 'Deadline chip'));
  await drawer.locator('.wb-comp-edit').click();
  const ce = page.locator('#wb-workshop .wb-ce');
  await expect(ce).toBeVisible();
  await expect(ce.locator('.wb-ce-sub')).toContainText('built-ins can\'t be overwritten');
  // no replace/apply button — Save as new component is the ONLY save
  await expect(ce.locator('.wb-ce-foot button', { hasText: 'Save and apply' })).toHaveCount(0);
  await ce.locator('.wb-ce-name').fill('My chip copy');
  await ce.locator('.wb-ce-savenew').click();
  await expect(page.locator('#wb-toast')).toContainText('Saved “My chip copy” as a new component');
  // the maker keeps editing THEIR component: the tab swapped onto the copy
  await expect(canvasTab(page, 'My chip copy')).toHaveClass(/active/);
  await expect(browseNode(page, 'My chip copy')).toBeVisible();
  // the built-in itself is untouched
  await expect(browseNode(page, 'Deadline chip')).toBeVisible();
});

test('a ⬡ row dragged onto a grid column applies its look there (the drop twin of "Apply a component…")', async ({ page }) => {
  // Facepile fits a multi-person column — drop its library row onto AssignedTo
  const faces = browseNode(page, 'Facepile');
  await faces.locator('.wb-comp-row')
    .dragTo(page.locator('.wb-grid-cell[data-col="4"]').first());
  await expect(page.locator('#wb-toast')).toContainText('Applied Facepile to AssignedTo');
  // the column is dressed: ⬡ header mark + avatars in the cells
  await expect(header(page, 'AssignedTo').locator('.wb-grid-look')).toHaveCount(1);
  await expect(page.locator('.wb-grid-row').first().locator('.wb-grid-cell[data-col="4"] img').first())
    .toBeVisible();
  // the inventory counts the dressed column (look store + the embedded cell)
  await expect(usedNode(page, 'Facepile').locator('.wb-comp-count')).toHaveText('2');
  // one Ctrl+Z undresses the column again
  await page.keyboard.press('Control+z');
  await expect(header(page, 'AssignedTo').locator('.wb-grid-look')).toHaveCount(0);
  await expect(usedNode(page, 'Facepile')).toHaveCount(0);
});

test('workshop: modal-local ↶↷ over element edits; staged means staged (the app stack never hears)', async ({ page }) => {
  const drawer = await openDrawer(browseNode(page, 'Deadline chip'));
  await drawer.locator('.wb-comp-edit').click();
  const ce = page.locator('#wb-workshop .wb-ce');
  await expect(ce).toBeVisible();
  await expect(ce.locator('.wb-mu-undo')).toBeDisabled(); // bottoms out at open
  // a style gesture on the selected root = one local step, live in the preview
  const purple = '[style*="rgb(92, 45, 145)"]';
  await stageWorkshopColor(page, '#5c2d91');
  await expect(ce.locator(`.wb-ce-preview ${purple}`)).not.toHaveCount(0);
  await ce.locator('.wb-mu-undo').click();
  await expect(ce.locator(`.wb-ce-preview ${purple}`)).toHaveCount(0);
  await ce.locator('.wb-mu-redo').click();
  await expect(ce.locator(`.wb-ce-preview ${purple}`)).not.toHaveCount(0);
  // nothing reached the document or the app stack — staged means staged
  await expectAppUndoDisabled(page);
  // closing the dirty tab asks (auto-accepted) and discards
  await canvasTab(page, 'Deadline chip').locator('.wb-canvastab-close').click();
  await expect(ce).not.toBeVisible();
});

test('legacy wb-subtypes customs migrate one-way into the library as "Yours"', async ({ page }) => {
  // seed a LEGACY maker-authored subtype into the retired wb-subtypes store
  await page.evaluate(() => {
    localStorage.removeItem('wb-components.subtypes-migrated.v1');
    localStorage.setItem('wb-subtypes', JSON.stringify({
      version: 1,
      subtypes: [{
        id: 'custom-due-1', name: 'My Due Look', origin: 'custom', baseTypes: ['date'],
        formatter: { elmType: 'div', txtContent: '=toLocaleDateString(@currentField)' },
        knobs: [], vocab: { refs: ['@currentField'], values: [] },
      }],
    }));
  });
  await page.reload();
  // the migrated custom reads as one of Yours in the library…
  await expect(browseNode(page, 'My Due Look')).toBeVisible();
  // …and the apply catalog of a fitting (date) column offers it, badged Yours
  await header(page, 'DueDate').click();
  await page.locator('.wb-grid-menu button', { hasText: 'Apply a component…' }).click();
  const mine = page.locator('.wb-grid-menu button', { hasText: 'My Due Look' });
  await expect(mine.locator('.wb-menu-badge')).toHaveText('Yours');
  await mine.click();
  await expect(header(page, 'DueDate').locator('.wb-grid-look')).toHaveCount(1);
});


