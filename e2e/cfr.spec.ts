/**
 * E2E: Stage 4 — the CFR linked-instance (Figma) model. A grid column that
 * renders a shared column format is a LINKED INSTANCE, marked with a teal link
 * badge; its menu offers "Change everywhere" (edit the shared format) and
 * "Override here" (fork to a local copy). A plain column promotes to a shared
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

test('"Override here" forks a linked cell local; undo relinks it', async ({ page }) => {
  await header(page, 'Status').click();
  const menu = page.locator('.wb-grid-menu');
  await expect(menu.locator('button', { hasText: 'Change everywhere' })).toBeVisible();
  await menu.locator('button', { hasText: 'Override here' }).click();
  // local now: the badge is gone, but the cell still renders the pill text
  await expect(header(page, 'Status').locator('.wb-cfr-link')).toHaveCount(0);
  await expect(page.locator('.wb-grid-row').first()).toContainText('In Progress');
  // one undo relinks it
  await page.keyboard.press('Control+z');
  await expect(header(page, 'Status').locator('.wb-cfr-link')).toHaveCount(1);
});

test('"Change everywhere" opens the shared column formatter', async ({ page }) => {
  await header(page, 'Status').click();
  await page.locator('.wb-grid-menu button', { hasText: 'Change everywhere' }).click();
  await expect(page.locator('#wb-activedoc')).toHaveValue('Status');
  await expect(page.locator('#wb-dest-chip')).toContainText('Saves to the Status column');
});

test('"Save as the column\'s format" promotes a plain column to a shared, linked format', async ({ page }) => {
  await header(page, 'Title').click();
  await page.locator('.wb-grid-menu button', { hasText: "Save as the Title column's format" }).click();
  // the cell is now a linked instance → badge appears
  await expect(header(page, 'Title').locator('.wb-cfr-link')).toHaveCount(1);
  // and Title joins the registered column formatters in the workspace switcher
  await expect(page.locator('#wb-activedoc option', { hasText: 'Column: Title' })).toHaveCount(1);
  // undo removes the link
  await page.keyboard.press('Control+z');
  await expect(header(page, 'Title').locator('.wb-cfr-link')).toHaveCount(0);
});
