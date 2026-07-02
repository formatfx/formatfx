// e2e/maker.spec.ts
import { test, expect, type Page } from '@playwright/test';

// The JSON pane (the "Advanced" escape hatch) is hidden by default; reveal it
// idempotently. The left edit pane and canvas are always visible.
async function openJson(page: Page): Promise<void> {
  if (!(await page.locator('#wb-pane-side').isVisible())) await page.click('#wb-json-toggle');
}

// the example/sample loader now lives in the ☰ menu — open it, then pick
async function loadExample(page: Page, value: string): Promise<void> {
  await page.click('#wb-menu-btn');
  await page.selectOption('#wb-example', value);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
});

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

test('the single Advanced door is labeled Advanced and opens the validated-JSON pane', async ({ page }) => {
  await expect(page.locator('#wb-json-toggle')).toContainText('Advanced');
  await page.click('#wb-json-toggle');
  // opens the JSON escape hatch; the left editing pane stays put
  await expect(page.locator('#wb-pane-side')).toBeVisible();
  await expect(page.locator('#wb-json-text')).toBeVisible();
});

test('the example/sample loader lives in the ☰ menu, not the topbar', async ({ page }) => {
  await expect(page.locator('.wb-topbar-controls > #wb-example')).toHaveCount(0);
  await page.click('#wb-menu-btn');
  await expect(page.locator('#wb-menu-panel #wb-example')).toBeVisible();
});

test('the formatter tabs state where you are, not a Type dropdown', async ({ page }) => {
  // the old upfront Type dropdown is gone from the topbar
  await expect(page.locator('.wb-topbar #wb-kind')).toHaveCount(0);
  // default doc is a grid view → the VIEW FORMATTERS tab is active and the
  // document dropdown names the view
  await expect(page.locator('.wb-fmt-tab-view')).toHaveClass(/active/);
  await expect(page.locator('.wb-doc-pill-name')).toHaveText('View 1');
});

test('the kind control lives in the Advanced pane, and a column example flips to the COLUMN tab', async ({ page }) => {
  // the kind select moved into the side/JSON pane (revealed by Advanced)
  await openJson(page);
  await expect(page.locator('#wb-pane-side #wb-kind')).toBeVisible();
  // a column-kind example lights the COLUMN FORMATTERS tab and names the
  // column it targets in the document dropdown
  await loadExample(page, 'status-pill');
  await expect(page.locator('.wb-fmt-tab-cols')).toHaveClass(/active/);
  await expect(page.locator('.wb-doc-pill-name')).toHaveText('Status');
});
