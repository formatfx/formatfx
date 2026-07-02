/**
 * E2E: the ribbon breadcrumb — the unified "where am I / where it saves" line.
 * Root crumb = a browse menu (View Formatters or Column Styles); tail crumb
 * = the current doc (= the save target); a relocated Back retraces the drill.
 * The view gets an editable, persisted name.
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

test('the grid view shows View Formatters › View 1, no Back', async ({ page }) => {
  await expect(page.locator('.wb-crumb-root')).toContainText('View Formatters');
  await expect(page.locator('.wb-crumb-tail')).toHaveText('View 1');
  await expect(page.locator('.wb-crumb-back')).toHaveCount(0);
});

test('the root crumb opens the View Formatters menu', async ({ page }) => {
  await page.locator('.wb-crumb-root').click();
  const menu = page.locator('.wb-viewmenu');
  await expect(menu).toBeVisible();
  await expect(menu.locator('.wb-viewmenu-name')).toHaveText('View 1');
  await expect(menu.locator('.wb-viewmenu-rename')).toBeVisible();
});

test('Rename round-trips through the breadcrumb and persists across reload', async ({ page }) => {
  await page.locator('.wb-crumb-root').click();
  await page.locator('.wb-viewmenu-rename').click();
  const input = page.locator('.wb-viewmenu-input');
  await expect(input).toHaveValue('View 1');
  await input.fill('Sprint board');
  await input.press('Enter');
  // the tail crumb updates immediately
  await expect(page.locator('.wb-crumb-tail')).toHaveText('Sprint board');
  // and survives a reload (it's project data, autosaved)
  await page.reload();
  await expect(page.locator('.wb-crumb-tail')).toHaveText('Sprint board');
});

test('on a column doc the root opens the Column Styles menu (Formatted + Not yet formatted)', async ({ page }) => {
  // drill into a formatted column so the breadcrumb shows Column Styles
  await header(page, 'Status').click();
  await page.locator('.wb-grid-menu button', { hasText: 'Edit the Status style' }).click();
  await expect(page.locator('.wb-crumb-root')).toContainText('Column Styles');
  await page.locator('.wb-crumb-root').click();
  const gal = page.locator('.wb-colgal');
  await expect(gal).toBeVisible();
  // Formatted group lists Status (a preview card)…
  await expect(gal.locator('.wb-colgal-card')).not.toHaveCount(0);
  // …and the Not-yet-formatted group lists an unformatted field like Title
  await expect(gal.locator('.wb-colgal-newrow', { hasText: 'Title' })).toBeVisible();
});

test('the Not-yet-formatted group starts a formatter for an unplaced column', async ({ page }) => {
  await header(page, 'Status').click();
  await page.locator('.wb-grid-menu button', { hasText: 'Edit the Status style' }).click();
  await page.locator('.wb-crumb-root').click();
  // Tags is a plain text field with no formatter → start one from the menu
  await page.locator('.wb-colgal .wb-colgal-newrow', { hasText: 'Tags' }).click();
  // a text field has no preset → straight to a manual starter formatter; we
  // land editing the Tags column (breadcrumb tail names it)
  await expect(page.locator('.wb-crumb-tail')).toHaveText('Tags');
});

test('the relocated Back returns to the named view', async ({ page }) => {
  // rename the view first so Back proves it uses the live name
  await page.locator('.wb-crumb-root').click();
  await page.locator('.wb-viewmenu-rename').click();
  await page.locator('.wb-viewmenu-input').fill('Roadmap');
  await page.locator('.wb-viewmenu-input').press('Enter');
  // drill into a column
  await header(page, 'Status').click();
  await page.locator('.wb-grid-menu button', { hasText: 'Edit the Status style' }).click();
  const back = page.locator('.wb-crumb-back');
  await expect(back).toContainText('Back to Roadmap view formatter');
  await back.click();
  await expect(page.locator('.wb-crumb-root')).toContainText('View Formatters');
  await expect(page.locator('.wb-crumb-tail')).toHaveText('Roadmap');
  await expect(page.locator('.wb-crumb-back')).toHaveCount(0);
});
