/**
 * search.spec.ts — the universal search overlay (Ctrl+F / topbar 🔎).
 *
 * Contracts: opening/closing changes nothing; results arrive grouped; a
 * column hit navigates to the grid and pulses the header; inserting a preset
 * happens only behind the card's explicit button (one undoable step); the
 * reference bucket shows the function doc card; the no-match path teaches
 * the no-logical-NOT truth instead of a bare empty state.
 */

import { test, expect } from '@playwright/test';
import { freshApp } from './helpers';

test.describe('universal search', () => {
  test.beforeEach(async ({ page }) => { await freshApp(page); });

  test('Ctrl+F opens, results group by bucket, Esc closes with nothing changed', async ({ page }) => {
    const before = await page.evaluate(() => localStorage.getItem('list-formatting-sandbox.project.v1'));
    await page.keyboard.press('Control+f');
    await expect(page.locator('.wb-search-panel')).toBeVisible();

    await page.fill('.wb-search-input', 'status');
    await expect(page.locator('.wb-search-group').first()).toBeVisible();
    const groups = await page.locator('.wb-search-group').allTextContents();
    expect(groups.some((g) => g.startsWith('Columns & rules'))).toBe(true);

    await page.keyboard.press('Escape');
    await expect(page.locator('.wb-search-panel')).toHaveCount(0);
    const after = await page.evaluate(() => localStorage.getItem('list-formatting-sandbox.project.v1'));
    expect(after).toBe(before); // browsing search never mutates the project
  });

  test('the topbar 🔎 button opens the same overlay', async ({ page }) => {
    await page.click('#wb-search-open');
    await expect(page.locator('.wb-search-panel')).toBeVisible();
    // empty query = the starter hint, not results
    await expect(page.locator('.wb-search-hint')).toBeVisible();
  });

  test('a column hit navigates to the grid and pulses its header', async ({ page }) => {
    await page.keyboard.press('Control+f');
    await page.fill('.wb-search-input', 'DueDate');
    // the COLUMN entry, not the document elements that also mention DueDate
    await page.locator('.wb-search-row[data-group="columns"]', { hasText: 'DueDate' }).first().click();
    await expect(page.locator('.wb-search-panel')).toHaveCount(0);
    await expect(page.locator('.wb-grid-header.wb-search-flash')).toBeVisible();
  });

  test('inserting a preset is behind the card\'s explicit button, one undoable step', async ({ page }) => {
    await page.keyboard.press('Control+f');
    await page.fill('.wb-search-input', 'Container');
    await page.locator('.wb-search-row', { hasText: 'Container' }).first().click();

    // clicking the row only surfaces the preview card — nothing inserted yet
    const insert = page.locator('.wb-search-card-btn', { hasText: 'Insert' });
    await expect(insert).toBeVisible();
    await expect(page.locator('.wb-search-panel')).toBeVisible();

    await insert.click();
    await expect(page.locator('.wb-search-panel')).toHaveCount(0);
    await expect(page.locator('#wb-toast')).toContainText('Inserted');
    await expect(page.locator('#wb-undo')).toBeEnabled();
  });

  test('reference hits show the function doc card', async ({ page }) => {
    await page.keyboard.press('Control+f');
    await page.fill('.wb-search-input', 'toLocaleDateString');
    // the REFERENCE entry — the default workspace's own formulas match too
    await page.locator('.wb-search-row[data-group="reference"]', { hasText: 'toLocaleDateString' }).first().click();
    await expect(page.locator('.wb-search-card-title')).toContainText('toLocaleDateString(date)');
    await expect(page.locator('.wb-search-card-example')).toContainText('=toLocaleDateString(@now)');
    await expect(page.locator('.wb-search-card-btn', { hasText: 'Copy example' })).toBeVisible();
  });

  test('Enter activates the top hit from the keyboard', async ({ page }) => {
    await page.keyboard.press('Control+f');
    await page.fill('.wb-search-input', '@window'); // matches only the two window tokens
    await page.keyboard.press('Enter');
    await expect(page.locator('.wb-search-card-title')).toContainText('@window.innerHeight');
  });

  test('searching for negation teaches the no-logical-NOT rule', async ({ page }) => {
    await page.keyboard.press('Control+f');
    await page.fill('.wb-search-input', 'not(');
    await expect(page.locator('.wb-search-none')).toContainText('no logical NOT');
    await expect(page.locator('.wb-search-none')).toContainText('!=');
  });
});
