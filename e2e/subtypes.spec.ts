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

/** Reveal the Data dock (it starts collapsed). */
async function openDataDock(page: Page): Promise<void> {
  const dock = page.locator('#wb-data-dock');
  if (await dock.evaluate((el) => el.classList.contains('wb-min'))) {
    await page.click('#wb-data-min');
  }
}

/** Import a schema with an unformatted Currency column (so Money has a target). */
async function importCurrencyColumn(page: Page): Promise<void> {
  const schema = {
    schemaXmlList: [
      '<Field Type="Text" Name="Title" DisplayName="Title" ReadOnly="FALSE" />',
      '<Field Type="Currency" Name="Price" DisplayName="Price" ReadOnly="FALSE" />',
    ],
  };
  const csv = `ListSchema=${JSON.stringify(schema)}\n`
    + '"Title","Price"\n'
    + '"Widget","149.5"\n'
    + '"Gadget","299"\n';
  await openDataDock(page);
  await page.click('button:has-text("Import schema…")');
  await page.fill('.wb-schema-form textarea', csv);
  await page.click('button:has-text("Import pasted text")');
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

test('Money: a knob-bearing subtype opens the apply-time form, refuses invalid, then bakes', async ({ page }) => {
  await importCurrencyColumn(page);
  await expect(page.locator('.wb-grid-cell').filter({ hasText: '€' })).toHaveCount(0);

  await header(page, 'Price').click();
  await page.locator('.wb-grid-menu button', { hasText: 'Format this column' }).click();
  const money = page.locator('.wb-grid-menu button', { hasText: 'Money' });
  await expect(money.locator('.wb-menu-badge')).toHaveText('Built-in');
  await money.click();

  // the knob form opens, pre-filled with the seed defaults
  const form = page.locator('.wb-knobform');
  await expect(form).toBeVisible();
  await expect(form.locator('[data-knob="Symbol"]')).toHaveValue('$');
  await expect(form.locator('[data-knob="Decimals"]')).toHaveValue('2');

  // refuse-and-teach: a single quote in text is rejected; nothing bakes, form stays open
  await form.locator('[data-knob="Symbol"]').fill("x'y");
  await form.locator('.wb-knobform-apply').click();
  await expect(form).toBeVisible();
  await expect(form.locator('.wb-knobform-err').first()).toContainText('quote');
  await expect(page.locator('.wb-grid-cell').filter({ hasText: '€' })).toHaveCount(0);

  // valid input bakes: € symbol, 0 decimals → an integer money string on the grid
  await form.locator('[data-knob="Symbol"]').fill('€');
  await form.locator('[data-knob="Decimals"]').fill('0');
  await form.locator('.wb-knobform-apply').click();
  await expect(form).toHaveCount(0);
  await expect(page.locator('.wb-grid-cell').filter({ hasText: '€' }).first()).toHaveText(/^€\d+$/);
});
