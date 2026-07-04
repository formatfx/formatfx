/**
 * E2E: Stage 3 — the row-view builder. Ctrl-click grid columns to multi-select,
 * "make a row view" turns them into weighted areas, per-area sizing lives on the
 * right-click menu, density is a separate row-level knob, and tile is an explicit
 * layout pick that can never emerge on its own.
 */
import { test, expect } from '@playwright/test';
import { freshApp, header } from './helpers';

test.beforeEach(async ({ page }) => { await freshApp(page, { acceptDialogs: true }); });

test('Ctrl-click multi-selects columns and the areas bar makes a row view', async ({ page }) => {
  // no selection → no bar
  await expect(page.locator('.wb-areas-bar')).toBeHidden();
  await header(page, 'Title').click({ modifiers: ['Control'] });
  await header(page, 'DueDate').click({ modifiers: ['Control'] });
  await expect(page.locator('.wb-areas-bar-count')).toHaveText('2 columns selected →');
  // both columns read as selected (no menu opened by a Ctrl-click)
  await expect(page.locator('.wb-grid-menu')).toHaveCount(0);
  await expect(header(page, 'Title')).toHaveClass(/wb-grid-col-selected/);

  await page.locator('.wb-areas-bar button', { hasText: 'Make a row view' }).click();
  // graduated to a row layout: one rendered row per mock row, the two areas only
  await expect(page.locator('.wb-rowview-bar')).toBeVisible();
  await expect(page.locator('.wb-mock-viewrow')).toHaveCount(3);
  const firstRow = page.locator('.wb-mock-viewrow').first();
  await expect(firstRow.locator('> [data-sp-path] > [data-sp-path]')).toHaveCount(2);
  // each area carries a flex weight (Normal = grow 1)
  await expect(firstRow.locator('[data-sp-path="0"]')).toHaveCSS('flex-grow', '1');
});

test('per-area sizing is independent (CSS-fr-like) and lives on the right-click menu', async ({ page }) => {
  await header(page, 'Title').click({ modifiers: ['Control'] });
  await header(page, 'Status').click({ modifiers: ['Control'] });
  await page.locator('.wb-areas-bar button', { hasText: 'Make a row view' }).click();

  const area0 = page.locator('.wb-mock-viewrow').first().locator('[data-sp-path="0"]');
  const area1 = page.locator('.wb-mock-viewrow').first().locator('[data-sp-path="1"]');
  await area1.click({ button: 'right' });
  await page.locator('.wb-grid-menu button', { hasText: 'Area width: Widest' }).click();
  await expect(area1).toHaveCSS('flex-grow', '3');
  await expect(area0).toHaveCSS('flex-grow', '1'); // neighbor untouched
});

test('density is a separate row-level knob, and you can go back to the grid', async ({ page }) => {
  await header(page, 'Title').click({ modifiers: ['Control'] });
  await header(page, 'Status').click({ modifiers: ['Control'] });
  await page.locator('.wb-areas-bar button', { hasText: 'Make a row view' }).click();

  const root = page.locator('.wb-mock-viewrow').first().locator('> [data-sp-path=""]');
  await page.locator('.wb-rowview-bar-btn', { hasText: 'Compact' }).click();
  await expect(root).toHaveCSS('gap', '8px');
  await page.locator('.wb-rowview-bar-btn', { hasText: 'Roomy' }).click();
  await expect(root).toHaveCSS('gap', '16px');

  await page.locator('.wb-rowview-bar-btn', { hasText: 'Back to grid' }).click();
  // the two areas come back as grid columns (other fields wait under "+ column")
  await expect(page.locator('.wb-grid-header-label')).toHaveText(['Title', 'Status']);
  await expect(page.locator('.wb-grid-addcol')).toBeVisible();
});

test('tile is an explicit layout pick from the selection', async ({ page }) => {
  await header(page, 'Title').click({ modifiers: ['Control'] });
  await page.locator('.wb-areas-bar button', { hasText: 'Make a tile' }).click();
  await expect(page.locator('.wb-mock-tile')).toHaveCount(3);
  // a tile is still a view formatter → the VIEW FORMATTERS tab stays active,
  // the document dropdown still names View 1 (as a tile schema now)
  await expect(page.locator('.wb-fmt-tab-view')).toHaveClass(/active/);
  await expect(page.locator('.wb-doc-pill-name')).toHaveText('View 1');
  await expect(page.locator('.wb-doc-pill-type')).toHaveText('tile schema');
});
