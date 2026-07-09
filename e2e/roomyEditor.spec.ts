/**
 * E2E: the roomy (detached) fx editor. Happy-dom unit tests can't exercise real
 * blur-commit or HTML5 drag-and-drop, so this drives both in a real browser:
 * the editor has no Apply button, a typed formula commits when you click away,
 * and a column chip dragged in inserts its Excel reference.
 */
import { test, expect } from '@playwright/test';
import { freshApp, openPalette, openJson } from './helpers';

test.beforeEach(async ({ page }) => { await freshApp(page, { acceptDialogs: true }); });

test('no Apply button; commits a typed formula on blur; accepts a column drop', async ({ page }) => {
  // a Text element gives the fx bar a formattable slot; it selects on insert
  await openPalette(page);
  await page.locator('.wb-palette-pop .wb-palette-item', { hasText: 'Text' }).first().click();
  await expect(page.locator('.wb-fx-expand')).toBeVisible();

  // open the roomy editor — the Apply button is gone (instant now)
  await page.click('.wb-fx-expand');
  await expect(page.locator('.wb-fx-float')).toBeVisible();
  await expect(page.locator('.wb-fx-float-apply')).toHaveCount(0);

  const editor = page.locator('.wb-fx-float-editor');

  // type a formula and click away → it commits without an Apply click
  await editor.click();
  await editor.press('ControlOrMeta+A');
  await editor.press('Delete');
  await editor.pressSequentially('=[Status]');
  await editor.blur();

  // the committed SP formula is what the Advanced JSON now holds
  await openJson(page);
  await expect(page.locator('#wb-json-text')).toHaveValue(/\[\$Status\]/);

  // drag the Owner column chip onto the editor → its [Owner] reference appears
  await page.locator('.wb-colchip', { hasText: 'Owner' }).dragTo(editor);
  await expect(editor).toHaveValue(/\[Owner\]/);
});
