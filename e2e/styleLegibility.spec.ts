/**
 * E2E: column-style legibility — "violet = shared". Rails + § marks at rest,
 * the name-tag on a selected linked cell, and double-click drill-in.
 */
import { test, expect, type Page } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  page.on('dialog', (d) => { void d.accept(); });
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
});

function header(page: Page, label: string) {
  return page.locator('.wb-grid-header', { has: page.locator('.wb-grid-header-label', { hasText: label }) });
}

test('linked cells wear the shared rail; plain cells do not', async ({ page }) => {
  await expect(page.locator('.wb-grid-cell.wb-cell-linked').first()).toBeVisible();
  // Status ships linked; Title does not — compare within the first data row
  const firstRow = page.locator('.wb-grid-row').first();
  await expect(firstRow.locator('.wb-cell-linked')).toHaveCount(2); // Status + Progress ship linked
});

test('the header badge shows the § style mark', async ({ page }) => {
  await expect(header(page, 'Status').locator('.wb-cfr-link')).toHaveText('§');
  await expect(header(page, 'Title').locator('.wb-cfr-link')).toHaveCount(0);
});

test('selecting a linked cell reveals its name-tag', async ({ page }) => {
  const cell = page.locator('.wb-grid-cell.wb-cell-linked').first();
  await expect(cell.locator('.wb-style-nametag')).toHaveText('Status style');
  await cell.click();
  await expect(cell.locator('.wb-style-nametag')).toBeVisible();
});

test('double-clicking a linked cell drills into the style', async ({ page }) => {
  await page.locator('.wb-grid-cell.wb-cell-linked').first().dblclick();
  await expect(page.locator('.wb-crumb-root')).toContainText('Column Styles');
  await expect(page.locator('.wb-crumb-tail')).toHaveText('Status');
});

test('the scope chip always names what an edit will hit', async ({ page }) => {
  // nothing selected → view scope
  await expect(page.locator('.wb-scope-chip')).toHaveText('This view only');
  // select the linked Status host cell (its header selects the cell path and
  // opens the column menu); Escape is wired to a global "deselect everything"
  // shortcut (main.ts), so it would clear the very selection we're testing —
  // dismiss the menu with an outside click instead, which only closes the
  // menu and leaves the selection alone.
  await header(page, 'Status').click();
  await expect(page.locator('.wb-grid-menu')).toBeVisible();
  await page.mouse.click(5, 5);
  await expect(page.locator('.wb-grid-menu')).toHaveCount(0);
  await expect(page.locator('.wb-scope-chip')).toHaveText('Host cell · this view only');
  // drill in → style scope with blast count
  await page.locator('.wb-grid-cell.wb-cell-linked').first().dblclick();
  await expect(page.locator('.wb-scope-chip')).toContainText('Status style ·');
});
