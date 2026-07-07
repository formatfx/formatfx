// e2e/maker.spec.ts — the maker-first shell: grid-first landing, the single
// Advanced door into the JSON pane, and the canvas tab strip (not a Type
// dropdown) saying where you are.
import { test, expect } from '@playwright/test';
import { freshApp, loadExample, openJson } from './helpers';

test.beforeEach(async ({ page }) => { await freshApp(page); });

test('first load is grid-first: left pane + canvas visible, JSON pane hidden', async ({ page }) => {
  // the Left Edit Pane and the grid canvas are always on screen
  await expect(page.locator('.wb-leftpane')).toBeVisible();
  await expect(page.locator('.wb-grid')).toBeVisible();
  // the JSON pane (Advanced escape hatch) folds away by default
  await expect(page.locator('#wb-pane-side')).toBeHidden();
  // the single door into JSON is labeled Advanced
  await expect(page.locator('#wb-json-toggle')).toContainText('Advanced');
});

test('Advanced toggle reveals the JSON pane and persists', async ({ page }) => {
  await page.click('#wb-json-toggle');
  await expect(page.locator('#wb-pane-side')).toBeVisible();
  await expect(page.locator('#wb-json-text')).toBeVisible();
  // the open state is remembered in uiPrefs.jsonOpen (wb-ui-prefs)
  await page.reload();
  await expect(page.locator('#wb-pane-side')).toBeVisible();
});

test('the example/sample loader lives in the ☰ menu, not the topbar', async ({ page }) => {
  await expect(page.locator('.wb-topbar-controls > #wb-example')).toHaveCount(0);
  await page.click('#wb-menu-btn');
  await expect(page.locator('#wb-menu-panel #wb-example')).toBeVisible();
});

test('the canvas tab strip states where you are, not a Type dropdown', async ({ page }) => {
  // the old upfront Type dropdown is gone from the topbar
  await expect(page.locator('.wb-topbar #wb-kind')).toHaveCount(0);
  // default surface is the grid → the standing ▦ Grid tab is active
  await expect(page.locator('#wb-canvastabs .wb-canvastab-grid')).toHaveClass(/active/);
  await expect(page.locator('#wb-canvastabs .wb-canvastab')).toHaveCount(1);
});

test('the kind control lives in the Advanced pane; a column example becomes a LOOK, not a surface', async ({ page }) => {
  // the kind select moved into the side/JSON pane (revealed by Advanced)
  await openJson(page);
  await expect(page.locator('#wb-pane-side #wb-kind')).toBeVisible();
  // a column-kind example doesn't open anything — it dresses the current
  // column and the grid stays up ("Format this column" is no longer a gesture)
  await loadExample(page, 'status-pill');
  await expect(page.locator('#wb-toast')).toContainText("applied as the Status column's look");
  await expect(page.locator('#wb-canvastabs .wb-canvastab-grid')).toHaveClass(/active/);
  await expect(page.locator('#wb-pane-side #wb-kind')).toHaveValue('grid');
});
