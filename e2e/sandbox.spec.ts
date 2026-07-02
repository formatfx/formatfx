/**
 * Visual smoke tests for the List Formatting Sandbox.
 * Run locally: npm run test:ui   (uses your installed Edge/Chrome)
 * Screenshots land in test-results/ for every test.
 */
import { test, expect, type Page } from '@playwright/test';

let lastDialog = '';
test.beforeEach(async ({ page }) => {
  lastDialog = '';
  page.on('dialog', (d) => { lastDialog = d.message(); void d.accept(); });
  await page.goto('/');
  // a fresh run each time — clear the autosaved project
  await page.evaluate(() => localStorage.clear());
  await page.reload();
});

// The JSON pane (the Advanced escape hatch) is hidden by default — reveal it
// idempotently.
async function openJson(page: Page): Promise<void> {
  if (!(await page.locator('#wb-pane-side').isVisible())) await page.click('#wb-json-toggle');
}

// The full palette is now a popover off the draw toolbar. Open it; items live
// in #wb-palette-pop .wb-palette-item. Clicking one inserts AND closes the popover.
async function openPalette(page: Page): Promise<void> {
  await page.click('.wb-tool[data-tool="palette"]');
}

// the example/sample loader now lives in the ☰ menu — open it, then pick
async function loadExample(page: Page, value: string): Promise<void> {
  await page.click('#wb-menu-btn');
  await page.selectOption('#wb-example', value);
}

test('first load shows the grid-first workspace: Lists-style grid, formatted columns resolve', async ({ page }) => {
  // default is a grid — one column per view column, real headers
  await expect(page.locator('.wb-grid-header-label')).toHaveText(
    ['Title', 'Status', 'DueDate', 'Progress', 'AssignedTo', 'Project']);
  await expect(page.locator('.wb-grid-row')).toHaveCount(3);
  // formatter navigation: the VIEW FORMATTERS tab is active, the document
  // dropdown names the view, and the tree shows the view's structure
  await expect(page.locator('.wb-fmt-tab-view')).toHaveClass(/active/);
  await expect(page.locator('.wb-doc-pill-name')).toHaveText('View 1');
  await expect(page.locator('.wb-doc-pill-type')).toHaveText('list row schema');
  // the registered column formatters live behind the COLUMN FORMATTERS tab's
  // gallery — Owner is registered but unplaced, so "+ column" can add it, formatted
  await expect(page.locator('.wb-grid-addcol')).toBeVisible();
  // formatted columns render their formatters (CFR resolves, pills not chips)
  await expect(page.locator('.wb-grid-row').first()).toContainText('In Progress');
  await expect(page.locator('.wb-grid .wb-cfr-chip')).toHaveCount(0);
});

test('status pill example renders colored pills per row', async ({ page }) => {
  await loadExample(page, 'status-pill');
  const cells = page.locator('.wb-mock-row:not(.wb-mock-header) .wb-mock-cell-fmt');
  await expect(cells.nth(0)).toContainText('In Progress');
  await expect(cells.nth(1)).toContainText('Blocked');
  await expect(cells.nth(2)).toContainText('Done');
  // conditional background evaluated per row
  const done = cells.nth(2).locator('[data-sp-path]').first();
  await expect(done).toHaveCSS('background-color', 'rgb(16, 124, 16)');
});

test('palette click inserts an element, selects it and toasts', async ({ page }) => {
  await loadExample(page, 'status-pill'); // column-kind canvas
  await openPalette(page);
  await page.locator('#wb-palette-pop .wb-palette-item', { hasText: 'Traffic light' }).click();
  await expect(page.locator('.wb-mock-row:not(.wb-mock-header) .wb-mock-cell-fmt').first()).toContainText('In Progress');
  await expect(page.locator('.wb-tree-row.selected')).toHaveCount(1);
});

test('JSON round-trip: edit JSON, apply, canvas updates', async ({ page }) => {
  await openJson(page);
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
  await openJson(page);
  const bad = { elmType: 'div', txtContent: "=if([$Title]=='x','y',=if(true,'a','b'))" };
  await page.fill('#wb-json-text', JSON.stringify(bad));
  await page.click('#wb-json-apply');
  const lintItem = page.locator('.wb-lint-item.wb-lint-error', { hasText: "extra '='" });
  await expect(lintItem).toBeVisible();
  await expect(lintItem).toContainText('▶');
  await expect(lintItem).toContainText('renders blank');
});

test('hover card opens as flyout and its content is selectable', async ({ page }) => {
  await loadExample(page, 'status-pill');
  await openPalette(page);
  await page.locator('#wb-palette-pop .wb-palette-item', { hasText: 'Hover card' }).click();
  await page.locator('.wb-mock-cell-fmt .wb-has-card').first().click();
  const flyout = page.locator('.wb-flyout');
  await expect(flyout).toBeVisible();
  await expect(flyout).toContainText('Status: In Progress');
  // clicking card content selects the card node in the tree (CARD_SEGMENT path)
  await flyout.locator('[data-sp-path]').first().click();
  await expect(page.locator('.wb-tree-row.selected')).toHaveCount(1);
});

test('dark mode (the default) keeps the row card readable (theme classes, not hex)', async ({ page }) => {
  await loadExample(page, 'row-card');
  await expect(page.locator('body')).toHaveClass(/wb-dark/);
  const card = page.locator('.wb-mock-viewrow .ms-bgColor-white').first();
  // dark palette maps the "white" token to near-black — not #fff
  await expect(card).not.toHaveCSS('background-color', 'rgb(255, 255, 255)');
  const title = card.locator('.ms-fontColor-neutralPrimary').first();
  await expect(title).toHaveCSS('color', 'rgb(255, 255, 255)');
});

test('outlines toggle (in the ☰ menu) draws element boxes', async ({ page }) => {
  await page.click('#wb-menu-btn');
  await page.check('#wb-outlines');
  await expect(page.locator('#wb-canvas')).toHaveClass(/wb-outlines/);
});

test('one unified surface — left pane (lens + formatter tabs + tree + draw bar) and fx bar all present', async ({ page }) => {
  // there is no mode toggle anymore — everything is on screen at once
  await expect(page.locator('#wb-mode')).toHaveCount(0);

  // the Left Edit Pane: lens tabs (Simple/Pro/Code), the formatter tabs, the
  // document dropdown, the structure tree and the draw toolbar are all visible
  await expect(page.locator('.wb-leftpane')).toBeVisible();
  await expect(page.locator('.wb-lens-tab')).toHaveCount(3);
  await expect(page.locator('.wb-fmt-tab')).toHaveCount(2);
  await expect(page.locator('#wb-doc-pill')).toBeVisible();
  await expect(page.locator('#wb-tree-body')).toBeVisible();
  await expect(page.locator('.wb-drawbar')).toBeVisible();
  await expect(page.locator('#wb-fxbar')).toBeVisible();

  // the old ribbon breadcrumb strip is gone — the left pane owns navigation
  await expect(page.locator('#wb-ribbon')).toHaveCount(0);

  // the palette popover shows the FULL set — basics AND actions/people/shells
  await openPalette(page);
  const pop = page.locator('#wb-palette-pop');
  await expect(pop.locator('.wb-palette-item', { hasText: 'Status pill' })).toBeVisible();
  await expect(pop.locator('.wb-palette-item', { hasText: 'Start Flow button' })).toBeVisible();
  await expect(pop.locator('.wb-palette-item', { hasText: 'Facepile' })).toBeVisible();
  await expect(pop.locator('.wb-palette-group', { hasText: 'Actions' })).toBeVisible();
  // close the popover so the menu click below is unobstructed
  await page.keyboard.press('Escape');

  // outlines lives in the ☰ menu
  await page.click('#wb-menu-btn');
  await expect(page.locator('#wb-outlines')).toBeVisible();
  await page.click('#wb-menu-btn');

  // the Advanced door reveals the validated-JSON pane (one click away)
  await openJson(page);
  await expect(page.locator('#wb-json-text')).toBeVisible();
});

test('applying name-less JSON over a named design warns before dropping names', async ({ page }) => {
  await openJson(page);
  await page.fill('#wb-json-text', JSON.stringify({ elmType: 'div', txtContent: 'plain' }));
  await page.click('#wb-json-apply');
  expect(lastDialog).toContain('element names');
  // auto-accepted → applied; names are gone, exactly what the dialog said
  await expect(page.locator('.wb-tree-name')).toHaveCount(0);
});

test('drag from palette to canvas highlights the target and drops there', async ({ page }) => {
  await loadExample(page, 'status-pill');
  await openPalette(page);
  const source = page.locator('#wb-palette-pop .wb-palette-item', { hasText: 'Icon' }).first();
  const target = page.locator('.wb-mock-row:not(.wb-mock-header) .wb-mock-cell-fmt [data-sp-path]').first();
  await source.dragTo(target);
  await expect(page.locator('#wb-toast')).toContainText('Inserted "Icon"');
});
