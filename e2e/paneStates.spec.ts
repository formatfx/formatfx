/**
 * E2E: pane states (spec 2026-07-10). The grid-template, snap-drag and
 * sanitize decisions are unit-tested in paneLayout.test.ts — these specs pin
 * the real-browser wiring: ⛶ covers the canvas and data bar and restores the
 * remembered width, the edit pane minimizes to its bar and back, both states
 * survive a reload, and the syntax color panel dismisses in place.
 */
import { test, expect } from '@playwright/test';
import { freshApp, openJson, openJsonKebab } from './helpers';

test.beforeEach(async ({ page }) => { await freshApp(page); });

test('⛶ maximizes the JSON pane over canvas + data bar, and restores', async ({ page }) => {
  await openJson(page);
  const canvas = page.locator('.wb-pane-canvas');
  const side = page.locator('#wb-pane-side');
  await expect(canvas).toBeVisible();
  const before = (await side.boundingBox())!.width;

  await page.click('#wb-side-max');
  await expect(canvas).toBeHidden(); // the data dock lives inside it — covered too
  await expect(page.locator('#wb-leftpane')).toBeVisible(); // the edit pane stays
  const maxed = (await side.boundingBox())!.width;
  expect(maxed).toBeGreaterThan(before * 1.5);

  await page.click('#wb-side-max');
  await expect(canvas).toBeVisible();
  expect(Math.abs((await side.boundingBox())!.width - before)).toBeLessThan(2);
});

test('stacked (<900px): ⛶ gives the JSON pane everything under the top bar', async ({ page }) => {
  await page.setViewportSize({ width: 700, height: 900 });
  await openJson(page);
  const canvas = page.locator('.wb-pane-canvas');
  const side = page.locator('#wb-pane-side');
  const drawerBtn = page.locator('#wb-lp-drawerbtn');
  await expect(canvas).toBeVisible();
  await expect(drawerBtn).toBeVisible();

  await page.click('#wb-side-max');
  await expect(canvas).toBeHidden();
  await expect(drawerBtn).toBeHidden(); // the floating ✎ would sit over the JSON
  // the pane owns the whole shell below the top bar
  const layoutBox = (await page.locator('#wb-layout').boundingBox())!;
  const sideBox = (await side.boundingBox())!;
  expect(Math.abs(sideBox.height - layoutBox.height)).toBeLessThan(2);

  await page.click('#wb-side-max');
  await expect(canvas).toBeVisible();
  await expect(drawerBtn).toBeVisible();

  // an OPEN drawer must not survive maximize: the scrim blocks mouse clicks
  // on ⛶, but keyboard activation gets through — the drawer (and its scrim)
  // would otherwise keep covering the maximized pane (Copilot review)
  await drawerBtn.click();
  await expect(page.locator('#wb-layout')).toHaveClass(/wb-lp-drawer-open/);
  await page.locator('#wb-side-max').press('Enter'); // focus bypasses the scrim, like Tab would
  await expect(canvas).toBeHidden();
  await expect(page.locator('#wb-layout')).not.toHaveClass(/wb-lp-drawer-open/);
  await expect(page.locator('#wb-leftpane')).not.toBeInViewport();
});

test('the edit pane minimizes to the bar; clicking the bar restores it', async ({ page }) => {
  const pane = page.locator('#wb-leftpane');
  const bar = page.locator('#wb-lp-bar');
  await expect(pane).toBeVisible();
  await expect(bar).toBeHidden();

  await page.click('#wb-lp-collapse');
  await expect(pane).toBeHidden();
  await expect(bar).toBeVisible();

  await bar.click();
  await expect(pane).toBeVisible();
  await expect(bar).toBeHidden();
});

test('pane states survive a reload', async ({ page }) => {
  await openJson(page);
  await page.click('#wb-side-max');
  await page.click('#wb-lp-collapse');
  await page.reload();

  await expect(page.locator('#wb-pane-side')).toBeVisible();
  await expect(page.locator('.wb-pane-canvas')).toBeHidden(); // still maximized
  await expect(page.locator('#wb-lp-bar')).toBeVisible(); // still the bar
});

test('the syntax colors panel hides with × and with Esc — no kebab trip', async ({ page }) => {
  await openJsonKebab(page);
  await page.click('#wb-json-syncolors');
  const panel = page.locator('#wb-syn-panel');
  await expect(panel).toBeVisible();
  await page.click('.wb-syn-close');
  await expect(panel).toBeHidden();

  await openJsonKebab(page);
  await page.click('#wb-json-syncolors');
  await expect(panel).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
});
