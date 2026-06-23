/**
 * E2E: custom column subtypes — the "Format this column" catalog (US-3),
 * the apply-time knob form (US-4), and Save-as birth (US-5).
 *
 * The menu becomes the type-filtered subtype catalog: built-in seeds and the
 * maker's saved customs, each badged Built-in / Yours, plus "format manually".
 * Picking one snapshot-applies it (the grid renders it, one Ctrl+Z reverts);
 * subtypes whose baseTypes exclude the column never appear.
 */
import { test, expect, type Page } from '@playwright/test';

/** The text a window.prompt() should return next (Save-as name); reset per test. */
let promptAnswer: string | undefined;

test.beforeEach(async ({ page }) => {
  promptAnswer = undefined;
  page.on('dialog', (d) => { void d.accept(promptAnswer); });
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

/** Import a schema with two unformatted Date columns (Start, End). */
async function importTwoDateColumns(page: Page): Promise<void> {
  const schema = {
    schemaXmlList: [
      '<Field Type="Text" Name="Title" DisplayName="Title" ReadOnly="FALSE" />',
      '<Field Type="DateTime" Name="Start" DisplayName="Start" ReadOnly="FALSE" />',
      '<Field Type="DateTime" Name="End" DisplayName="End" ReadOnly="FALSE" />',
    ],
  };
  const csv = `ListSchema=${JSON.stringify(schema)}\n`
    + '"Title","Start","End"\n'
    + '"Task","2026-07-01","2026-08-01"\n';
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

test('Save-as birth: a column format becomes a reusable custom subtype (Yours), forkedFrom the seed', async ({ page }) => {
  await importTwoDateColumns(page);

  // format "Start" with a built-in seed, then save that format as a subtype
  await header(page, 'Start').click();
  await page.locator('.wb-grid-menu button', { hasText: 'Format this column' }).click();
  await page.locator('.wb-grid-menu button', { hasText: 'Due-date badge' }).click();

  promptAnswer = 'My Due Look';
  await header(page, 'Start').click();
  await page.locator('.wb-grid-menu button', { hasText: 'Save as reusable subtype' }).click();

  // persisted to wb-subtypes: a custom, forked from the seed, baseTypes [date]
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('wb-subtypes') || '{}'));
  expect(stored.version).toBe(1);
  const mine = stored.subtypes.find((s: { name: string }) => s.name === 'My Due Look');
  expect(mine).toBeTruthy();
  expect(mine.origin).toBe('custom');
  expect(mine.forkedFrom).toBe('date-badge');
  expect(mine.baseTypes).toEqual(['date']);
  expect(mine.formatter).toBeTruthy();

  // it now shows as "Yours" in the catalog of another date column ("End")
  await header(page, 'End').click();
  await page.locator('.wb-grid-menu button', { hasText: 'Format this column' }).click();
  const yours = page.locator('.wb-grid-menu button', { hasText: 'My Due Look' });
  await expect(yours.locator('.wb-menu-badge')).toHaveText('Yours');
});

test('Save-as normalizes a hand-authored [$Field] column to @currentField (reusable, not frozen)', async ({ page }) => {
  // the showcase Status column ships a hand-authored [$Status] formatter; saving
  // it as a subtype must fold to @currentField so it works on other columns.
  promptAnswer = 'My Status';
  await header(page, 'Status').click();
  await page.locator('.wb-grid-menu button', { hasText: 'Save as reusable subtype' }).click();

  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('wb-subtypes') || '{}'));
  const mine = stored.subtypes.find((s: { name: string }) => s.name === 'My Status');
  expect(mine).toBeTruthy();
  expect(mine.baseTypes).toEqual(['choice']);
  const json = JSON.stringify(mine.formatter);
  expect(json).toContain('@currentField');
  expect(json).not.toContain('[$Status]'); // not frozen to the source column
});
