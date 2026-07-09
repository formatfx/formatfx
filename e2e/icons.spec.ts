/**
 * E2E: the Fluent icon gallery — the fx bar's Icon slot (preview chips + the
 * searchable popover) and the Field guide's embedded icon wall.
 */
import { test, expect } from '@playwright/test';
import { freshApp, openPalette } from './helpers';

test.beforeEach(async ({ page }) => { await freshApp(page, { acceptDialogs: true }); });

test('fx bar Icon slot: preview chips + searchable gallery applies a name', async ({ page }) => {
  // insert an Icon element (a span with iconName) — it selects on insert
  await openPalette(page);
  await page.locator('.wb-palette-pop .wb-palette-item', { hasText: 'Icon' }).first().click();
  // the fx bar offers an Icon slot
  const slot = page.locator('.wb-fx-slot');
  await expect(slot).toBeVisible();
  await slot.selectOption('attr:iconName');
  // focus the bar to open the value menu — common icons render with previews
  await page.click('.wb-fx-editor');
  await expect(page.locator('.wb-fx-iconsug').first()).toBeVisible();
  // open the full gallery, search, and pick
  await page.click('.wb-fx-iconbrowse');
  await expect(page.locator('.wb-iconpicker')).toBeVisible();
  await page.fill('.wb-icongrid-search', 'flag');
  await expect(page.locator('.wb-iconpicker .wb-icongrid-count')).toContainText('match');
  await page.locator('.wb-iconpicker .wb-iconcell', { hasText: /^Flag$/ }).first().click();
  // picking closes the popover and applies the name to the slot
  await expect(page.locator('.wb-iconpicker')).toHaveCount(0);
  await expect(page.locator('.wb-fx-editor')).toHaveValue('Flag');
});

test('Field guide: the icon gallery page embeds a searchable wall', async ({ page }) => {
  await page.click('#wb-menu-btn');
  await page.click('#wb-guide');
  await page.locator('.wb-guide-navitem', { hasText: 'The icon gallery' }).click();
  const wall = page.locator('#wb-guide-iconwall');
  await expect(wall.locator('.wb-iconcell').first()).toBeVisible();
  await page.fill('#wb-guide-iconwall .wb-icongrid-search', 'calendar');
  await expect(wall.locator('.wb-icongrid-count')).toContainText('match');
  // clicking a cell reports the copied name
  await wall.locator('.wb-iconcell', { hasText: /^Calendar$/ }).first().click();
  await expect(page.locator('.wb-guide-iconwall-note')).toContainText('Calendar');
});
