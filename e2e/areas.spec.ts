/**
 * E2E: the graduation gestures — Ctrl-click grid columns to multi-select,
 * "make a row view" turns them into weighted areas (a NEW view in its own
 * canvas tab), density is a separate row-level knob, and tile is an explicit
 * layout pick that can never emerge on its own. Zone/area sizing lives in the
 * template builder's inspector — the old right-click "Area width" entries
 * were retired 2026-07-04 (FLOOR-AND-SHEETS).
 */
import { test, expect } from '@playwright/test';
import { freshApp, header, canvasTab, openGridTab } from './helpers';

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

test('the retired right-click Area width entries stay gone (sizing is the builder inspector\'s job)', async ({ page }) => {
  await header(page, 'Title').click({ modifiers: ['Control'] });
  await header(page, 'Status').click({ modifiers: ['Control'] });
  await page.locator('.wb-areas-bar button', { hasText: 'Make a row view' }).click();

  const area1 = page.locator('.wb-mock-viewrow').first().locator('[data-sp-path="1"]');
  await area1.click({ button: 'right' });
  await expect(page.locator('.wb-grid-menu')).toBeVisible(); // the element menu still opens
  await expect(page.locator('.wb-grid-menu button', { hasText: 'Area width' })).toHaveCount(0);
  // the graduated areas still carry their conflict-free weights
  await expect(area1).toHaveCSS('flex-grow', '1');
});

test('density is a separate row-level knob (in the structure-header kebab), and the Grid tab is the way back', async ({ page }) => {
  await header(page, 'Title').click({ modifiers: ['Control'] });
  await header(page, 'Status').click({ modifiers: ['Control'] });
  await page.locator('.wb-areas-bar button', { hasText: 'Make a row view' }).click();

  // density moved off the canvas toolbar into the structure-header kebab
  // (2026-07-10) — the settings panel stays open across gestures
  const root = page.locator('.wb-mock-viewrow').first().locator('> [data-sp-path=""]');
  await page.locator('#wb-structure-kebab').click();
  const densitySeg = page.locator('.wb-viewkebab [data-prop="density"]');
  await densitySeg.locator('.wb-viewcard-segbtn', { hasText: 'Compact' }).click();
  await expect(root).toHaveCSS('gap', '8px');
  await densitySeg.locator('.wb-viewcard-segbtn', { hasText: 'Roomy' }).click();
  await expect(root).toHaveCSS('gap', '16px');
  await page.keyboard.press('Escape'); // close the panel before navigating

  // the Grid tab is the way back (minimize is navigation; the view waits in
  // its own tab) — no toolbar "Back to grid" button anywhere
  await openGridTab(page);
  // the FLOOR comes back exactly as it was — a real separate document, not
  // the view's areas relabeled as pseudo-columns (FLOOR-AND-SHEETS Stage 1)
  await expect(page.locator('.wb-grid-header-label'))
    .toHaveText(['Title', 'Status', 'DueDate', 'Progress', 'AssignedTo', 'Project']);
  await expect(page.locator('.wb-grid-addcol')).toBeVisible();
  await expect(page.locator('.wb-rowview-bar-btn', { hasText: 'Back to grid' })).toHaveCount(0);

  // …and the way back is VISIBLE: the view's canvas tab reopens it untouched
  await canvasTab(page, 'View 1').locator('.wb-canvastab-btn').click();
  await expect(page.locator('.wb-rowview-bar')).toBeVisible();
  await expect(page.locator('.wb-mock-viewrow').first().locator('> [data-sp-path] > [data-sp-path]')).toHaveCount(2);
  await expect(canvasTab(page, 'View 1')).toHaveClass(/active/); // the tab shows it's up
});

test('tile is an explicit layout pick from the selection', async ({ page }) => {
  await header(page, 'Title').click({ modifiers: ['Control'] });
  await page.locator('.wb-areas-bar button', { hasText: 'Make a tile' }).click();
  await expect(page.locator('.wb-mock-tile')).toHaveCount(3);
  // a graduated tile stacks its areas vertically — never a row in a tile box
  await expect(page.locator('.wb-mock-tile').first().locator('> [data-sp-path=""]'))
    .toHaveCSS('flex-direction', 'column');
  // a tile is still a view — its canvas tab is active and wears the ▤ mark
  await expect(canvasTab(page, 'View 1')).toHaveClass(/active/);
  await expect(canvasTab(page, 'View 1').locator('.wb-canvastab-mark')).toHaveText('▤');
});
