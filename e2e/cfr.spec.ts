/**
 * E2E: Stage 4 — the CFR linked-instance (Figma) model. A grid column that
 * renders a shared column style is a LINKED INSTANCE, marked with a § style
 * mark; its menu offers "Edit the [Field] style" (edit the shared style) and
 * "Detach from style" (fork to a local copy). A plain column promotes to a shared
 * style via "Save as the [Field] column style".
 */
import { test, expect } from '@playwright/test';
import { freshApp, header } from './helpers';

test.beforeEach(async ({ page }) => { await freshApp(page, { acceptDialogs: true }); });

test('a linked column wears the § style mark; plain columns do not', async ({ page }) => {
  // Status & Progress ship as CFR cells (registered formatters) → linked
  await expect(header(page, 'Status').locator('.wb-cfr-link')).toHaveCount(1);
  await expect(header(page, 'Progress').locator('.wb-cfr-link')).toHaveCount(1);
  // Title is a plain value column → no link badge
  await expect(header(page, 'Title').locator('.wb-cfr-link')).toHaveCount(0);
});

test('"Detach from style" forks a linked cell local; undo relinks it', async ({ page }) => {
  await header(page, 'Status').click();
  const menu = page.locator('.wb-grid-menu');
  await expect(menu.locator('button', { hasText: 'Edit the Status style' })).toBeVisible();
  await menu.locator('button', { hasText: 'Detach from style' }).click();
  // local now: the badge is gone, but the cell still renders the pill text
  await expect(header(page, 'Status').locator('.wb-cfr-link')).toHaveCount(0);
  await expect(page.locator('.wb-grid-row').first()).toContainText('In Progress');
  // one undo relinks it
  await page.keyboard.press('Control+z');
  await expect(header(page, 'Status').locator('.wb-cfr-link')).toHaveCount(1);
});

test('"Edit the Status style" opens the shared column style', async ({ page }) => {
  await header(page, 'Status').click();
  await page.locator('.wb-grid-menu button', { hasText: 'Edit the Status style' }).click();
  // the COLUMN FORMATTERS tab lights up: you're editing the Status column style
  await expect(page.locator('.wb-fmt-tab-cols')).toHaveClass(/active/);
  await expect(page.locator('.wb-doc-pill-name')).toHaveText('Status');
});

test('"Save as the column style" promotes a plain column to a shared, linked style', async ({ page }) => {
  await header(page, 'Title').click();
  await page.locator('.wb-grid-menu button', { hasText: 'Save as the Title column style' }).click();
  // the cell is now a linked instance → badge appears
  await expect(header(page, 'Title').locator('.wb-cfr-link')).toHaveCount(1);
  // and Title now carries a shared, linked style — its header offers the
  // Figma-model "Edit the Title style" edit (only registered, linked columns do)
  await header(page, 'Title').click();
  await expect(page.locator('.wb-grid-menu button', { hasText: 'Edit the Title style' })).toBeVisible();
  await page.keyboard.press('Escape');
  // undo removes the link
  await page.keyboard.press('Control+z');
  await expect(header(page, 'Title').locator('.wb-cfr-link')).toHaveCount(0);
});
