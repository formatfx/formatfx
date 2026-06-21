// e2e/maker.spec.ts
import { test, expect } from '@playwright/test';

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
