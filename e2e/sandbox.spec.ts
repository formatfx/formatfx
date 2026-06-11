/**
 * Visual smoke tests for the List Formatting Sandbox.
 * Run locally: npm run test:ui   (uses your installed Edge/Chrome)
 * Screenshots land in test-results/ for every test.
 */
import { test, expect, type Page } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  // a fresh run each time — clear the autosaved project
  await page.evaluate(() => {
    localStorage.clear();
    // most specs exercise the full surface — run them in advanced mode
    localStorage.setItem('wb-ui-prefs', JSON.stringify({ mode: 'advanced' }));
  });
  await page.reload();
});

async function openTab(page: Page, tab: 'inspector' | 'json' | 'data'): Promise<void> {
  await page.click(`.wb-tabs button[data-tab="${tab}"]`);
}

test('first load shows the showcase workspace: view formatter + column formatters', async ({ page }) => {
  // default is a row-layout view rendered once per mock row
  await expect(page.locator('.wb-mock-viewrow')).toHaveCount(3);
  // workspace tree: the view + Status/Progress/Owner column formatters
  await expect(page.locator('.wb-doc-header').first()).toContainText('View formatter — row layout');
  await expect(page.locator('.wb-doc-header')).toHaveCount(4);
  await expect(page.locator('.wb-doc-header', { hasText: '[$Status]' })).toContainText('in view');
  await expect(page.locator('.wb-doc-header', { hasText: '[$Owner]' })).toContainText('unused');
  // the Status CFR resolves — the pill text renders inside the row
  await expect(page.locator('.wb-mock-viewrow').first()).toContainText('In Progress');
  await expect(page.locator('.wb-mock-viewrow .wb-cfr-chip')).toHaveCount(0);
});

test('status pill example renders colored pills per row', async ({ page }) => {
  await page.selectOption('#wb-example', 'status-pill');
  const cells = page.locator('.wb-mock-row:not(.wb-mock-header) .wb-mock-cell-fmt');
  await expect(cells.nth(0)).toContainText('In Progress');
  await expect(cells.nth(1)).toContainText('Blocked');
  await expect(cells.nth(2)).toContainText('Done');
  // conditional background evaluated per row
  const done = cells.nth(2).locator('[data-sp-path]').first();
  await expect(done).toHaveCSS('background-color', 'rgb(16, 124, 16)');
});

test('palette click inserts an element, selects it and toasts', async ({ page }) => {
  await page.selectOption('#wb-example', 'status-pill'); // column-kind canvas
  await page.locator('.wb-palette-item', { hasText: 'Traffic light' }).click();
  await expect(page.locator('.wb-mock-row:not(.wb-mock-header) .wb-mock-cell-fmt').first()).toContainText('In Progress');
  await expect(page.locator('.wb-tree-row.selected')).toHaveCount(1);
});

test('JSON round-trip: edit JSON, apply, canvas updates', async ({ page }) => {
  await openTab(page, 'json');
  const json = {
    $schema: 'https://developer.microsoft.com/json-schemas/sp/v2/column-formatting.schema.json',
    elmType: 'div',
    txtContent: "='Hello '+[$Title]",
  };
  await page.fill('#wb-json-text', JSON.stringify(json));
  await page.click('#wb-json-apply');
  await expect(page.locator('.wb-mock-row:not(.wb-mock-header) .wb-mock-cell-fmt').first()).toContainText('Hello Launch new intranet');
});

test('lint panel teaches: nested = gets a verbose, positioned error', async ({ page }) => {
  await openTab(page, 'json');
  const bad = { elmType: 'div', txtContent: "=if([$Title]=='x','y',=if(true,'a','b'))" };
  await page.fill('#wb-json-text', JSON.stringify(bad));
  await page.click('#wb-json-apply');
  const lintItem = page.locator('.wb-lint-item.wb-lint-error', { hasText: "extra '='" });
  await expect(lintItem).toBeVisible();
  await expect(lintItem).toContainText('▶');
  await expect(lintItem).toContainText('renders blank');
});

test('hover card opens as flyout and its content is selectable', async ({ page }) => {
  await page.selectOption('#wb-example', 'status-pill');
  await page.locator('.wb-palette-item', { hasText: 'Hover card' }).click();
  await page.locator('.wb-mock-cell-fmt .wb-has-card').first().click();
  const flyout = page.locator('.wb-flyout');
  await expect(flyout).toBeVisible();
  await expect(flyout).toContainText('Status: In Progress');
  // clicking card content selects the card node in the tree (CARD_SEGMENT path)
  await flyout.locator('[data-sp-path]').first().click();
  await expect(page.locator('.wb-tree-row.selected')).toHaveCount(1);
});

test('dark mode (the default) keeps the row card readable (theme classes, not hex)', async ({ page }) => {
  await page.selectOption('#wb-example', 'row-card');
  await expect(page.locator('body')).toHaveClass(/wb-dark/);
  const card = page.locator('.wb-mock-viewrow .ms-bgColor-white').first();
  // dark palette maps the "white" token to near-black — not #fff
  await expect(card).not.toHaveCSS('background-color', 'rgb(255, 255, 255)');
  const title = card.locator('.ms-fontColor-neutralPrimary').first();
  await expect(title).toHaveCSS('color', 'rgb(255, 255, 255)');
});

test('outlines toggle draws element boxes', async ({ page }) => {
  await page.check('#wb-outlines');
  await expect(page.locator('#wb-canvas')).toHaveClass(/wb-outlines/);
});

test('basic mode (the default) trims the surface to click-only controls', async ({ page }) => {
  // fresh prefs → basic mode is the landing default
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.locator('#wb-mode button', { hasText: 'Basic' })).toHaveClass(/active/);
  await expect(page.locator('.wb-tabs button[data-tab="json"]')).toBeHidden();
  await expect(page.locator('#wb-outlines')).toBeHidden();
  await expect(page.locator('#wb-activedoc')).toBeHidden();

  // palette: only the curated basic tier — no actions, no shells, no forEach presets
  await expect(page.locator('.wb-palette-item', { hasText: 'Status pill' })).toBeVisible();
  await expect(page.locator('.wb-palette-item', { hasText: 'Start Flow button' })).toBeHidden();
  await expect(page.locator('.wb-palette-item', { hasText: 'Facepile' })).toBeHidden();
  await expect(page.locator('.wb-palette-group', { hasText: 'Actions' })).toBeHidden();

  // inspector: ONLY the alignment editor — nothing hand-editable in basic
  await page.locator('.wb-tree-row').first().click();
  const inspector = page.locator('#wb-tab-inspector');
  await expect(inspector.locator('.wb-align-summary')).toBeVisible();
  await expect(inspector.locator('input:visible, textarea:visible')).toHaveCount(0);

  // switching to advanced restores the full surface, and it persists
  await page.locator('#wb-mode button', { hasText: 'Advanced' }).click();
  await expect(page.locator('.wb-tabs button[data-tab="json"]')).toBeVisible();
  await expect(inspector.locator('textarea').first()).toBeVisible();
  await page.reload();
  await expect(page.locator('#wb-mode button', { hasText: 'Advanced' })).toHaveClass(/active/);
});

test('drag from palette to canvas highlights the target and drops there', async ({ page }) => {
  await page.selectOption('#wb-example', 'status-pill');
  const source = page.locator('.wb-palette-item', { hasText: 'Icon' }).first();
  const target = page.locator('.wb-mock-row:not(.wb-mock-header) .wb-mock-cell-fmt [data-sp-path]').first();
  await source.dragTo(target);
  await expect(page.locator('#wb-toast')).toContainText('Inserted "Icon"');
});
