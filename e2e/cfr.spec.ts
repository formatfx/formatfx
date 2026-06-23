/**
 * E2E: Stage 4 — the CFR linked-instance (Figma) model. A grid column that
 * renders a shared column format is a LINKED INSTANCE, marked with a teal link
 * badge; its menu offers "Format this Column" (edit the shared format) and
 * "Override in this view" (fork to a local copy). A plain column promotes to a shared
 * format via "Save as the column's format".
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

test('a linked column wears the teal link badge; plain columns do not', async ({ page }) => {
  // Status & Progress ship as CFR cells (registered formatters) → linked
  await expect(header(page, 'Status').locator('.wb-cfr-link')).toHaveCount(1);
  await expect(header(page, 'Progress').locator('.wb-cfr-link')).toHaveCount(1);
  // Title is a plain value column → no link badge
  await expect(header(page, 'Title').locator('.wb-cfr-link')).toHaveCount(0);
});

test('"Override in this view" forks a linked cell local; undo relinks it', async ({ page }) => {
  await header(page, 'Status').click();
  const menu = page.locator('.wb-grid-menu');
  await expect(menu.locator('button', { hasText: 'Format this Column' })).toBeVisible();
  await menu.locator('button', { hasText: 'Override in this view' }).click();
  // local now: the badge is gone, but the cell still renders the pill text
  await expect(header(page, 'Status').locator('.wb-cfr-link')).toHaveCount(0);
  await expect(page.locator('.wb-grid-row').first()).toContainText('In Progress');
  // one undo relinks it
  await page.keyboard.press('Control+z');
  await expect(header(page, 'Status').locator('.wb-cfr-link')).toHaveCount(1);
});

test('"Format this Column" opens the shared column formatter', async ({ page }) => {
  await header(page, 'Status').click();
  await page.locator('.wb-grid-menu button', { hasText: 'Format this Column' }).click();
  // the breadcrumb shows you're now editing the Status column formatter
  await expect(page.locator('.wb-crumb-root')).toContainText('Column Formatters');
  await expect(page.locator('.wb-crumb-tail')).toHaveText('Status');
});

test('"Save as the column\'s format" promotes a plain column to a shared, linked format', async ({ page }) => {
  await header(page, 'Title').click();
  await page.locator('.wb-grid-menu button', { hasText: "Save as the Title column's format" }).click();
  // the cell is now a linked instance → badge appears
  await expect(header(page, 'Title').locator('.wb-cfr-link')).toHaveCount(1);
  // and Title now carries a shared, linked format — its header offers the
  // Figma-model "Format this Column" edit (only registered, linked columns do)
  await header(page, 'Title').click();
  await expect(page.locator('.wb-grid-menu button', { hasText: 'Format this Column' })).toBeVisible();
  await page.keyboard.press('Escape');
  // undo removes the link
  await page.keyboard.press('Control+z');
  await expect(header(page, 'Title').locator('.wb-cfr-link')).toHaveCount(0);
});
