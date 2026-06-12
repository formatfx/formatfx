/**
 * E2E: the grid-first workspace (roadmap 1.5) — header menus, per-column
 * formatting, hide / add column, and the on-ramp: dragging one column onto
 * another generates named row-formatter scaffolding, one undo step per
 * grid mutation.
 */
import { test, expect, type Page } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem('wb-ui-prefs', JSON.stringify({ mode: 'advanced' }));
  });
  await page.reload();
});

const HEADERS = ['Title', 'Status', 'DueDate', 'Progress', 'AssignedTo', 'Project'];

function header(page: Page, label: string) {
  return page.locator('.wb-grid-header', { has: page.locator('.wb-grid-header-label', { hasText: label }) });
}

test('header menu formats an unformatted column: scaffold registered, grid renders it via CFR', async ({ page }) => {
  await header(page, 'DueDate').click();
  const menu = page.locator('.wb-grid-menu');
  await expect(menu.locator('.wb-grid-menu-title')).toHaveText('DueDate');
  await menu.locator('button', { hasText: 'Format this column' }).click();
  // we land in the column-formatter editing context, scaffolded on @currentField
  await expect(page.locator('.wb-doc-header', { hasText: '[$DueDate]' })).toHaveClass(/active/);
  await expect(page.locator('#wb-activedoc')).toHaveValue('DueDate');
  // style it so the round trip is visible, then return to the grid
  await page.locator('.wb-tabs button[data-tab="json"]').click();
  await page.fill('#wb-json-text', JSON.stringify({
    elmType: 'div', txtContent: "='⏰ '+toLocaleDateString(@currentField)",
  }));
  await page.click('#wb-json-apply');
  await page.locator('.wb-doc-header', { hasText: 'View formatter' }).click();
  await expect(page.locator('.wb-grid-row').first()).toContainText('⏰');
  // the cell became a reference — resolved, not a placeholder chip
  await expect(page.locator('.wb-grid .wb-cfr-chip')).toHaveCount(0);
  // and a single undo removes the cell swap (the one document mutation)
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
  await page.selectOption('#wb-kind', 'row');
  // free row layout now — same tree, root renders once per mock row
  await expect(page.locator('.wb-mock-viewrow')).toHaveCount(3);
  await expect(page.locator('.wb-mock-viewrow').first()).toContainText('In Progress');
  await page.selectOption('#wb-kind', 'grid');
  await expect(page.locator('.wb-grid-header-label')).toHaveText(
    ['Title', 'Status + DueDate group', 'Progress', 'AssignedTo', 'Project']);
});

test('basic mode lands on the grid and the whole on-ramp is click/drag-only', async ({ page }) => {
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.locator('#wb-mode button', { hasText: 'Basic' })).toHaveClass(/active/);
  await expect(page.locator('.wb-grid-header-label')).toHaveText(HEADERS);
  // header menu works in basic
  await header(page, 'Status').click();
  await expect(page.locator('.wb-grid-menu button', { hasText: 'Edit its formatter' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.wb-grid-menu')).toBeHidden();
  // grouping works in basic
  await header(page, 'DueDate').dragTo(header(page, 'Status'));
  await expect(page.locator('.wb-tree-name', { hasText: 'Status + DueDate group' })).toBeVisible();
});
