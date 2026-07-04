/**
 * E2E: column-style legibility — "violet = shared". The § marks, the name-tag
 * on a selected linked cell, and double-click drill-in. (The left-edge rail
 * was retired: linked cells read via § + hover outline + name-tag only.)
 */
import { test, expect } from '@playwright/test';
import { freshApp, header } from './helpers';

test.beforeEach(async ({ page }) => { await freshApp(page, { acceptDialogs: true }); });

test('linked cells are marked; plain cells are not — and no rail is painted', async ({ page }) => {
  await expect(page.locator('.wb-grid-cell.wb-cell-linked').first()).toBeVisible();
  // Status ships linked; Title does not — compare within the first data row
  const firstRow = page.locator('.wb-grid-row').first();
  await expect(firstRow.locator('.wb-cell-linked')).toHaveCount(2); // Status + Progress ship linked
  // the old violet left-edge rail (an inset box-shadow) is gone
  const shadow = await firstRow.locator('.wb-cell-linked').first()
    .evaluate((el) => getComputedStyle(el).boxShadow);
  expect(shadow).toBe('none');
});

test('the header badge shows the § style mark', async ({ page }) => {
  await expect(header(page, 'Status').locator('.wb-cfr-link')).toHaveText('§');
  await expect(header(page, 'Title').locator('.wb-cfr-link')).toHaveCount(0);
});

test('selecting a linked cell reveals its name-tag', async ({ page }) => {
  const cell = page.locator('.wb-grid-cell.wb-cell-linked').first();
  await expect(cell.locator('.wb-style-nametag')).toHaveText('Status style');
  await cell.click();
  await expect(cell.locator('.wb-style-nametag')).toBeVisible();
});

test('double-clicking a linked cell drills into the style', async ({ page }) => {
  await page.locator('.wb-grid-cell.wb-cell-linked').first().dblclick();
  await expect(page.locator('.wb-fmt-tab-cols')).toHaveClass(/active/);
  await expect(page.locator('.wb-doc-pill-name')).toHaveText('Status');
});

test('the scope chip always names what an edit will hit', async ({ page }) => {
  // nothing selected → view scope
  await expect(page.locator('.wb-scope-chip')).toHaveText('This view only');
  // select the linked Status host cell (its header selects the cell path and
  // opens the column menu); Escape is wired to a global "deselect everything"
  // shortcut (main.ts), so it would clear the very selection we're testing —
  // dismiss the menu with an outside click instead, which only closes the
  // menu and leaves the selection alone.
  await header(page, 'Status').click();
  await expect(page.locator('.wb-grid-menu')).toBeVisible();
  await page.mouse.click(5, 5);
  await expect(page.locator('.wb-grid-menu')).toHaveCount(0);
  await expect(page.locator('.wb-scope-chip')).toHaveText('Host cell · this view only');
  // drill in → style scope with blast count
  await page.locator('.wb-grid-cell.wb-cell-linked').first().dblclick();
  await expect(page.locator('.wb-scope-chip')).toContainText('Status style ·');
});

test('drilling in shows the § banner; Done and Esc both return to the view', async ({ page }) => {
  await page.locator('.wb-grid-cell.wb-cell-linked').first().dblclick();
  const banner = page.locator('.wb-style-banner');
  await expect(banner).toContainText('Editing the Status style');
  await expect(banner).toContainText('changes apply everywhere');
  // Done returns
  await banner.locator('.wb-style-done').click();
  await expect(page.locator('.wb-style-banner')).toHaveCount(0);
  await expect(page.locator('.wb-fmt-tab-view')).toHaveClass(/active/);
  // …and Esc returns too
  await page.locator('.wb-grid-cell.wb-cell-linked').first().dblclick();
  await expect(page.locator('.wb-style-banner')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.wb-style-banner')).toHaveCount(0);
});

test('a CFR host is ONE tree row: click selects the host, the reference tag drills in', async ({ page }) => {
  // the old opaque stub row is gone — a CFR host is a single normal row
  await expect(page.locator('#wb-tree-body .wb-tree-row').first()).toBeVisible();
  await expect(page.locator('.wb-tree-stylestub')).toHaveCount(0);
  const row = page.locator('.wb-tree-row', { has: page.locator('.wb-tree-name', { hasText: 'Status' }) });
  // violet survives as INK only: the § mark and the "reference" tag — no fill
  await expect(row.locator('.wb-style-mark')).toHaveText('§');
  const tag = row.locator('.wb-tree-cfr-open');
  await expect(tag).toHaveText('reference');
  const bg = await row.evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(bg).toBe('rgba(0, 0, 0, 0)');
  // clicking the row selects the HOST element (no drill-in hijack)
  await row.click();
  await expect(page.locator('.wb-fmt-tab-view')).toHaveClass(/active/);
  await expect(page.locator('.wb-scope-chip')).toHaveText('Host cell · this view only');
  // the explicit affordance is the door into the shared column formatter
  await tag.click();
  await expect(page.locator('.wb-fmt-tab-cols')).toHaveClass(/active/);
  await expect(page.locator('.wb-doc-pill-name')).toHaveText('Status');
});

test('an Escape-closable overlay opened while drilled closes itself first; a second Esc exits the style', async ({ page }) => {
  await page.locator('.wb-grid-cell.wb-cell-linked').first().dblclick();
  const banner = page.locator('.wb-style-banner');
  await expect(banner).toBeVisible();
  // open the Column Formatters gallery from the document dropdown — an
  // Escape-owning overlay
  await page.locator('#wb-doc-pill').click();
  const gal = page.locator('.wb-colgal');
  await expect(gal).toBeVisible();
  // first Escape: the gallery owns it — it closes, the drilled style stays
  await page.keyboard.press('Escape');
  await expect(gal).toHaveCount(0);
  await expect(banner).toBeVisible();
  // second Escape: nothing else owns it now — it exits the style
  await page.keyboard.press('Escape');
  await expect(banner).toHaveCount(0);
});

test('the COLUMN FORMATTERS tab lights up when a column formatter is the main document', async ({ page }) => {
  await page.click('#wb-menu-btn');
  await page.selectOption('#wb-example', 'status-pill');
  await expect(page.locator('.wb-fmt-tab-cols')).toHaveClass(/active/);
  await expect(page.locator('.wb-scope-chip')).toContainText('style ·');
});
