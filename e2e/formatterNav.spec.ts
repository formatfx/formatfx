/**
 * E2E: the Left Edit Pane's formatter navigation — the VIEW FORMATTERS /
 * COLUMN FORMATTERS tabs plus the document dropdown (the pill naming what's
 * on the canvas). The pill opens the View Formatters menu (rename, + New
 * rowview) or the Column Formatters gallery (previews + Not yet formatted);
 * the view gets an editable, persisted name.
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

test('the grid view lands on the VIEW FORMATTERS tab with the view named in the dropdown', async ({ page }) => {
  await expect(page.locator('.wb-fmt-tab-view')).toHaveClass(/active/);
  await expect(page.locator('.wb-fmt-tab-cols')).not.toHaveClass(/active/);
  await expect(page.locator('.wb-doc-pill-name')).toHaveText('View 1');
  // the subtle schema tag names which view schema this compiles to
  await expect(page.locator('.wb-doc-pill-type')).toHaveText('list row schema');
  await expect(page.locator('.wb-doc-pill')).not.toHaveClass(/wb-doc-pill-col/);
});

test('the document dropdown opens the View Formatters menu', async ({ page }) => {
  await page.locator('#wb-doc-pill').click();
  const menu = page.locator('.wb-viewmenu');
  await expect(menu).toBeVisible();
  await expect(menu.locator('.wb-viewmenu-name')).toHaveText('View 1');
  await expect(menu.locator('.wb-viewmenu-rename')).toBeVisible();
  // "+ New rowview" lives in this dropdown
  await expect(menu.locator('.wb-viewmenu-newrow')).toBeVisible();
});

test('Rename round-trips through the dropdown and persists across reload', async ({ page }) => {
  await page.locator('#wb-doc-pill').click();
  await page.locator('.wb-viewmenu-rename').click();
  const input = page.locator('.wb-viewmenu-input');
  await expect(input).toHaveValue('View 1');
  await input.fill('Sprint board');
  await input.press('Enter');
  // the dropdown updates immediately
  await expect(page.locator('.wb-doc-pill-name')).toHaveText('Sprint board');
  // and survives a reload (it's project data, autosaved)
  await page.reload();
  await expect(page.locator('.wb-doc-pill-name')).toHaveText('Sprint board');
});

test('on a column doc the dropdown opens the gallery (Formatted + Not yet formatted)', async ({ page }) => {
  // drill into a formatted column so the COLUMN FORMATTERS tab lights up
  await header(page, 'Status').click();
  await page.locator('.wb-grid-menu button', { hasText: 'Edit the Status style' }).click();
  await expect(page.locator('.wb-fmt-tab-cols')).toHaveClass(/active/);
  // the dropdown names the column, with its type as the subtle tag
  await expect(page.locator('.wb-doc-pill-name')).toHaveText('Status');
  await expect(page.locator('.wb-doc-pill-type')).toHaveText('choice column');
  await expect(page.locator('.wb-doc-pill')).toHaveClass(/wb-doc-pill-col/);
  await page.locator('#wb-doc-pill').click();
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
  await page.locator('#wb-doc-pill').click();
  // Tags is a plain text field with no formatter → start one from the menu
  await page.locator('.wb-colgal .wb-colgal-newrow', { hasText: 'Tags' }).click();
  // a text field has no preset → straight to a manual starter formatter; we
  // land editing the Tags column (the dropdown names it)
  await expect(page.locator('.wb-doc-pill-name')).toHaveText('Tags');
});

test('the VIEW FORMATTERS tab returns to the named view', async ({ page }) => {
  // rename the view first so the return proves it uses the live name
  await page.locator('#wb-doc-pill').click();
  await page.locator('.wb-viewmenu-rename').click();
  await page.locator('.wb-viewmenu-input').fill('Roadmap');
  await page.locator('.wb-viewmenu-input').press('Enter');
  // drill into a column
  await header(page, 'Status').click();
  await page.locator('.wb-grid-menu button', { hasText: 'Edit the Status style' }).click();
  await expect(page.locator('.wb-fmt-tab-cols')).toHaveClass(/active/);
  await page.locator('.wb-fmt-tab-view').click();
  await expect(page.locator('.wb-fmt-tab-view')).toHaveClass(/active/);
  await expect(page.locator('.wb-doc-pill-name')).toHaveText('Roadmap');
});

test('the COLUMN FORMATTERS tab opens a registered column formatter', async ({ page }) => {
  await page.locator('.wb-fmt-tab-cols').click();
  await expect(page.locator('.wb-fmt-tab-cols')).toHaveClass(/active/);
  // opens a registered column formatter (registry order: Status first)
  await expect(page.locator('.wb-doc-pill')).toHaveClass(/wb-doc-pill-col/);
  await expect(page.locator('.wb-doc-pill-name')).toHaveText('Status');
  // …and remembers the last-edited column across a round trip
  await page.locator('#wb-doc-pill').click();
  await page.locator('.wb-colgal-card', { has: page.locator('.wb-colgal-label', { hasText: 'Owner' }) }).click();
  await expect(page.locator('.wb-doc-pill-name')).toHaveText('Owner');
  await page.locator('.wb-fmt-tab-view').click();
  await expect(page.locator('.wb-doc-pill-name')).toHaveText('View 1');
  await page.locator('.wb-fmt-tab-cols').click();
  await expect(page.locator('.wb-doc-pill-name')).toHaveText('Owner');
});

test('there is no ribbon bar and no Save/Discard header', async ({ page }) => {
  await expect(page.locator('#wb-ribbon')).toHaveCount(0);
  await expect(page.locator('.wb-lp-save')).toHaveCount(0);
  await expect(page.locator('.wb-lp-discard')).toHaveCount(0);
});
