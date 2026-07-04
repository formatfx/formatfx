/**
 * E2E: the "Format this column" catalog — built-in subtype seeds (knob forms
 * included) + the maker's COMPONENTS as the one "Yours" concept, plus "format
 * manually". Picking one snapshot-applies it (the grid renders it, one Ctrl+Z
 * reverts); entries whose types exclude the column never appear.
 *
 * The old custom-subtype authoring surface ("Save as reusable subtype…", the
 * refine ⋯ modal, push-update) was swallowed by Save as component… — legacy
 * wb-subtypes customs migrate into the component library on first read.
 */
import { test, expect, type Page } from '@playwright/test';
import { freshApp, header, importPastedText } from './helpers';

test.beforeEach(async ({ page }) => { await freshApp(page); });

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
  await importPastedText(page, csv);
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
  await importPastedText(page, csv);
}

/** Seed a LEGACY maker-authored subtype into the retired wb-subtypes store —
 *  the migration must surface it as a component ("Yours"). */
async function seedLegacyCustomSubtype(page: Page): Promise<void> {
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

test('catalog lists fitting seeds + your components; legacy customs migrate in; non-fitting excluded', async ({ page }) => {
  await seedLegacyCustomSubtype(page);
  await header(page, 'DueDate').click();
  await page.locator('.wb-grid-menu button', { hasText: 'Format this column' }).click();
  await expect(page.locator('.wb-grid-menu-title')).toHaveText('Format DueDate');

  // built-in date seeds, badged
  const dateBadge = page.locator('.wb-grid-menu button', { hasText: 'Due-date badge' });
  await expect(dateBadge.locator('.wb-menu-badge')).toHaveText('Built-in');
  // the LEGACY custom migrated into the component library and reads "Yours"
  const mine = page.locator('.wb-grid-menu button', { hasText: 'My Due Look' });
  await expect(mine.locator('.wb-menu-badge')).toHaveText('Yours');
  // …and no entry carries the retired ⋯ refine affordance anymore
  await expect(page.locator('.wb-grid-menu .wb-menu-action')).toHaveCount(0);
  // the manual escape hatch is always present
  await expect(page.locator('.wb-grid-menu button', { hasText: 'Format this column manually' })).toBeVisible();
  // a people / choice entry must never appear on a date column
  await expect(page.locator('.wb-grid-menu button', { hasText: 'Facepile' })).toHaveCount(0);
  await expect(page.locator('.wb-grid-menu button', { hasText: 'Status pill' })).toHaveCount(0);

  // applying the migrated component renders it on the column
  await mine.click();
  await expect(page.locator('.wb-grid-cell[data-col="2"]').first()).not.toHaveText('');
  // and it shows in the ⬡ library under Yours
  await page.locator('.wb-fmt-tab-comp').click();
  await expect(page.locator('.wb-comp-card', { hasText: 'My Due Look' })).toBeVisible();
});

test('picking a seed snapshot-applies it: the cell renders it and Ctrl+Z restores prior state', async ({ page }) => {
  // DueDate (col 2) starts as a plain date cell — no badge chip (inline border-radius)
  const dueCell = page.locator('.wb-grid-cell[data-col="2"]').first();
  await expect(dueCell.locator('[style*="border-radius"]')).toHaveCount(0);

  await header(page, 'DueDate').click();
  await page.locator('.wb-grid-menu button', { hasText: 'Format this column' }).click();
  await page.locator('.wb-grid-menu button', { hasText: 'Due-date badge' }).click();

  // stayed on the grid (View Formatters, not drilled); the cell now renders the badge
  await expect(page.locator('.wb-fmt-tab-view')).toHaveClass(/active/);
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
  await expect(page.locator('.wb-grid-cell').filter({ hasText: '€' }).first()).toContainText(/€\d+$/);
});

test('Save as component: a column format becomes a reusable component (Yours), applies to a sibling column', async ({ page }) => {
  await importTwoDateColumns(page);

  // format "Start" with a single-ref built-in seed, then save it as a component
  // (Due-date badge would derive TWO slots — its recipe also watches [$Status];
  // multi-slot components live in the ⬡ library, not the one-click catalog)
  await header(page, 'Start').click();
  await page.locator('.wb-grid-menu button', { hasText: 'Format this column' }).click();
  await page.locator('.wb-grid-menu button', { hasText: 'Days-until counter' }).click();

  // "Save as component…" opens the save dialog with a derived, typed slot
  await header(page, 'Start').click();
  await page.locator('.wb-grid-menu button', { hasText: 'Save as component…' }).click();
  const dlg = page.locator('.wb-compmap');
  await expect(dlg.locator('.wb-comp-slot')).toContainText(['Start · date']);
  await expect(dlg.locator('.wb-comp-slot')).toHaveCount(1);
  await dlg.locator('.wb-compmap-name').fill('My Due Look');
  await dlg.locator('.wb-compmap-insert').click();

  // persisted to wb-components.v1 with a single date slot
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('wb-components.v1') || '{}'));
  const mine = stored.components.find((c: { name: string }) => c.name === 'My Due Look');
  expect(mine).toBeTruthy();
  expect(mine.slots).toHaveLength(1);
  expect(mine.slots[0].types).toContain('date');

  // it now shows as "Yours" in the catalog of another date column ("End"),
  // and applying it formats that column
  await header(page, 'End').click();
  await page.locator('.wb-grid-menu button', { hasText: 'Format this column' }).click();
  const yours = page.locator('.wb-grid-menu button', { hasText: 'My Due Look' });
  await expect(yours.locator('.wb-menu-badge')).toHaveText('Yours');
  await yours.click();
  // the day counter renders "N days left/overdue" text in End's cells
  await expect(page.locator('.wb-grid-cell[data-col="2"]').first()).toContainText(/days/);
  // snapshot-apply semantics: stayed on the grid, one Ctrl+Z reverts
  await expect(page.locator('.wb-fmt-tab-view')).toHaveClass(/active/);
  await page.keyboard.press('Control+z');
  await expect(page.locator('.wb-grid-cell[data-col="2"]').first()).not.toContainText(/days/);
});

test('the retired subtype-authoring surface is gone: no "Save as reusable subtype", no refine ⋯', async ({ page }) => {
  // the formatted Status column's header menu offers Save as component… instead
  await header(page, 'Status').click();
  await expect(page.locator('.wb-grid-menu button', { hasText: 'Save as reusable subtype' })).toHaveCount(0);
  await expect(page.locator('.wb-grid-menu button', { hasText: 'Save as component…' })).toBeVisible();
  // saving it derives the slot from the hand-authored [$Status] refs — typed choice
  await page.locator('.wb-grid-menu button', { hasText: 'Save as component…' }).click();
  const dlg = page.locator('.wb-compmap');
  await expect(dlg.locator('.wb-comp-slot')).toContainText(['Status · choice / multi-choice']);
  await dlg.locator('.wb-compmap-insert').click();
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('wb-components.v1') || '{}'));
  expect(stored.components).toHaveLength(1);
});

// NOTE: the US-8 vocab-restriction e2e retired with the custom-subtype
// authoring surface — the restriction itself stays unit-pinned in
// fxSuggest.test.ts ("fxSuggestions — subtype vocab (US-8)"); built-in-applied
// columns keep their vocab tags, and component-applied columns degrade to the
// broad suggestions (resolveSubtype optional-chains unknown recipe ids).
