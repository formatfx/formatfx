/**
 * E2E: the Left Edit Pane's formatter navigation — the VIEW FORMATTERS /
 * COLUMN FORMATTERS tabs plus the document dropdown (the pill naming what's
 * on the canvas). The pill opens the View Formatters menu (rename, + New
 * rowview) or the Column Formatters gallery (previews + Not yet formatted);
 * the view gets an editable, persisted name.
 */
import { test, expect } from '@playwright/test';
import { freshApp, header } from './helpers';

test.beforeEach(async ({ page }) => { await freshApp(page, { acceptDialogs: true }); });

test('the floor lands on the COLUMNS tab — the grid IS columns mode (Stage 2)', async ({ page }) => {
  await expect(page.locator('.wb-fmt-tab-cols')).toHaveClass(/active/);
  await expect(page.locator('.wb-fmt-tab-view')).not.toHaveClass(/active/);
  await expect(page.locator('.wb-doc-pill-name')).toHaveText('Grid');
  // the subtle schema tag names which view schema this compiles to
  await expect(page.locator('.wb-doc-pill-type')).toHaveText('list row schema');
  // the surface pill stays blue — violet is reserved for a drilled column DOC
  await expect(page.locator('.wb-doc-pill')).not.toHaveClass(/wb-doc-pill-col/);
  // the view strip carries no grid chip (no flip-flop button — owner call
  // 2026-07-05): sheets only, plus the ＋ on-ramp
  await expect(page.locator('#wb-viewstrip .wb-viewstrip-chip')).toHaveCount(0);
  await expect(page.locator('#wb-viewstrip .wb-viewstrip-add')).toBeVisible();
});

test('the document dropdown opens the View Formatters menu — the multi-view list', async ({ page }) => {
  await page.locator('#wb-doc-pill').click();
  const menu = page.locator('.wb-viewmenu');
  await expect(menu).toBeVisible();
  // a fresh workspace: the grid floor entry, no views yet, the template on-ramps
  await expect(menu.locator('.wb-viewmenu-floor')).toBeVisible();
  await expect(menu.locator('.wb-viewmenu-empty')).toBeVisible();
  await expect(menu.locator('.wb-viewmenu-newrow')).toBeVisible();
  await expect(menu.locator('.wb-viewmenu-newtile')).toBeVisible();
});

test('a created view is listed, renames inline, and both persist across reload', async ({ page }) => {
  // graduate two columns into a named row view
  await header(page, 'Title').click({ modifiers: ['Control'] });
  await header(page, 'Status').click({ modifiers: ['Control'] });
  await page.locator('.wb-areas-bar button', { hasText: 'Make a row view' }).click();
  await expect(page.locator('.wb-doc-pill-name')).toHaveText('View 1');

  await page.locator('#wb-doc-pill').click();
  await expect(page.locator('.wb-viewmenu-name')).toHaveText('View 1');
  await page.locator('.wb-viewmenu-rename').click();
  const input = page.locator('.wb-viewmenu-input');
  await expect(input).toHaveValue('View 1');
  await input.fill('Sprint board');
  await input.press('Enter');
  // the dropdown updates immediately
  await expect(page.locator('.wb-doc-pill-name')).toHaveText('Sprint board');
  // and survives a reload (views + position are project data, autosaved)
  await page.reload();
  await expect(page.locator('.wb-doc-pill-name')).toHaveText('Sprint board');
  await expect(page.locator('.wb-mock-viewrow')).toHaveCount(3); // still on the view
});

test('the view menu navigates: floor entry minimizes, view row reopens', async ({ page }) => {
  await header(page, 'Title').click({ modifiers: ['Control'] });
  await page.locator('.wb-areas-bar button', { hasText: 'Make a row view' }).click();
  await expect(page.locator('.wb-doc-pill-name')).toHaveText('View 1');
  await page.locator('#wb-doc-pill').click();
  await page.locator('.wb-viewmenu-floor .wb-viewmenu-open').click();
  await expect(page.locator('.wb-doc-pill-name')).toHaveText('Grid');
  await expect(page.locator('.wb-grid')).toBeVisible();
  await page.locator('#wb-doc-pill').click();
  await page.locator('.wb-viewmenu-name', { hasText: 'View 1' }).click();
  await expect(page.locator('.wb-doc-pill-name')).toHaveText('View 1');
  await expect(page.locator('.wb-mock-viewrow')).toHaveCount(3);
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

test('while drilled, the COLUMNS tab drops back to the grid', async ({ page }) => {
  await header(page, 'Status').click();
  await page.locator('.wb-grid-menu button', { hasText: 'Edit the Status style' }).click();
  await expect(page.locator('.wb-fmt-tab-cols')).toHaveClass(/active/);
  await expect(page.locator('.wb-doc-pill')).toHaveClass(/wb-doc-pill-col/);
  await page.locator('.wb-fmt-tab-cols').click();
  await expect(page.locator('.wb-fmt-tab-cols')).toHaveClass(/active/);
  await expect(page.locator('.wb-doc-pill-name')).toHaveText('Grid');
  await expect(page.locator('.wb-grid')).toBeVisible();
});

test('clicking COLUMNS while the grid is up browses the formatted-columns gallery', async ({ page }) => {
  await page.locator('.wb-fmt-tab-cols').click();
  const gal = page.locator('.wb-colgal');
  await expect(gal).toBeVisible();
  await gal.locator('.wb-colgal-card', { has: page.locator('.wb-colgal-label', { hasText: 'Status' }) }).click();
  await expect(page.locator('.wb-doc-pill-name')).toHaveText('Status');
  await expect(page.locator('.wb-doc-pill')).toHaveClass(/wb-doc-pill-col/);
});

test('the VIEWS tab with no sheets yet opens the View Formatters menu (the on-ramp)', async ({ page }) => {
  await page.locator('.wb-fmt-tab-view').click();
  await expect(page.locator('.wb-viewmenu')).toBeVisible();
  await expect(page.locator('.wb-viewmenu-empty')).toBeVisible();
  await expect(page.locator('.wb-viewmenu-newrow')).toBeVisible();
});

test('the VIEWS tab returns to the sheet last on the canvas; COLUMNS minimizes to the grid', async ({ page }) => {
  await header(page, 'Title').click({ modifiers: ['Control'] });
  await page.locator('.wb-areas-bar button', { hasText: 'Make a row view' }).click();
  await expect(page.locator('.wb-doc-pill-name')).toHaveText('View 1');
  await expect(page.locator('.wb-fmt-tab-view')).toHaveClass(/active/);
  // COLUMNS = the grid; the minimize is navigation, the sheet waits in the strip
  await page.locator('.wb-fmt-tab-cols').click();
  await expect(page.locator('.wb-doc-pill-name')).toHaveText('Grid');
  await expect(page.locator('.wb-fmt-tab-cols')).toHaveClass(/active/);
  await expect(page.locator('#wb-viewstrip .wb-viewstrip-chip')).toHaveText('View 1');
  // VIEWS returns to it
  await page.locator('.wb-fmt-tab-view').click();
  await expect(page.locator('.wb-doc-pill-name')).toHaveText('View 1');
  await expect(page.locator('.wb-mock-viewrow')).toHaveCount(3);
});

test('the view strip: chips open sheets, double-click renames, and the surface flips under a drill', async ({ page }) => {
  await header(page, 'Title').click({ modifiers: ['Control'] });
  await page.locator('.wb-areas-bar button', { hasText: 'Make a row view' }).click();
  const chip = page.locator('#wb-viewstrip .wb-viewstrip-chip');
  await expect(chip).toHaveText('View 1');
  await expect(chip).toHaveClass(/active/);

  // double-click renames inline — Enter commits (project metadata, autosaved)
  await chip.dblclick();
  const input = page.locator('.wb-viewstrip-input');
  await input.fill('Sprint board');
  await input.press('Enter');
  await expect(page.locator('#wb-viewstrip .wb-viewstrip-chip')).toHaveText('Sprint board');
  await expect(page.locator('.wb-doc-pill-name')).toHaveText('Sprint board');

  // drop to the grid, drill into a column style…
  await page.locator('.wb-fmt-tab-cols').click();
  await header(page, 'Status').click();
  await page.locator('.wb-grid-menu button', { hasText: 'Edit the Status style' }).click();
  await expect(page.locator('.wb-style-banner')).toBeVisible();
  // …then flip the surface from the strip: the drill stays put (§2.2)
  await page.locator('#wb-viewstrip .wb-viewstrip-chip').click();
  await expect(page.locator('.wb-style-banner')).toBeVisible();
  await expect(page.locator('.wb-doc-pill-name')).toHaveText('Status');
  // Done lands on the sheet that is now underneath
  await page.locator('.wb-style-done').click();
  await expect(page.locator('.wb-doc-pill-name')).toHaveText('Sprint board');
  await expect(page.locator('.wb-mock-viewrow')).toHaveCount(3);
});

test('there is no ribbon bar and no Save/Discard header', async ({ page }) => {
  await expect(page.locator('#wb-ribbon')).toHaveCount(0);
  await expect(page.locator('.wb-lp-save')).toHaveCount(0);
  await expect(page.locator('.wb-lp-discard')).toHaveCount(0);
});
