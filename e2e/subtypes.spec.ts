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

/** Import a schema with a Title + three unformatted Choice columns. */
async function importChoiceColumns(page: Page): Promise<void> {
  const choice = (n: string): string => `<Field Type="Choice" Name="${n}" DisplayName="${n}"><CHOICES><CHOICE>A</CHOICE><CHOICE>B</CHOICE></CHOICES></Field>`;
  const schema = {
    schemaXmlList: [
      '<Field Type="Text" Name="Title" DisplayName="Title" ReadOnly="FALSE" />',
      choice('Phase1'), choice('Phase2'), choice('Phase3'),
    ],
  };
  const csv = `ListSchema=${JSON.stringify(schema)}\n`
    + '"Title","Phase1","Phase2","Phase3"\n'
    + '"T","A","B","A"\n';
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

  // stayed on the grid (View Formatters, not drilled); the cell now renders the badge
  await expect(page.locator('.wb-crumb-root')).toContainText('View Formatters');
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

test('Refine: ⋯ on a custom opens the modal; rename + promote a literal to a knob, persisted', async ({ page }) => {
  // seed a custom date subtype with promotable literals (a color, a size)
  await page.evaluate(() => {
    localStorage.setItem('wb-subtypes', JSON.stringify({
      version: 1,
      subtypes: [{
        id: 'custom-date-1', name: 'My Date Look', origin: 'custom', baseTypes: ['date'],
        formatter: { elmType: 'div', txtContent: '=toLocaleDateString(@currentField)', style: { 'background-color': '#107c10', 'padding': '2px 8px' } },
        knobs: [], vocab: { refs: ['@currentField'], values: [] },
      }],
    }));
  });

  await header(page, 'DueDate').click();
  await page.locator('.wb-grid-menu button', { hasText: 'Format this column' }).click();
  // the custom entry exposes a ⋯ refine affordance; built-ins do not
  const row = page.locator('.wb-menu-row', { has: page.locator('.wb-menu-main', { hasText: 'My Date Look' }) });
  await expect(row.locator('.wb-menu-action')).toHaveCount(1);
  await expect(page.locator('.wb-menu-row', { has: page.locator('.wb-menu-main', { hasText: 'Due-date badge' }) }).locator('.wb-menu-action')).toHaveCount(0);
  await row.locator('.wb-menu-action').click();

  // the refine modal opens, pre-filled
  const modal = page.locator('.wb-refine');
  await expect(modal).toBeVisible();
  await expect(modal.locator('.wb-refine-name')).toHaveValue('My Date Look');

  // rename
  await modal.locator('.wb-refine-name').fill('Refined Date');
  // promote the color literal to a knob (by value)
  const lit = modal.locator('.wb-refine-lit', { hasText: '#107c10' });
  await lit.locator('.wb-refine-lit-cb').check();
  await expect(lit.locator('.wb-refine-knob-label')).toBeVisible();
  await lit.locator('.wb-refine-knob-label').fill('Pill color');
  await modal.locator('.wb-refine-save').click();
  await expect(modal).toHaveCount(0);

  // persisted: renamed + a color knob keyed by the literal value
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('wb-subtypes') || '{}'));
  const mine = stored.subtypes.find((s: { id: string }) => s.id === 'custom-date-1');
  expect(mine.name).toBe('Refined Date');
  const knob = mine.knobs.find((k: { path: string }) => k.path === '#107c10');
  expect(knob).toBeTruthy();
  expect(knob.type).toBe('color');
  expect(knob.label).toBe('Pill color');
  expect(knob.default).toBe('#107c10');
});

test('Push-update: refine + "update N columns" re-bakes every tagged column; one Ctrl+Z reverts all', async ({ page }) => {
  // a custom choice subtype whose output is a constant literal (easy to observe)
  await page.evaluate(() => {
    localStorage.setItem('wb-subtypes', JSON.stringify({
      version: 1,
      subtypes: [{
        id: 'custom-tag', name: 'Tag', origin: 'custom', baseTypes: ['choice'],
        formatter: { elmType: 'div', txtContent: "='OLD'" }, knobs: [], vocab: { refs: [], values: [] },
      }],
    }));
  });
  await importChoiceColumns(page); // Title(0) Phase1(1) Phase2(2) Phase3(3)

  // apply the custom to Phase1 and Phase2 (one-click, zero-knob)
  for (const col of ['Phase1', 'Phase2']) {
    await header(page, col).click();
    await page.locator('.wb-grid-menu button', { hasText: 'Format this column' }).click();
    await page.locator('.wb-grid-menu .wb-menu-main', { hasText: 'Tag' }).click();
  }
  const p1 = page.locator('.wb-grid-cell[data-col="1"]').first();
  const p2 = page.locator('.wb-grid-cell[data-col="2"]').first();
  await expect(p1).toHaveText('OLD');
  await expect(p2).toHaveText('OLD');

  // refine via Phase3's catalog (unformatted): promote 'OLD' → change its default to 'NEW'
  await header(page, 'Phase3').click();
  await page.locator('.wb-grid-menu button', { hasText: 'Format this column' }).click();
  const row = page.locator('.wb-menu-row', { has: page.locator('.wb-menu-main', { hasText: 'Tag' }) });
  await row.locator('.wb-menu-action').click();
  const modal = page.locator('.wb-refine');
  await expect(modal).toBeVisible();
  const lit = modal.locator('.wb-refine-lit', { hasText: 'OLD' });
  await lit.locator('.wb-refine-lit-cb').check();
  await lit.locator('.wb-refine-knob-default').fill('NEW');

  // push to the 2 columns already using it
  const push = modal.locator('.wb-refine-push');
  await expect(push).toHaveText(/2 columns/);
  await push.click();
  await expect(modal).toHaveCount(0);

  // both columns re-baked from their stored args to the new default
  await expect(p1).toHaveText('NEW');
  await expect(p2).toHaveText('NEW');

  // ONE Ctrl+Z reverts the whole batch
  await page.keyboard.press('Control+z');
  await expect(p1).toHaveText('OLD');
  await expect(p2).toHaveText('OLD');
});

test('fx bar reads subtype vocab: a tagged column offers ONLY its vocab, hiding unrelated refs', async ({ page }) => {
  // a custom date subtype whose vocab is just the column's own value
  await page.evaluate(() => {
    localStorage.setItem('wb-subtypes', JSON.stringify({
      version: 1,
      subtypes: [{
        id: 'custom-due-fx', name: 'Due fx', origin: 'custom', baseTypes: ['date'],
        formatter: { elmType: 'div', txtContent: 'Due' }, // a plain literal — the text slot is editable
        knobs: [], vocab: { refs: ['@currentField'], values: [] },
      }],
    }));
  });

  // apply it to DueDate, then open that column's formatter (@currentField = DueDate)
  await header(page, 'DueDate').click();
  await page.locator('.wb-grid-menu button', { hasText: 'Format this column' }).click();
  await page.locator('.wb-grid-menu .wb-menu-main', { hasText: 'Due fx' }).click();
  await header(page, 'DueDate').click();
  await page.locator('.wb-grid-menu button', { hasText: 'Change everywhere' }).click();
  await expect(page.locator('.wb-crumb-tail')).toHaveText('DueDate'); // drilled into the DueDate column formatter

  // the fx bar's text slot offers ONLY the vocab (the column's own value) and
  // suppresses the broad all-columns ref padding
  const slot = page.locator('.wb-fx-slot');
  await expect(slot).toBeVisible();
  await slot.selectOption('text');
  await page.locator('.wb-fx-editor').focus(); // the value menu opens on focus
  await expect(page.locator('.wb-fx-menu')).toBeVisible();
  await expect(page.locator('.wb-fx-menu-opt', { hasText: '=[DueDate]' })).toHaveCount(1);
  await expect(page.locator('.wb-fx-menu-opt', { hasText: '=[Title]' })).toHaveCount(0);
});
