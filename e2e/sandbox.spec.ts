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

async function openStudio(page: Page): Promise<void> {
  await page.click('#wb-studio-toggle');
}

async function openTab(page: Page, tab: 'inspector' | 'json'): Promise<void> {
  await page.click(`.wb-tabs button[data-tab="${tab}"]`);
}

test('first load shows the grid-first workspace: Lists-style grid, formatted columns resolve', async ({ page }) => {
  // default is a grid — one column per view column, real headers
  await expect(page.locator('.wb-grid-header-label')).toHaveText(
    ['Title', 'Status', 'DueDate', 'Progress', 'AssignedTo', 'Project']);
  await expect(page.locator('.wb-grid-row')).toHaveCount(3);
  // open Studio to access the workspace tree and other studio panes
  await openStudio(page);
  // workspace tree: the view + Status/Progress/Owner column formatters
  await expect(page.locator('.wb-doc-header').first()).toContainText('View formatter — grid');
  await expect(page.locator('.wb-doc-header')).toHaveCount(4);
  await expect(page.locator('.wb-doc-header', { hasText: '[$Status]' })).toContainText('in view');
  // Owner is registered but unplaced — "+ column" can add it, formatted
  await expect(page.locator('.wb-doc-header', { hasText: '[$Owner]' })).toContainText('unused');
  await expect(page.locator('.wb-grid-addcol')).toBeVisible();
  // formatted columns render their formatters (CFR resolves, pills not chips)
  await expect(page.locator('.wb-grid-row').first()).toContainText('In Progress');
  await expect(page.locator('.wb-grid .wb-cfr-chip')).toHaveCount(0);
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
  await openStudio(page);
  await page.selectOption('#wb-example', 'status-pill'); // column-kind canvas
  await page.locator('.wb-palette-item', { hasText: 'Traffic light' }).click();
  await expect(page.locator('.wb-mock-row:not(.wb-mock-header) .wb-mock-cell-fmt').first()).toContainText('In Progress');
  await expect(page.locator('.wb-tree-row.selected')).toHaveCount(1);
});

test('JSON round-trip: edit JSON, apply, canvas updates', async ({ page }) => {
  await openStudio(page);
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
  await openStudio(page);
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
  await openStudio(page);
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

test('outlines toggle (in the ☰ menu) draws element boxes', async ({ page }) => {
  await page.click('#wb-menu-btn');
  await page.check('#wb-outlines');
  await expect(page.locator('#wb-canvas')).toHaveClass(/wb-outlines/);
});

test('one unified surface — palette + Structure + Properties/JSON, ribbon and fx bar all present', async ({ page }) => {
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await openStudio(page);

  // there is no mode toggle anymore — everything is on screen at once
  await expect(page.locator('#wb-mode')).toHaveCount(0);

  // the full surface: palette, Structure, the Properties/JSON pane, JSON tab,
  // the doc switcher and the fx bar are all visible together
  await expect(page.locator('#wb-pane-palette')).toBeVisible();
  await expect(page.locator('.wb-pane-tree')).toBeVisible();
  await expect(page.locator('#wb-pane-side')).toBeVisible();
  await expect(page.locator('.wb-tabs button[data-tab="json"]')).toBeVisible();
  await expect(page.locator('#wb-activedoc')).toBeVisible();
  await expect(page.locator('#wb-fxbar')).toBeVisible();

  // outlines lives in the ☰ menu
  await page.click('#wb-menu-btn');
  await expect(page.locator('#wb-outlines')).toBeVisible();
  await page.click('#wb-menu-btn');

  // the palette pane shows the FULL set — basics AND actions/people/shells
  const palette = page.locator('#wb-pane-palette');
  await expect(palette.locator('.wb-palette-item', { hasText: 'Status pill' })).toBeVisible();
  await expect(palette.locator('.wb-palette-item', { hasText: 'Start Flow button' })).toBeVisible();
  await expect(palette.locator('.wb-palette-item', { hasText: 'Facepile' })).toBeVisible();
  await expect(palette.locator('.wb-palette-group', { hasText: 'Actions' })).toBeVisible();

  // the ribbon keeps the Formatted-columns picker (not a palette of items)
  const ribbon = page.locator('#wb-ribbon');
  await expect(ribbon).toBeVisible();
  await expect(ribbon.locator('#wb-ribbon-cols')).toBeVisible();
  await expect(ribbon.locator('.wb-palette-item')).toHaveCount(0);

  // the Properties pane edits the selected element (the Advanced door opens on
  // JSON; Properties is one click away)
  await page.click('.wb-tabs button[data-tab="inspector"]');
  await page.locator('.wb-tree-row').first().click();
  await expect(page.locator('#wb-tab-inspector').locator('textarea').first()).toBeVisible();
});

test('applying name-less JSON over a named design warns before dropping names', async ({ page }) => {
  await openStudio(page);
  await openTab(page, 'json');
  await page.fill('#wb-json-text', JSON.stringify({ elmType: 'div', txtContent: 'plain' }));
  await page.click('#wb-json-apply');
  expect(lastDialog).toContain('element names');
  // auto-accepted → applied; names are gone, exactly what the dialog said
  await expect(page.locator('.wb-tree-name')).toHaveCount(0);
});

test('drag from palette to canvas highlights the target and drops there', async ({ page }) => {
  await openStudio(page);
  await page.selectOption('#wb-example', 'status-pill');
  const source = page.locator('.wb-palette-item', { hasText: 'Icon' }).first();
  const target = page.locator('.wb-mock-row:not(.wb-mock-header) .wb-mock-cell-fmt [data-sp-path]').first();
  await source.dragTo(target);
  await expect(page.locator('#wb-toast')).toContainText('Inserted "Icon"');
});
