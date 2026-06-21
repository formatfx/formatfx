// e2e/maker.spec.ts
import { test, expect } from '@playwright/test';

async function openStudio(page: import('@playwright/test').Page): Promise<void> {
  await page.click('#wb-studio-toggle');
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
});

test('first load is grid-first: studio panes hidden, grid full-bleed', async ({ page }) => {
  await expect(page.locator('#wb-layout')).toHaveClass(/wb-maker/);
  await expect(page.locator('.wb-grid')).toBeVisible();
  await expect(page.locator('.wb-pane-palette')).toBeHidden();
  await expect(page.locator('.wb-pane-tree')).toBeHidden();
  await expect(page.locator('.wb-pane-side')).toBeHidden();
  await expect(page.locator('#wb-studio-toggle')).toBeVisible();
});

test('Studio toggle reveals the panes and persists', async ({ page }) => {
  await page.click('#wb-studio-toggle');
  await expect(page.locator('.wb-pane-palette')).toBeVisible();
  await expect(page.locator('.wb-pane-side')).toBeVisible();
  await expect(page.locator('#wb-layout')).not.toHaveClass(/wb-maker/);
  await page.reload();
  await expect(page.locator('.wb-pane-palette')).toBeVisible();
});

test('the single Advanced door is labeled Advanced and opens on the validated-JSON view', async ({ page }) => {
  await expect(page.locator('#wb-studio-toggle')).toContainText('Advanced');
  await page.click('#wb-studio-toggle');
  // opens straight to the JSON escape hatch; Properties stays one click away
  await expect(page.locator('.wb-tabs button[data-tab="json"]')).toHaveClass(/active/);
  await expect(page.locator('#wb-tab-json')).toHaveClass(/active/);
  await expect(page.locator('.wb-tabs button[data-tab="inspector"]')).not.toHaveClass(/active/);
});

test('topbar shows the emergent destination chip, not a Type dropdown', async ({ page }) => {
  // the old upfront Type dropdown is gone from the topbar
  await expect(page.locator('.wb-topbar #wb-kind')).toHaveCount(0);
  // default doc is a grid → saves to the view
  await expect(page.locator('#wb-dest-chip')).toContainText('Saves to the view');
});

test('the kind control lives in the Studio, and loading a column example updates the chip', async ({ page }) => {
  // the kind select moved into the side pane (revealed only in Studio)
  await openStudio(page);
  await expect(page.locator('.wb-pane-side #wb-kind')).toBeVisible();
  // a column-kind example flips the chip to a column destination, naming the column it targets
  await page.selectOption('#wb-example', 'status-pill');
  await expect(page.locator('#wb-dest-chip')).toContainText('Saves to the Status column');
});
