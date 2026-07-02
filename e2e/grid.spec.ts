/**
 * E2E: the grid-first workspace (roadmap 1.5) — header menus, per-column
 * formatting, hide / add column, and the on-ramp: dragging one column onto
 * another generates named row-formatter scaffolding, one undo step per
 * grid mutation.
 */
import { test, expect, type Page } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  // accept dialogs: applying name-less JSON over a named design now asks first
  page.on('dialog', (d) => { void d.accept(); });
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
});

const HEADERS = ['Title', 'Status', 'DueDate', 'Progress', 'AssignedTo', 'Project'];

function header(page: Page, label: string) {
  return page.locator('.wb-grid-header', { has: page.locator('.wb-grid-header-label', { hasText: label }) });
}

// The JSON pane ("Advanced") is hidden by default — reveal it idempotently.
async function openJson(page: Page): Promise<void> {
  if (!(await page.locator('#wb-pane-side').isVisible())) await page.click('#wb-json-toggle');
}

test('header menu formats an unformatted column: scaffold registered, grid renders it via CFR', async ({ page }) => {
  await header(page, 'DueDate').click();
  const menu = page.locator('.wb-grid-menu');
  await expect(menu.locator('.wb-grid-menu-title')).toHaveText('DueDate');
  await menu.locator('button', { hasText: 'Format this column' }).click();
  // a date column offers presets first; take the manual escape hatch here
  await expect(menu.locator('.wb-grid-menu-title')).toHaveText('Format DueDate');
  await menu.locator('button', { hasText: 'Format this column manually' }).click();
  // we land in the column-formatter editing context, scaffolded on @currentField
  await expect(page.locator('.wb-fmt-tab-cols')).toHaveClass(/active/);
  await expect(page.locator('.wb-doc-pill-name')).toHaveText('DueDate');
  // style it so the round trip is visible, then return to the grid
  await openJson(page);
  await page.fill('#wb-json-text', JSON.stringify({
    elmType: 'div', txtContent: "='⏰ '+toLocaleDateString(@currentField)",
  }));
  await page.click('#wb-json-apply');
  await page.locator('.wb-fmt-tab-view').click();
  await expect(page.locator('.wb-grid-row').first()).toContainText('⏰');
  // the cell became a reference — resolved, not a placeholder chip
  await expect(page.locator('.wb-grid .wb-cfr-chip')).toHaveCount(0);
  // and a single undo removes the cell swap (the one document mutation)
});

test('"Format this column" is the subtype catalog: type-aware looks, badged, snapshot-applied', async ({ page }) => {
  // an unformatted people column → no avatars anywhere in the grid yet
  await expect(page.locator('.wb-grid-cell img')).toHaveCount(0);
  await header(page, 'AssignedTo').click();
  await page.locator('.wb-grid-menu button', { hasText: 'Format this column' }).click();
  await expect(page.locator('.wb-grid-menu-title')).toHaveText('Format AssignedTo');
  // the system thinks for the maker: a multi-person column → people looks, badged
  const facepile = page.locator('.wb-grid-menu button', { hasText: 'Facepile' });
  await expect(facepile.locator('.wb-menu-badge')).toHaveText('Built-in');
  await expect(page.locator('.wb-grid-menu button', { hasText: 'Member count' })).toBeVisible();
  await expect(page.locator('.wb-grid-menu button', { hasText: 'Format this column manually' })).toBeVisible();
  // a subtype that does not fit a people column never appears (refuse-don't-guess)
  await expect(page.locator('.wb-grid-menu button', { hasText: 'Data bar' })).toHaveCount(0);
  // snapshot apply: stay on the grid (View Formatters, not drilled into a column),
  // the cell renders avatars, one Ctrl+Z reverts
  await facepile.click();
  await expect(page.locator('.wb-fmt-tab-view')).toHaveClass(/active/);
  await expect(page.locator('.wb-grid-cell img').first()).toBeVisible();
  await page.keyboard.press('Control+z');
  await expect(page.locator('.wb-grid-cell img')).toHaveCount(0);
});

test('drilling into a column formatter lights the COLUMN tab; the VIEW tab returns to the named view', async ({ page }) => {
  await header(page, 'Status').click();
  await page.locator('.wb-grid-menu button', { hasText: 'Edit the Status style' }).click();
  await expect(page.locator('.wb-fmt-tab-cols')).toHaveClass(/active/);
  await expect(page.locator('.wb-doc-pill-name')).toHaveText('Status');
  // the VIEW FORMATTERS tab is the way back to the view you drilled from
  await page.locator('.wb-fmt-tab-view').click();
  // back on the view: the dropdown names the view again
  await expect(page.locator('.wb-fmt-tab-view')).toHaveClass(/active/);
  await expect(page.locator('.wb-doc-pill-name')).toHaveText('View 1');
  await expect(page.locator('.wb-grid-header-label').first()).toBeVisible();
});

test('hide column is one undoable mutation; "+ column" re-adds fields, formatted ones stay formatted', async ({ page }) => {
  await header(page, 'Status').click();
  await page.locator('.wb-grid-menu button', { hasText: 'Hide column' }).click();
  await expect(page.locator('.wb-grid-header-label')).toHaveText(HEADERS.filter((h) => h !== 'Status'));
  await page.keyboard.press('Control+z');
  await expect(page.locator('.wb-grid-header-label')).toHaveText(HEADERS);

  // Owner is registered-but-unplaced: adding it renders its persona formatter
  await page.locator('.wb-grid-addcol').click();
  await page.locator('.wb-grid-menu button', { hasText: 'Owner · formatted' }).click();
  await expect(page.locator('.wb-grid-header-label')).toHaveText([...HEADERS, 'Owner']);
  await expect(page.locator('.wb-grid-row').first().locator('img')).toBeVisible(); // avatar
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

test('header menu copies a registered column formatter as column JSON', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await header(page, 'Status').click();
  await page.locator('.wb-grid-menu button', { hasText: 'Copy column JSON' }).click();
  await expect(page.locator('#wb-toast')).toContainText('[$Status] formatter JSON copied');
  const parsed = JSON.parse(await page.evaluate(() => navigator.clipboard.readText()));
  expect(parsed.$schema).toContain('column-formatting');
  expect(JSON.stringify(parsed)).toContain('[$Status]');
});

test('the same tree graduates: switch Type to row layout and back to grid', async ({ page }) => {
  await header(page, 'DueDate').dragTo(header(page, 'Status'));
  await openJson(page);
  await page.selectOption('#wb-pane-side #wb-kind', 'row');
  // free row layout now — same tree, root renders once per mock row
  await expect(page.locator('.wb-mock-viewrow')).toHaveCount(3);
  await expect(page.locator('.wb-mock-viewrow').first()).toContainText('In Progress');
  await page.selectOption('#wb-pane-side #wb-kind', 'grid');
  await expect(page.locator('.wb-grid-header-label')).toHaveText(
    ['Title', 'Status + DueDate group', 'Progress', 'AssignedTo', 'Project']);
});

test('right-click: column menu on headers, element menu on cell content, remove + undo', async ({ page }) => {
  // a header right-click opens the same column menu as a click
  await header(page, 'Status').click({ button: 'right' });
  await expect(page.locator('.wb-grid-menu-title')).toHaveText('Status');
  await expect(page.locator('.wb-grid-menu button', { hasText: 'Conditional formatting…' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.wb-grid-menu')).toBeHidden();
  // right-clicking rendered cell content gets the element menu for that column
  const titleCell = page.locator('.wb-grid-row').first().locator('.wb-grid-cell').first();
  await titleCell.locator('[data-sp-path]').first().click({ button: 'right' });
  await expect(page.locator('.wb-grid-menu-title')).toHaveText('Title');
  await page.locator('.wb-grid-menu button', { hasText: 'Remove' }).click();
  await expect(page.locator('.wb-grid-header-label')).toHaveText(HEADERS.filter((h) => h !== 'Title'));
  await page.keyboard.press('Control+z');
  await expect(page.locator('.wb-grid-header-label')).toHaveText(HEADERS);
});

test('conditional formatting from the header menu: condition → rule → data preview → apply lands on the column formatter', async ({ page }) => {
  await header(page, 'DueDate').click();
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
  // the column route registers a formatter and switches the workspace to it
  await expect(page.locator('.wb-doc-pill-name')).toHaveText('DueDate');
  await openJson(page);
  const json = await page.inputValue('#wb-json-text');
  // the JSON tab shows the sanitized export (Zero Whitespace Rule)
  expect(json).toContain("=if(toString([$DueDate])!=''&&[$DueDate]<@now,'#d13438','')");
  // back on the grid, the cell resolves the new formatter (no placeholder chip)
  await page.locator('.wb-fmt-tab-view').click();
  await expect(page.locator('.wb-grid .wb-cfr-chip')).toHaveCount(0);
});

test('conditional formatting can watch a different column than the one it paints', async ({ page }) => {
  await header(page, 'DueDate').click();
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
  // the PAINTED column gets the formatter; the rules inside watch Status
  await expect(page.locator('.wb-doc-pill-name')).toHaveText('DueDate');
  await openJson(page);
  expect(await page.inputValue('#wb-json-text')).toContain("[$Status]=='Blocked'");
});

test('format cells: bold + fill + outline border stage together and apply as one undo step', async ({ page }) => {
  await header(page, 'Title').click();
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
  await header(page, 'Title').click();
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
  await header(page, 'Title').click();
  await page.locator('.wb-grid-menu button', { hasText: 'Format cells…' }).click();
  const fc = page.locator('.wb-fc');
  await expect(fc).toBeVisible();
  // Font tab is focused on open; pressing Enter fires the tab's own click (not Apply)
  // and leaves the dialog open because nothing is staged
  await page.keyboard.press('Enter');
  await expect(fc).toBeVisible();
});

test('✨ a color for each choice: one rule per choice, smart colors, formula-replacement warning', async ({ page }) => {
  await header(page, 'Status').click();
  await page.locator('.wb-grid-menu button', { hasText: 'Conditional formatting…' }).click();
  const cf = page.locator('.wb-cf');
  await cf.locator('.wb-cf-auto').click();
  await expect(cf.locator('.wb-cf-rule')).toHaveCount(4);
  await expect(cf.locator('.wb-cf-rule-when').nth(2)).toContainText('Status is Blocked');
  // Done gets the green solid pill — the words pick the colors
  await expect(cf.locator('.wb-cf-rule').nth(3).locator('.wb-cf-chip'))
    .toHaveCSS('background-color', 'rgb(16, 124, 16)');
  // the showcase Status pill already drives background-color by formula — we warn
  await expect(cf.locator('.wb-cf-note')).toContainText('replaces the formula');
});

test('the app lands on the grid and the whole on-ramp is click/drag-only', async ({ page }) => {
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.locator('.wb-grid-header-label')).toHaveText(HEADERS);
  // header menu works (Status is a linked instance → the Figma-model actions)
  await header(page, 'Status').click();
  await expect(page.locator('.wb-grid-menu button', { hasText: 'Edit the Status style' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.wb-grid-menu')).toBeHidden();
  // grouping works
  await header(page, 'DueDate').dragTo(header(page, 'Status'));
  await expect(page.locator('.wb-tree-name', { hasText: 'Status + DueDate group' })).toBeVisible();
});
