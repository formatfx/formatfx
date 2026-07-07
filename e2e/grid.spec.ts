/**
 * E2E: the grid-first workspace — the header menu's LOOK gestures (apply /
 * change / remove a component, the ONE way a column gets formatting), hide /
 * add column, drag to reorder/group, compiled column-JSON export, element
 * right-click menus, and the element-level Format cells / conditional
 * formatting dialogs (their per-column header routes died with the CFR model).
 * One undoable document mutation per gesture.
 */
import { test, expect } from '@playwright/test';
import { freshApp, header, canvasTab, openJson } from './helpers';

// dialogs accepted: applying name-less JSON over a named design asks first
test.beforeEach(async ({ page }) => { await freshApp(page, { acceptDialogs: true }); });

const HEADERS = ['Title', 'Status', 'DueDate', 'Progress', 'AssignedTo', 'Project'];

test('apply a component end-to-end: type-fitting catalog, badged; the column dresses; one Ctrl+Z undoes', async ({ page }) => {
  // DueDate ships bare — no ⬡ mark, plain date text
  await expect(header(page, 'DueDate').locator('.wb-grid-look')).toHaveCount(0);
  await header(page, 'DueDate').click();
  const menu = page.locator('.wb-grid-menu');
  await expect(menu.locator('.wb-grid-menu-title')).toHaveText('DueDate');
  await menu.locator('button', { hasText: 'Apply a component…' }).click();
  // the catalog thinks in types: date-fitting components only, badged
  await expect(page.locator('.wb-grid-menu-title')).toHaveText('Apply a component to DueDate');
  const chip = page.locator('.wb-grid-menu button', { hasText: 'Deadline chip' });
  await expect(chip.locator('.wb-menu-badge')).toHaveText('Built-in');
  await expect(page.locator('.wb-grid-menu button', { hasText: 'Facepile' })).toHaveCount(0);
  await chip.click();
  await expect(page.locator('#wb-toast')).toContainText('Applied Deadline chip to DueDate');
  // the column wears the look: ⬡ mark on the header, the cell renders it
  await expect(header(page, 'DueDate').locator('.wb-grid-look')).toHaveCount(1);
  await expect(page.locator('.wb-grid-row').first().locator('.wb-grid-cell[data-col="2"]'))
    .toContainText(/Due|Overdue/);
  // ONE undo removes look + cell rewrite together
  await page.keyboard.press('Control+z');
  await expect(header(page, 'DueDate').locator('.wb-grid-look')).toHaveCount(0);
  await expect(page.locator('.wb-grid-row').first().locator('.wb-grid-cell[data-col="2"]'))
    .not.toContainText(/Due |Overdue/);
});

test('change the component: the mapper re-aims a worn look\'s OTHER slots (the worn column stays pinned)', async ({ page }) => {
  // dress DueDate in a two-slot component by DROPPING it (multi-slot defs
  // arrive by drop — the catalog menu carries single-slot fits only)
  const node = page.locator('.wb-comp-node')
    .filter({ has: page.locator('.wb-comp-rowname', { hasText: 'Assignee + deadline' }) }).first();
  await node.locator('.wb-comp-row').dragTo(page.locator('.wb-grid-cell[data-col="2"]').first());
  await expect(page.locator('#wb-toast')).toContainText('Applied Assignee + deadline to DueDate');
  // best-guess filled the Person slot with AssignedTo (row 2: Linus T)
  const row2cell = page.locator('.wb-grid-row').nth(1).locator('.wb-grid-cell[data-col="2"]');
  await expect(row2cell).toContainText('Linus T');

  // "Change the component…" reopens the mapper aimed at the column: the slot
  // the column fills is PINNED (a look must render the column it's applied
  // to), the other slots re-map freely
  await header(page, 'DueDate').click();
  await page.locator('.wb-grid-menu button', { hasText: 'Change the component…' }).click();
  const dlg = page.locator('.wb-compmap');
  await expect(dlg).toBeVisible();
  await expect(dlg.locator('.wb-compmap-select[data-slot="Due"]')).toBeDisabled();
  await dlg.locator('.wb-compmap-select[data-slot="Person"]').selectOption('Owner');
  await dlg.locator('.wb-compmap-insert').click();
  // the look re-baked: row 2 now shows its Owner (store + cell together)
  await expect(row2cell).toContainText('Grace Hopper');
  await page.keyboard.press('Control+z');
  await expect(row2cell).toContainText('Linus T');
});

test('remove the look: back to the plain value, ⬡ mark gone; one Ctrl+Z restores both', async ({ page }) => {
  await header(page, 'Status').click();
  await page.locator('.wb-grid-menu button', { hasText: 'Remove the look' }).click();
  await expect(page.locator('#wb-toast')).toContainText('Removed the look from Status');
  await expect(header(page, 'Status').locator('.wb-grid-look')).toHaveCount(0);
  // the plain choice value, no pill styling
  const cell = page.locator('.wb-grid-row').first().locator('.wb-grid-cell[data-col="1"]');
  await expect(cell).toContainText('In Progress');
  await expect(cell.locator('[style*="border-radius"]')).toHaveCount(0);
  // a bare column's menu flips to the apply on-ramp
  await header(page, 'Status').click();
  await expect(page.locator('.wb-grid-menu button', { hasText: 'Apply a component…' })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+z');
  await expect(header(page, 'Status').locator('.wb-grid-look')).toHaveCount(1);
  await expect(cell.locator('[style*="border-radius"]').first()).toBeVisible();
});

test('save a look as YOUR component, then apply it to another column (the reuse loop)', async ({ page }) => {
  // package Status's look — the dialog derives a typed slot from the recipe
  await header(page, 'Status').click();
  await page.locator('.wb-grid-menu button', { hasText: 'Save as component…' }).click();
  const dlg = page.locator('.wb-compmap');
  await expect(dlg.locator('.wb-comp-slot')).toContainText(['Status · choice / multi-choice']);
  await dlg.locator('.wb-compmap-name').fill('My pill');
  await dlg.locator('.wb-compmap-insert').click();
  await expect(page.locator('#wb-toast')).toContainText('Saved “My pill”');
  // it persists to the additive components key with the derived slot
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('wb-components.v1') || '{}'));
  const mine = stored.components.find((c: { name: string }) => c.name === 'My pill');
  expect(mine.slots).toHaveLength(1);
  expect(mine.slots[0].types).toContain('choice');
  // …and the apply catalog of a fitting column now offers it, badged Yours
  await header(page, 'Status').click();
  await page.locator('.wb-grid-menu button', { hasText: 'Remove the look' }).click();
  await header(page, 'Status').click();
  await page.locator('.wb-grid-menu button', { hasText: 'Apply a component…' }).click();
  const yours = page.locator('.wb-grid-menu button', { hasText: 'My pill' });
  await expect(yours.locator('.wb-menu-badge')).toHaveText('Yours');
  await yours.click();
  await expect(header(page, 'Status').locator('.wb-grid-look')).toHaveAttribute('title', /My pill/);
});

test('hide column is one undoable mutation; "+ column" re-adds fields, dressed ones arrive dressed', async ({ page }) => {
  await header(page, 'Status').click();
  await page.locator('.wb-grid-menu button', { hasText: 'Hide column' }).click();
  await expect(page.locator('.wb-grid-header-label')).toHaveText(HEADERS.filter((h) => h !== 'Status'));
  await page.keyboard.press('Control+z');
  await expect(page.locator('.wb-grid-header-label')).toHaveText(HEADERS);

  // Owner is dressed-but-unplaced: adding it renders its Persona look
  await page.locator('.wb-grid-addcol').click();
  await page.locator('.wb-grid-menu button', { hasText: 'Owner · formatted' }).click();
  await expect(page.locator('.wb-grid-header-label')).toHaveText([...HEADERS, 'Owner']);
  await expect(header(page, 'Owner').locator('.wb-grid-look')).toHaveCount(1);
  await expect(page.locator('.wb-grid-row').first().locator('img').first()).toBeVisible(); // avatar
});

test('drop one column ONTO another → named row-formatter scaffolding, one undo step', async ({ page }) => {
  // drag DueDate onto Status (center = group zone)
  await header(page, 'DueDate').dragTo(header(page, 'Status'));
  await expect(page.locator('#wb-toast')).toContainText('Status + DueDate group');
  // the grid stays a grid — other columns untouched, the group takes one slot
  await expect(page.locator('.wb-grid-header-label')).toHaveText(
    ['Title', 'Status + DueDate group', 'Progress', 'AssignedTo', 'Project']);
  // generated structure arrives fully named in the tree
  await expect(page.locator('.wb-tree-name', { hasText: 'Status + DueDate group' })).toBeVisible();
  // both columns render stacked inside the group's cell (pill + date)
  const groupCell = page.locator('.wb-grid-row').first().locator('.wb-grid-cell').nth(1);
  await expect(groupCell).toContainText('In Progress');
  await expect(groupCell.locator('[data-sp-path="1"]')).toHaveCSS('flex-direction', 'column');
  // ONE undo step restores the flat grid
  await page.keyboard.press('Control+z');
  await expect(page.locator('.wb-grid-header-label')).toHaveText(HEADERS);

  // group again and dissolve via the header menu instead
  await header(page, 'DueDate').dragTo(header(page, 'Status'));
  await header(page, 'Status + DueDate group').click();
  await page.locator('.wb-grid-menu button', { hasText: 'Ungroup' }).click();
  await expect(page.locator('.wb-grid-header-label')).toHaveText(HEADERS);
});

test('drag a header to another header\'s edge → reorder, not group', async ({ page }) => {
  await header(page, 'Title').dragTo(header(page, 'DueDate'), { targetPosition: { x: 8, y: 10 } });
  await expect(page.locator('.wb-grid-header-label')).toHaveText(
    ['Status', 'Title', 'DueDate', 'Progress', 'AssignedTo', 'Project']);
  await page.keyboard.press('Control+z');
  await expect(page.locator('.wb-grid-header-label')).toHaveText(HEADERS);
});

test('header menu compiles a look to real column-formatter JSON on demand', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await header(page, 'Status').click();
  await page.locator('.wb-grid-menu button', { hasText: 'Copy column JSON' }).click();
  await expect(page.locator('#wb-toast')).toContainText('Status formatter JSON copied');
  const parsed = JSON.parse(await page.evaluate(() => navigator.clipboard.readText()));
  expect(parsed.$schema).toContain('column-formatting');
  // the store speaks explicit [$Status]; the EXPORT compiles to @currentField
  expect(JSON.stringify(parsed)).toContain('@currentField');
});

test('Type→row starts a NEW view carrying the grid; picking grid minimizes back, groups intact', async ({ page }) => {
  await header(page, 'DueDate').dragTo(header(page, 'Status'));
  await openJson(page);
  await page.selectOption('#wb-pane-side #wb-kind', 'row');
  // a new SHEET carrying a copy of the grid's tree — renders once per mock row
  await expect(page.locator('.wb-mock-viewrow')).toHaveCount(3);
  await expect(page.locator('.wb-mock-viewrow').first()).toContainText('In Progress');
  await expect(canvasTab(page, 'View 1')).toHaveClass(/active/);
  // picking grid MINIMIZES — the floor is its own document, groups intact
  await page.selectOption('#wb-pane-side #wb-kind', 'grid');
  await expect(page.locator('.wb-grid-header-label')).toHaveText(
    ['Title', 'Status + DueDate group', 'Progress', 'AssignedTo', 'Project']);
  // …and the view waits in its canvas tab
  await expect(canvasTab(page, 'View 1')).toBeVisible();
  await expect(canvasTab(page, 'View 1')).not.toHaveClass(/active/);
});

test('right-click: column menu on headers, element menu on cell content, remove + undo', async ({ page }) => {
  // a header right-click opens the same column menu as a click
  await header(page, 'Status').click({ button: 'right' });
  await expect(page.locator('.wb-grid-menu-title')).toHaveText('Status');
  await expect(page.locator('.wb-grid-menu button', { hasText: 'Change the component…' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.wb-grid-menu')).toBeHidden();
  // right-clicking rendered cell content gets the element menu for that column
  const titleCell = page.locator('.wb-grid-row').first().locator('.wb-grid-cell').first();
  await titleCell.locator('[data-sp-path]').first().click({ button: 'right' });
  // the element menu heads with the element drawn like its Structure-tree row
  // (icon + name), and a clickable parent crumb sits before it
  await expect(page.locator('.wb-elmmenu-head > .wb-elmref .wb-elmref-name')).toHaveText('Title');
  await expect(page.locator('.wb-grid-menu-title .wb-elmmenu-parent')).toBeVisible();
  await page.locator('.wb-grid-menu button', { hasText: 'Remove' }).click();
  await expect(page.locator('.wb-grid-header-label')).toHaveText(HEADERS.filter((h) => h !== 'Title'));
  await page.keyboard.press('Control+z');
  await expect(page.locator('.wb-grid-header-label')).toHaveText(HEADERS);
});

test('element menu: the parent crumb walks the selection up a level', async ({ page }) => {
  // right-click a rendered cell's content → the element menu for that column
  const titleCell = page.locator('.wb-grid-row').first().locator('.wb-grid-cell').first();
  await titleCell.locator('[data-sp-path]').first().click({ button: 'right' });
  // the crumb names the parent element; remember it, then click to climb
  const crumb = page.locator('.wb-grid-menu-title .wb-elmmenu-parent');
  const parentName = await crumb.locator('.wb-elmref-name').textContent();
  await crumb.click();
  // the menu is now the parent's — its subject chip is what the crumb named…
  await expect(page.locator('.wb-elmmenu-head > .wb-elmref .wb-elmref-name')).toHaveText(parentName!);
  // …and the root has nothing above it, so the crumb is gone at the top
  await expect(page.locator('.wb-grid-menu-title .wb-elmmenu-parent')).toBeHidden();
});

test('conditional formatting (element menu): condition → rule → data preview → apply as one undo step', async ({ page }) => {
  // the per-column header route died with the CFR model — the element
  // context menu is the door now (element styling inside the view)
  const dueEl = page.locator('.wb-grid-row').first().locator('.wb-grid-cell[data-col="2"] [data-sp-path]').first();
  await dueEl.click({ button: 'right' });
  await page.locator('.wb-grid-menu button', { hasText: 'Conditional formatting…' }).click();
  const cf = page.locator('.wb-cf');
  await expect(cf).toBeVisible();
  // a date field suggests date conditions — pick "overdue", add the rule
  await cf.locator('.wb-cf-cond', { hasText: 'is in the past (overdue)' }).click();
  await cf.locator('.wb-cf-addbtn').click();
  await expect(cf.locator('.wb-cf-rule')).toHaveCount(1);
  await expect(cf.locator('.wb-cf-rule-when').first()).toContainText('DueDate is overdue');
  // every mock row previews through the real renderer; row 2 is overdue
  await expect(cf.locator('.wb-cf-preview-item')).toHaveCount(3);
  await expect(cf.locator('.wb-cf-preview-lab').nth(0)).toHaveText('no rule');
  await expect(cf.locator('.wb-cf-preview-lab').nth(1)).toHaveText('rule 1');
  await cf.locator('.wb-cf-apply').click();
  await expect(page.locator('#wb-toast')).toContainText('1 rule applied to DueDate');
  // the =if() chain landed on the element: the overdue row (row 2) paints red
  const overdue = page.locator('.wb-grid-row').nth(1).locator('.wb-grid-cell[data-col="2"] [data-sp-path]').first();
  await expect(overdue).toHaveCSS('color', 'rgb(209, 52, 56)');
  // ONE Ctrl+Z reverts the whole apply
  await page.keyboard.press('Control+z');
  await expect(overdue).not.toHaveCSS('color', 'rgb(209, 52, 56)');
});

test('conditional formatting can watch a different column than the one it paints', async ({ page }) => {
  const dueEl = page.locator('.wb-grid-row').first().locator('.wb-grid-cell[data-col="2"] [data-sp-path]').first();
  await dueEl.click({ button: 'right' });
  await page.locator('.wb-grid-menu button', { hasText: 'Conditional formatting…' }).click();
  const cf = page.locator('.wb-cf');
  // the picker is a type-labeled dropdown — no typing column names
  await expect(cf.locator('select option', { hasText: '[$Status] — choice' })).toHaveCount(1);
  await cf.locator('select').selectOption('Status');
  // the conditions adapt to the watched column's type (choice → ready chips)
  await cf.locator('.wb-cf-cond', { hasText: 'is Blocked' }).click();
  await cf.locator('.wb-cf-addbtn').click();
  await expect(cf.locator('.wb-cf-rule-when').first()).toContainText('Status is Blocked');
  await cf.locator('.wb-cf-apply').click();
  // the PAINTED element sits in the DueDate column; the rule watches Status —
  // row 2 (Blocked) wears the rule's red fill, row 1 (In Progress) does not
  await expect(page.locator('.wb-grid-row').nth(1).locator('.wb-grid-cell[data-col="2"] [data-sp-path]').first())
    .toHaveCSS('background-color', 'rgb(209, 52, 56)');
  await expect(page.locator('.wb-grid-row').nth(0).locator('.wb-grid-cell[data-col="2"] [data-sp-path]').first())
    .not.toHaveCSS('background-color', 'rgb(209, 52, 56)');
});

test('conditional formatting round-trips: reopen parses the rules back; zero rules removes them', async ({ page }) => {
  const rightClickDue = async () => {
    await page.locator('.wb-grid-row').first().locator('.wb-grid-cell[data-col="2"] [data-sp-path]').first()
      .click({ button: 'right' });
    await page.locator('.wb-grid-menu button', { hasText: 'Conditional formatting…' }).click();
  };
  // build and apply one rule the normal way
  await rightClickDue();
  const cf = page.locator('.wb-cf');
  await cf.locator('.wb-cf-cond', { hasText: 'is in the past (overdue)' }).click();
  await cf.locator('.wb-cf-addbtn').click();
  await cf.locator('.wb-cf-apply').click();
  await expect(page.locator('#wb-toast')).toContainText('1 rule applied');

  // REOPEN: the dialog parses the chains back — the rule is there to edit
  await rightClickDue();
  await expect(cf.locator('.wb-cf-rule')).toHaveCount(1);
  await expect(cf.locator('.wb-cf-rule-when')).toContainText('DueDate is overdue');
  await expect(cf.locator('.wb-cf-note')).toContainText('parsed back');

  // edit: add a second rule and re-apply — both survive the next round trip
  await cf.locator('.wb-cf-cond', { hasText: 'is today' }).click();
  await cf.locator('.wb-cf-addbtn').click();
  await expect(cf.locator('.wb-cf-rule')).toHaveCount(2);
  await cf.locator('.wb-cf-apply').click();
  await rightClickDue();
  await expect(cf.locator('.wb-cf-rule')).toHaveCount(2);

  // remove them all: zero rules + Apply = clear the conditional formatting
  await cf.locator('.wb-cf-rule-del').last().click();
  await cf.locator('.wb-cf-rule-del').click();
  await expect(cf.locator('.wb-cf-empty')).toContainText('Apply now clears');
  const apply = cf.locator('.wb-cf-apply');
  await expect(apply).toHaveText(/Remove the rules/);
  await apply.click();
  await expect(page.locator('#wb-toast')).toContainText('Conditional rules removed');

  // and a fresh open is genuinely fresh — nothing left to parse
  await rightClickDue();
  await expect(cf.locator('.wb-cf-rule')).toHaveCount(0);
  await expect(cf.locator('.wb-cf-empty')).toContainText('No rules yet');
});

test('format cells (element menu): bold + fill + outline stage together and apply as one undo step', async ({ page }) => {
  const titleEl = page.locator('.wb-grid-row').first().locator('.wb-grid-cell').first().locator('[data-sp-path]').first();
  await titleEl.click({ button: 'right' });
  await page.locator('.wb-grid-menu button', { hasText: 'Format cells…' }).click();
  const fc = page.locator('.wb-fc');
  await expect(fc).toBeVisible();
  await fc.locator('.wb-fc-toggle', { hasText: 'Bold' }).click();
  await fc.locator('.wb-fc-tab', { hasText: 'Fill' }).click();
  await fc.locator('.wb-fc-swatch[title="#deecf9"]').click();
  await fc.locator('.wb-fc-tab', { hasText: 'Border' }).click();
  await fc.locator('.wb-fc-preset', { hasText: 'Outline' }).click();
  await fc.locator('.wb-fc-ok').click();
  const cell = page.locator('.wb-grid [data-sp-path="0"]').first();
  await expect(cell).toHaveCSS('font-weight', '600');
  await expect(cell).toHaveCSS('background-color', 'rgb(222, 236, 249)');
  await expect(cell).toHaveCSS('border-top-width', '1px');
  // ONE undo reverts the whole dialog's patch
  await page.keyboard.press('Control+z');
  await expect(cell).toHaveCSS('font-weight', '400');
  await expect(cell).toHaveCSS('border-top-width', '0px');
});

test('format cells: Enter applies staged changes (Excel Esc/Enter contract)', async ({ page }) => {
  const titleEl = page.locator('.wb-grid-row').first().locator('.wb-grid-cell').first().locator('[data-sp-path]').first();
  await titleEl.click({ button: 'right' });
  await page.locator('.wb-grid-menu button', { hasText: 'Format cells…' }).click();
  const fc = page.locator('.wb-fc');
  await expect(fc).toBeVisible();
  // Click Bold — render() rebuilds the panel, focus falls to document.body
  await fc.locator('.wb-fc-toggle', { hasText: 'Bold' }).click();
  // Enter should trigger Apply (document.activeElement is not a button at this point)
  await page.keyboard.press('Enter');
  await expect(fc).not.toBeVisible();
  await expect(page.locator('.wb-grid [data-sp-path="0"]').first()).toHaveCSS('font-weight', '600');
});

test('format cells: Enter does not apply when nothing is staged (Apply is disabled)', async ({ page }) => {
  const titleEl = page.locator('.wb-grid-row').first().locator('.wb-grid-cell').first().locator('[data-sp-path]').first();
  await titleEl.click({ button: 'right' });
  await page.locator('.wb-grid-menu button', { hasText: 'Format cells…' }).click();
  const fc = page.locator('.wb-fc');
  await expect(fc).toBeVisible();
  // Font tab is focused on open; pressing Enter fires the tab's own click (not Apply)
  // and leaves the dialog open because nothing is staged
  await page.keyboard.press('Enter');
  await expect(fc).toBeVisible();
});

test('the app lands on the grid and the whole on-ramp is click/drag-only', async ({ page }) => {
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.locator('.wb-grid-header-label')).toHaveText(HEADERS);
  // header menu works (Status wears a look → the look actions lead)
  await header(page, 'Status').click();
  await expect(page.locator('.wb-grid-menu button', { hasText: 'Change the component…' })).toBeVisible();
  await expect(page.locator('.wb-grid-menu button', { hasText: 'Remove the look' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.wb-grid-menu')).toBeHidden();
  // grouping works
  await header(page, 'DueDate').dragTo(header(page, 'Status'));
  await expect(page.locator('.wb-tree-name', { hasText: 'Status + DueDate group' })).toBeVisible();
});

test('column tab groups: group via multi-select, pill actions, collapse/expand, persist, ungroup', async ({ page }) => {
  // Ctrl-select two columns → the selection bar offers browser-style grouping
  await header(page, 'Status').click({ modifiers: ['Control'] });
  await header(page, 'DueDate').click({ modifiers: ['Control'] });
  await page.locator('.wb-areas-bar button', { hasText: 'Group columns' }).click();

  // a colored pill spans the group; the member headers wear its band
  const pill = page.locator('.wb-grid-grouppill');
  await expect(pill).toHaveText('Group 1');
  await expect(page.locator('.wb-grid-header-grouped')).toHaveCount(2);
  // grouping is display-only — nothing landed on the undo stack (metadata,
  // like sheet renames), so the undo toolbar button stays disabled
  await expect(page.locator('.wb-tool-undo')).toBeDisabled();

  // collapse via the pill menu — the columns wait intact behind a slim track
  await pill.click();
  await page.locator('.wb-grid-menu button', { hasText: 'Collapse' }).click();
  await expect(page.locator('.wb-grid-header-label'))
    .toHaveText(['Title', 'Progress', 'AssignedTo', 'Project']);
  // clicking the slim track expands it again
  await page.locator('.wb-grid-headrow .wb-grid-collapsed').click();
  await expect(page.locator('.wb-grid-header-label'))
    .toHaveText(['Title', 'Status', 'DueDate', 'Progress', 'AssignedTo', 'Project']);

  // rename via the pill menu
  await page.locator('.wb-grid-grouppill').click();
  await page.locator('.wb-grid-menu button', { hasText: 'Rename group…' }).click();
  const input = page.locator('.wb-rename-input');
  await input.fill('Delivery');
  await input.press('Enter');
  await expect(page.locator('.wb-grid-grouppill')).toHaveText('Delivery');

  // groups are project metadata — they autosave and survive a reload
  await page.reload();
  await expect(page.locator('.wb-grid-grouppill')).toHaveText('Delivery');

  // ungroup dissolves the pill; the columns themselves are untouched
  await page.locator('.wb-grid-grouppill').click();
  await page.locator('.wb-grid-menu button', { hasText: 'Ungroup' }).click();
  await expect(page.locator('.wb-grid-grouppill')).toHaveCount(0);
  await expect(page.locator('.wb-grid-header-label'))
    .toHaveText(['Title', 'Status', 'DueDate', 'Progress', 'AssignedTo', 'Project']);
});

test('format cells: modal-local ↶↷ walks the staged gestures; the stack bottoms out at open', async ({ page }) => {
  const titleEl = page.locator('.wb-grid-row').first().locator('.wb-grid-cell').first().locator('[data-sp-path]').first();
  await titleEl.click({ button: 'right' });
  await page.locator('.wb-grid-menu button', { hasText: 'Format cells…' }).click();
  const fc = page.locator('.wb-fc');
  await expect(fc.locator('.wb-mu-undo')).toBeDisabled(); // bottoms out where you opened it
  // two gestures = two local steps
  await fc.locator('.wb-fc-toggle', { hasText: 'Bold' }).click();
  await fc.locator('.wb-fc-tab', { hasText: 'Fill' }).click(); // tab switches are free
  await fc.locator('.wb-fc-swatch[title="#deecf9"]').click();
  await expect(fc.locator('.wb-fc-swatch[title="#deecf9"]')).toHaveClass(/active/);
  // ↶ takes back only the fill; Bold stays staged
  await fc.locator('.wb-mu-undo').click();
  await expect(fc.locator('.wb-fc-swatch[title="#deecf9"]')).not.toHaveClass(/active/);
  await fc.locator('.wb-fc-tab', { hasText: 'Font' }).click();
  await expect(fc.locator('.wb-fc-toggle', { hasText: 'Bold' })).toHaveClass(/active/);
  // ↶ again reaches the baseline and stops; ↷ replays
  await fc.locator('.wb-mu-undo').click();
  await expect(fc.locator('.wb-fc-toggle', { hasText: 'Bold' })).not.toHaveClass(/active/);
  await expect(fc.locator('.wb-mu-undo')).toBeDisabled();
  await fc.locator('.wb-mu-redo').click();
  await expect(fc.locator('.wb-fc-toggle', { hasText: 'Bold' })).toHaveClass(/active/);
  // in-dialog gestures never touched the APP stack (no document mutation)
  await expect(page.locator('.wb-tool-undo')).toBeDisabled();
  // Apply commits the surviving staged patch as ONE app-level step
  await fc.locator('.wb-fc-ok').click();
  await expect(page.locator('.wb-grid [data-sp-path="0"]').first()).toHaveCSS('font-weight', '600');
  await page.keyboard.press('Control+z');
  await expect(page.locator('.wb-grid [data-sp-path="0"]').first()).toHaveCSS('font-weight', '400');
});

test('conditional formatting: modal-local ↶↷ over the rules list; Ctrl+Z inside the dialog stays local', async ({ page }) => {
  const dueEl = page.locator('.wb-grid-row').first().locator('.wb-grid-cell[data-col="2"] [data-sp-path]').first();
  await dueEl.click({ button: 'right' });
  await page.locator('.wb-grid-menu button', { hasText: 'Conditional formatting…' }).click();
  const cf = page.locator('.wb-cf');
  await expect(cf.locator('.wb-mu-undo')).toBeDisabled();
  await cf.locator('.wb-cf-cond', { hasText: 'is in the past (overdue)' }).click(); // composer pick — not a step
  await expect(cf.locator('.wb-mu-undo')).toBeDisabled();
  await cf.locator('.wb-cf-addbtn').click(); // the gesture
  await expect(cf.locator('.wb-cf-rule')).toHaveCount(1);
  // Ctrl+Z with the dialog open is the LOCAL undo — the rule comes back off,
  // the dialog stays open, and the app-level stack never hears about it
  await page.keyboard.press('Control+z');
  await expect(cf).toBeVisible();
  await expect(cf.locator('.wb-cf-rule')).toHaveCount(0);
  await expect(page.locator('.wb-tool-undo')).toBeDisabled();
  await cf.locator('.wb-mu-redo').click();
  await expect(cf.locator('.wb-cf-rule')).toHaveCount(1);
  await expect(cf.locator('.wb-cf-rule-when')).toContainText('DueDate is overdue');
});
