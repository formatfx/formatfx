/**
 * Visual smoke tests for the sandbox core flows.
 * Run locally: npm run test:ui   (uses your installed Edge/Chrome)
 * Screenshots land in test-results/ for every test.
 */
import { test, expect } from '@playwright/test';
import { freshApp, header, loadExample, openJson, openPalette } from './helpers';

let lastDialog = '';
test.beforeEach(async ({ page }) => {
  // capture dialog messages (some tests assert on them), then a fresh run
  lastDialog = '';
  page.on('dialog', (d) => { lastDialog = d.message(); void d.accept(); });
  await freshApp(page);
});

test('first load shows the grid-first workspace: Lists-style grid, dressed columns render their looks', async ({ page }) => {
  // default is a grid — one column per view column, real headers
  await expect(page.locator('.wb-grid-header-label')).toHaveText(
    ['Title', 'Status', 'DueDate', 'Progress', 'AssignedTo', 'Project']);
  await expect(page.locator('.wb-grid-row')).toHaveCount(3);
  // the canvas tab strip is the navigation: the standing ▦ Grid tab, active
  await expect(page.locator('#wb-canvastabs .wb-canvastab')).toHaveCount(1);
  await expect(page.locator('#wb-canvastabs .wb-canvastab-grid')).toHaveClass(/active/);
  // Owner is dressed but unplaced, so "+ column" can add it, formatted
  await expect(page.locator('.wb-grid-addcol')).toBeVisible();
  // dressed columns render their component looks embedded (pills, data bars)
  await expect(page.locator('.wb-grid-row').first()).toContainText('In Progress');
  await expect(header(page, 'Status').locator('.wb-grid-look')).toHaveCount(1);
});

test('a column example applies as the current column\'s LOOK — the grid renders it', async ({ page }) => {
  await loadExample(page, 'status-pill');
  await expect(page.locator('#wb-toast')).toContainText("applied as the Status column's look");
  // still on the grid — the pill renders per row inside the Status column
  await expect(page.locator('#wb-canvastabs .wb-canvastab-grid')).toHaveClass(/active/);
  const statusCells = page.locator('.wb-grid-cell[data-col="1"]');
  await expect(statusCells.nth(0)).toContainText('In Progress');
  await expect(statusCells.nth(1)).toContainText('Blocked');
  await expect(statusCells.nth(2)).toContainText('Done');
  // conditional background evaluated per row
  await expect(statusCells.nth(2).locator('[data-sp-path]').first())
    .toHaveCSS('background-color', 'rgb(16, 124, 16)');
});

test('palette click inserts an element and selects it', async ({ page }) => {
  await openPalette(page);
  await page.locator('.wb-palette-pop .wb-palette-item', { hasText: 'Traffic light' }).click();
  // on the grid it arrives as a new column, rendered per row and selected
  await expect(page.locator('.wb-grid-header-label')).toHaveCount(7);
  await expect(page.locator('#wb-tree-body .wb-tree-row.selected')).toHaveCount(1);
  await expect(page.locator('#wb-tree-body .wb-tree-name', { hasText: 'Traffic light' })).toBeVisible();
});

test('JSON round-trip: edit JSON, apply, the canvas updates', async ({ page }) => {
  await openJson(page);
  const json = {
    $schema: 'https://developer.microsoft.com/json-schemas/sp/v2/column-formatting.schema.json',
    elmType: 'div',
    txtContent: "='Hello '+[$Title]",
  };
  await page.fill('#wb-json-text', JSON.stringify(json));
  await page.click('#wb-json-apply');
  // a column payload becomes the current field's look, embedded on the grid
  await expect(page.locator('.wb-grid-row').first()).toContainText('Hello Launch new intranet');
});

test('lint panel teaches: nested = gets a verbose, positioned error', async ({ page }) => {
  await openJson(page);
  const bad = {
    rowFormatter: { elmType: 'div', txtContent: "=if([$Title]=='x','y',=if(true,'a','b'))" },
  };
  await page.fill('#wb-json-text', JSON.stringify(bad));
  await page.click('#wb-json-apply');
  const lintItem = page.locator('.wb-lint-item.wb-lint-error', { hasText: "extra '='" });
  await expect(lintItem).toBeVisible();
  await expect(lintItem).toContainText('▶');
  await expect(lintItem).toContainText('renders blank');
});

test('hover card opens as flyout and its content is selectable', async ({ page }) => {
  await openPalette(page);
  await page.locator('.wb-palette-pop .wb-palette-item', { hasText: 'Hover card' }).click();
  await page.locator('.wb-grid .wb-has-card').first().click();
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

test('outlines toggle (in the ☰ menu, behind More…) draws element boxes', async ({ page }) => {
  await page.click('#wb-menu-btn');
  await page.click('#wb-menu-more');
  await page.check('#wb-outlines');
  await expect(page.locator('#wb-canvas')).toHaveClass(/wb-outlines/);
});

test('☰ Preferences: "Structure tree follows selection" defaults on, persists across reloads', async ({ page }) => {
  await page.click('#wb-menu-btn');
  await page.click('#wb-menu-more');
  const cb = page.locator('#wb-pref-tree-follow');
  await expect(cb).toBeVisible();
  await expect(cb).toBeChecked(); // follow is the default
  await cb.uncheck();
  // the pref rides the wb-ui-prefs blob (additive field — frozen-keys rule)
  await expect.poll(() => page.evaluate(
    () => JSON.parse(localStorage.getItem('wb-ui-prefs') ?? '{}').treeFollowSelection,
  )).toBe(false);
  await page.reload();
  await page.click('#wb-menu-btn');
  await page.click('#wb-menu-more');
  await expect(page.locator('#wb-pref-tree-follow')).not.toBeChecked();
});

test('one unified surface — left pane, canvas tab strip and fx bar all present', async ({ page }) => {
  // there is no mode toggle anymore — everything is on screen at once
  await expect(page.locator('#wb-mode')).toHaveCount(0);

  // the Left Edit Pane: lens tabs (Properties/Code — Simple/Pro merged
  // 2026-07-24), the structure tree, the columns shelf, the always-on
  // components library, the views list and the kebab (⋮) menu button
  // (tools + snapshots) are all visible
  await expect(page.locator('.wb-leftpane')).toBeVisible();
  await expect(page.locator('.wb-lens-tab')).toHaveCount(2);
  // the nav row's actions cluster: ← Back + 📷 snapshot (#145) beside the ⋮
  await expect(page.locator('.wb-lp-nav-actions #wb-nav-back')).toBeVisible();
  await expect(page.locator('.wb-lp-nav-actions #wb-nav-snap')).toBeVisible();
  await expect(page.locator('#wb-tree-body')).toBeVisible();
  await expect(page.locator('.wb-colshelf-rack')).toBeVisible();
  await expect(page.locator('#wb-lp-library')).toBeVisible();
  await expect(page.locator('#wb-lp-views')).toBeVisible();
  await expect(page.locator('#wb-kebab-btn')).toBeVisible();
  await expect(page.locator('#wb-fxbar')).toBeVisible();
  // the canvas tab strip is the one navigation surface
  await expect(page.locator('#wb-canvastabs')).toBeVisible();

  // the retired navigation chrome stays gone
  await expect(page.locator('#wb-ribbon')).toHaveCount(0);
  await expect(page.locator('.wb-fmt-tab')).toHaveCount(0);
  await expect(page.locator('#wb-doc-pill')).toHaveCount(0);
  await expect(page.locator('#wb-viewstrip')).toHaveCount(0);

  // the palette popover shows the FULL set — basics AND actions/people/shells
  await openPalette(page);
  const pop = page.locator('.wb-palette-pop');
  await expect(pop.locator('.wb-palette-item', { hasText: 'Status pill' })).toBeVisible();
  await expect(pop.locator('.wb-palette-item', { hasText: 'Start Flow button' })).toBeVisible();
  await expect(pop.locator('.wb-palette-item', { hasText: 'Facepile' })).toBeVisible();
  await expect(pop.locator('.wb-palette-group', { hasText: 'Actions' })).toBeVisible();
  // close the popover so the menu click below is unobstructed
  await page.keyboard.press('Escape');

  // outlines lives in the ☰ menu, behind More… (#257)
  await page.click('#wb-menu-btn');
  await page.click('#wb-menu-more');
  await expect(page.locator('#wb-outlines')).toBeVisible();
  await page.click('#wb-menu-btn');

  // the JSON door reveals the validated-JSON pane (one click away)
  await openJson(page);
  await expect(page.locator('#wb-json-text')).toBeVisible();
});

test('applying name-less JSON over a named design warns before dropping names', async ({ page }) => {
  await openJson(page);
  await page.fill('#wb-json-text', JSON.stringify({ elmType: 'div', txtContent: 'plain' }));
  await page.click('#wb-json-apply');
  expect(lastDialog).toContain('element names');
  // auto-accepted → applied as the current column's look, exactly as warned
  await expect(page.locator('.wb-grid-cell[data-col="1"]').first()).toHaveText('plain');
});

test('drag from palette to canvas highlights the target and drops there', async ({ page }) => {
  const source = async () => {
    await openPalette(page);
    return page.locator('.wb-palette-pop .wb-palette-item', { hasText: 'Icon' }).first();
  };
  const target = page.locator('.wb-grid-cell[data-col="0"] [data-sp-path]').first();
  await (await source()).dragTo(target);
  await expect(page.locator('#wb-toast')).toContainText('Inserted "Icon"');
});

test('narrow shell (#127): the edit pane is a drawer — handle opens, scrim closes', async ({ page }) => {
  await page.setViewportSize({ width: 700, height: 900 });
  const pane = page.locator('.wb-leftpane');
  const handle = page.locator('#wb-lp-drawerbtn');
  // closed by default: the pane sits off-canvas, the floating ✎ handle shows
  await expect(handle).toBeVisible();
  await expect(pane).not.toBeInViewport();
  // …and while closed the pane is inert: off-screen controls leave the tab
  // order and the accessibility tree (Copilot review, PR #304)
  await expect(pane).toHaveAttribute('inert', '');
  // the data dock also lands OPEN by default now (#87 WA — data on land)
  await expect(page.locator('#wb-data-dock')).not.toHaveClass(/wb-min/);
  await handle.click();
  await expect(pane).toBeInViewport();
  await expect(handle).toHaveAttribute('aria-expanded', 'true');
  await expect(pane).not.toHaveAttribute('inert', '');
  // opening moved focus into the pane; Escape closes and hands it back
  await expect.poll(() => page.evaluate(() =>
    document.querySelector('.wb-leftpane')!.contains(document.activeElement))).toBe(true);
  await page.keyboard.press('Escape');
  await expect(pane).not.toBeInViewport();
  await expect(handle).toBeFocused();
  await handle.click();
  await expect(pane).toBeInViewport();
  // the pane is fully usable as a drawer — fold a section through its rail
  await page.locator('.wb-lp-collapsebar[data-sec-bar="views"]').click();
  await expect(page.locator('.wb-lp-sec[data-sec="views"]')).toHaveClass(/wb-collapsed/);
  await page.locator('.wb-lp-collapsebar[data-sec-bar="views"]').click();
  // tapping the scrim dismisses the drawer
  await page.locator('#wb-lp-scrim').click({ position: { x: 650, y: 450 } });
  await expect(pane).not.toBeInViewport();
  // back at desktop width the drawer chrome vanishes, the pane is inline —
  // and never inert
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(handle).toBeHidden();
  await expect(pane).toBeInViewport();
  await expect(pane).not.toHaveAttribute('inert', '');
});

test('narrow topbar: Search/Share go icon-only, Send-to-extension moves into ☰, one row', async ({ page }) => {
  await page.setViewportSize({ width: 700, height: 900 });
  // the buttons stay, their text labels collapse to icons
  await expect(page.locator('#wb-search-open')).toBeVisible();
  await expect(page.locator('#wb-share')).toBeVisible();
  await expect(page.locator('#wb-search-open .wb-btn-label')).toBeHidden();
  await expect(page.locator('#wb-share .wb-btn-label')).toBeHidden();
  await expect(page.locator('#wb-search-open .wb-btn-icnarrow')).toBeVisible();
  // the extension hand-off: the topbar button yields to its ☰ twin (unhide
  // both as the extension-ready announcement would — width picks the ONE
  // that shows)
  await page.evaluate(() => {
    (document.getElementById('wb-send-ext') as HTMLButtonElement).hidden = false;
    (document.getElementById('wb-menu-send-ext') as HTMLButtonElement).hidden = false;
  });
  await expect(page.locator('#wb-send-ext')).toBeHidden();
  await page.click('#wb-menu-btn');
  await expect(page.locator('#wb-menu-send-ext')).toBeVisible();
  await page.mouse.click(350, 500); // outside pointerdown closes the menu
  await expect(page.locator('#wb-menu-panel')).toBeHidden();
  // slimmed chrome fits one row: brand, undo/redo and ☰ share a baseline
  const rowY = async (sel: string): Promise<number> => (await page.locator(sel).boundingBox())!.y;
  const brandY = await rowY('.wb-brand');
  expect(Math.abs(await rowY('#wb-undo') - brandY)).toBeLessThan(8);
  expect(Math.abs(await rowY('#wb-menu-btn') - brandY)).toBeLessThan(8);
  // desktop: labels return, the topbar button owns the hand-off again
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page.locator('#wb-search-open .wb-btn-label')).toBeVisible();
  await expect(page.locator('#wb-share .wb-btn-label')).toBeVisible();
  await expect(page.locator('#wb-send-ext')).toBeVisible();
  await page.click('#wb-menu-btn');
  await expect(page.locator('#wb-save')).toBeVisible(); // the menu really is open…
  await expect(page.locator('#wb-menu-send-ext')).toBeHidden(); // …without the twin
});
