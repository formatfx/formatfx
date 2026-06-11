/**
 * E2E: workspace navigation (view ⇄ column formatters), the showcase
 * defaults, wrap-in-parent, the box-model editor and side-pane modes.
 */
import { test, expect, type Page } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
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

test('edit a column formatter, switch back, the view reflects it (CFR round-trip)', async ({ page }) => {
  // open the Status column formatter from the workspace tree
  await page.locator('.wb-doc-header', { hasText: '[$Status]' }).click();
  await expect(page.locator('.wb-current-chip')).toContainText('@currentField → Status');
  // change the pill text via the JSON tab
  await openTab(page, 'json');
  await page.fill('#wb-json-text', JSON.stringify({
    elmType: 'div',
    txtContent: "='»'+[$Status]+'«'",
  }));
  await page.click('#wb-json-apply');
  await expect(page.locator('.wb-mock-row:not(.wb-mock-header) .wb-mock-cell-fmt').first()).toContainText('»In Progress«');
  // back to the view — the CFR renders the edited formatter
  await page.locator('.wb-doc-header', { hasText: 'View formatter' }).click();
  await expect(page.locator('.wb-mock-viewrow').first()).toContainText('»In Progress«');
});

test('one-click topbar copy puts the active formatter JSON on the clipboard', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.click('#wb-copy');
  await expect(page.locator('#wb-toast')).toContainText('JSON copied');
  const text = await page.evaluate(() => navigator.clipboard.readText());
  const parsed = JSON.parse(text);
  expect(parsed.rowFormatter.elmType).toBe('div');
  expect(text).toContain('columnFormatterReference');
});

test('wrap-in-parent works on the root', async ({ page }) => {
  const rootRow = page.locator('.wb-tree-row').first();
  await rootRow.hover();
  await rootRow.locator('button[title*="Wrap"]').click();
  await openTab(page, 'json');
  const json = JSON.parse(await page.inputValue('#wb-json-text'));
  expect(json.rowFormatter.style.display).toBe('flex');
  expect(json.rowFormatter.children).toHaveLength(1);
});

test('box-model editor writes per-side padding to the selected element', async ({ page }) => {
  // select the view root in the tree structure
  await page.locator('.wb-tree-row').first().click();
  const padTop = page.locator('.wb-box-padding input.wb-box-top').first();
  await padTop.fill('33');
  await padTop.blur();
  await expect(page.locator('.wb-mock-viewrow [data-sp-path]').first()).toHaveCSS('padding-top', '33px');
});

test('visual flex editor: a preset writes the layout styles', async ({ page }) => {
  const target = page.locator('.wb-mock-viewrow [data-sp-path]').first();
  await page.locator('.wb-tree-row').first().click();
  await page.locator('.wb-flex-presets button', { hasText: 'Row · spread' }).click();
  await expect(target).toHaveCSS('justify-content', 'space-between');
  await expect(target).toHaveCSS('align-items', 'center');
  // segmented control reflects + changes it
  await page.locator('.wb-flexbtn[title*="Pack in the middle"]').click();
  await expect(target).toHaveCSS('justify-content', 'center');
});

test('box model: arrow-stepping adjusts padding live without losing focus', async ({ page }) => {
  const target = page.locator('.wb-mock-viewrow [data-sp-path]').first();
  await page.locator('.wb-tree-row').first().click();
  const padTop = page.locator('.wb-box-padding input.wb-box-top').first();
  await padTop.click();
  await padTop.press('ArrowUp');
  await padTop.press('ArrowUp');
  await expect(padTop).toBeFocused();
  await expect(target).toHaveCSS('padding-top', '12px'); // showcase starts at 10px
});

test('dark mode recolors sp-css background token classes — engine probe', async ({ page }) => {
  // Pins the visual-compare finding: pills rendered light under wb-dark.
  // If this passes while real captures show light pills, the harness flow
  // (not the engine) is where the light palette leaks in.
  await openTab(page, 'json');
  await page.fill('#wb-json-text', JSON.stringify({
    elmType: 'div',
    attributes: { class: 'sp-css-backgroundColor-neutralLighter' },
    txtContent: 'probe',
  }));
  await page.click('#wb-json-apply');
  const probe = page.locator('.wb-mock-cell-fmt [data-sp-path]').first();
  await expect(probe).toHaveCSS('background-color', 'rgb(243, 242, 241)'); // light #f3f2f1
  await page.click('#wb-theme');
  await expect(page.locator('body')).toHaveClass(/wb-dark/);
  await expect(probe).toHaveCSS('background-color', 'rgb(49, 49, 49)'); // dark #313131
  // the harness reloads between captures — autosave must restore dark too
  await page.reload();
  await expect(page.locator('body')).toHaveClass(/wb-dark/);
  await expect(page.locator('.wb-mock-cell-fmt [data-sp-path]').first())
    .toHaveCSS('background-color', 'rgb(49, 49, 49)');
});

test('customCardProps flyout renders a beak (isBeakVisible)', async ({ page }) => {
  await page.locator('.wb-doc-header', { hasText: 'View formatter' }).click();
  await page.locator('.wb-palette-item', { hasText: 'Hover card' }).click();
  await page.locator('.wb-mock-viewrow .wb-has-card').first().click();
  await expect(page.locator('.wb-flyout-beak')).toBeVisible();
});

test('side pane: auto-hide collapses to a rail, hover opens, outside click closes', async ({ page }) => {
  await page.click('#wb-side-peek');
  const pane = page.locator('#wb-pane-side');
  await expect(pane).toHaveClass(/wb-peek/);
  await expect(page.locator('.wb-side-rail')).toBeVisible();
  await pane.hover();
  await expect(pane).toHaveClass(/wb-peek-open/);
  await page.locator('#wb-canvas').click({ position: { x: 5, y: 5 } });
  await expect(pane).not.toHaveClass(/wb-peek-open/);
  await pane.hover();
  await page.click('#wb-side-peek'); // restore normal mode
  await expect(pane).not.toHaveClass(/wb-peek/);
});

test('side pane: maximize widens the pane', async ({ page }) => {
  const before = (await page.locator('#wb-pane-side').boundingBox())!.width;
  await page.click('#wb-side-max');
  const after = (await page.locator('#wb-pane-side').boundingBox())!.width;
  expect(after).toBeGreaterThan(before + 100);
  await expect(page.locator('#wb-side-max')).toHaveClass(/active/);
  await page.click('#wb-side-max');
});
