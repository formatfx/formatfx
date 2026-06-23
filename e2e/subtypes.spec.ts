/**
 * E2E: custom column subtypes — the "Format this column" catalog (US-3).
 *
 * The menu becomes the type-filtered subtype catalog: built-in seeds and the
 * maker's saved customs, each badged Built-in / Yours, plus "format manually".
 * Picking one snapshot-applies it (the grid renders it, one Ctrl+Z reverts);
 * subtypes whose baseTypes exclude the column never appear.
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

/** Seed a maker-authored (custom) date subtype into the wb-subtypes store. */
async function seedCustomDateSubtype(page: Page): Promise<void> {
  await page.evaluate(() => {
    localStorage.setItem('wb-subtypes', JSON.stringify({
      version: 1,
      subtypes: [{
        id: 'custom-due-1', name: 'My Due Look', origin: 'custom', baseTypes: ['date'],
        formatter: { elmType: 'div', txtContent: '=toLocaleDateString(@currentField)' },
        knobs: [], vocab: { refs: ['@currentField'], values: [] },
      }],
    }));
  });
}

test('catalog lists fitting seeds + customs with Built-in/Yours badges; non-fitting excluded', async ({ page }) => {
  await seedCustomDateSubtype(page);
  await header(page, 'DueDate').click();
  await page.locator('.wb-grid-menu button', { hasText: 'Format this column' }).click();
  await expect(page.locator('.wb-grid-menu-title')).toHaveText('Format DueDate');

  // built-in date seeds, badged
  const dateBadge = page.locator('.wb-grid-menu button', { hasText: 'Due-date badge' });
  await expect(dateBadge.locator('.wb-menu-badge')).toHaveText('Built-in');
  // the maker's custom, badged "Yours"
  const mine = page.locator('.wb-grid-menu button', { hasText: 'My Due Look' });
  await expect(mine.locator('.wb-menu-badge')).toHaveText('Yours');
  // the manual escape hatch is always present
  await expect(page.locator('.wb-grid-menu button', { hasText: 'Format this column manually' })).toBeVisible();
  // a people / choice subtype must never appear on a date column
  await expect(page.locator('.wb-grid-menu button', { hasText: 'Facepile' })).toHaveCount(0);
  await expect(page.locator('.wb-grid-menu button', { hasText: 'Status pill' })).toHaveCount(0);
});

test('picking a seed snapshot-applies it: the cell renders it and Ctrl+Z restores prior state', async ({ page }) => {
  // DueDate (col 2) starts as a plain date cell — no badge chip (inline border-radius)
  const dueCell = page.locator('.wb-grid-cell[data-col="2"]').first();
  await expect(dueCell.locator('[style*="border-radius"]')).toHaveCount(0);

  await header(page, 'DueDate').click();
  await page.locator('.wb-grid-menu button', { hasText: 'Format this column' }).click();
  await page.locator('.wb-grid-menu button', { hasText: 'Due-date badge' }).click();

  // stayed on the grid; the cell now renders the badge (an inline-styled chip)
  await expect(page.locator('#wb-activedoc')).toHaveValue('main');
  await expect(dueCell.locator('[style*="border-radius"]').first()).toBeVisible();

  // a single Ctrl+Z reverts to the plain cell
  await page.keyboard.press('Control+z');
  await expect(dueCell.locator('[style*="border-radius"]')).toHaveCount(0);
});
