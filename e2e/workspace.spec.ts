/**
 * E2E: workspace navigation (view ⇄ column formatters), the showcase
 * defaults, wrap-in-parent, the box-model editor and the structure pane —
 * re-pointed at the Left Edit Pane UI.
 */
import { test, expect, type Page } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  page.on('dialog', (d) => { void d.accept(); });
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
});

// the JSON ("Advanced") pane is hidden by default — reveal it idempotently
async function openJson(page: Page): Promise<void> {
  if (!(await page.locator('#wb-pane-side').isVisible())) await page.click('#wb-json-toggle');
}

// the palette is a popover off the draw toolbar; clicking an item inserts AND closes it
async function openPalette(page: Page): Promise<void> {
  await page.click('.wb-tool[data-tool="palette"]');
}

// the example/sample loader now lives in the ☰ menu — open it, then pick
async function loadExample(page: Page, value: string): Promise<void> {
  await page.click('#wb-menu-btn');
  await page.selectOption('#wb-example', value);
}

/** Load a known row-layout document (the box-model/alignment fixture):
 *  a flex row with 10px/14px padding, rendered once per mock row. */
async function loadRowFixture(page: Page): Promise<void> {
  await openJson(page);
  await page.fill('#wb-json-text', JSON.stringify({
    rowFormatter: {
      elmType: 'div',
      _elmName: 'Fixture row',
      style: { 'display': 'flex', 'align-items': 'center', 'padding': '10px 14px' },
      children: [{ elmType: 'span', txtContent: '[$Title]' }],
    },
  }));
  await page.click('#wb-json-apply');
}

test('edit a column formatter, switch back, the view reflects it (CFR round-trip)', async ({ page }) => {
  // open the Status column formatter via the COLUMN FORMATTERS tab
  // (Status is first in the registry, so the tab lands on it)
  await page.locator('.wb-fmt-tab-cols').click();
  await expect(page.locator('.wb-doc-pill-name')).toHaveText('Status');
  await expect(page.locator('.wb-current-chip')).toContainText('@currentField → Status');
  // change the pill text via the JSON pane
  await openJson(page);
  await page.fill('#wb-json-text', JSON.stringify({
    elmType: 'div',
    txtContent: "='»'+[$Status]+'«'",
  }));
  await page.click('#wb-json-apply');
  await expect(page.locator('.wb-mock-row:not(.wb-mock-header) .wb-mock-cell-fmt').first()).toContainText('»In Progress«');
  // back to the view — the grid's Status column renders the edited formatter
  await page.locator('.wb-fmt-tab-view').click();
  await expect(page.locator('.wb-grid-row').first()).toContainText('»In Progress«');
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

test('element naming: showcase and presets arrive named, double-click renames, shipped JSON stays clean', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  // the showcase tree reads as names, not anonymous divs
  await expect(page.locator('.wb-tree-name', { hasText: 'Row layout' })).toBeVisible();
  await expect(page.locator('.wb-tree-name', { hasText: 'DueDate' })).toBeVisible();
  // a fresh preset arrives named after its palette label
  await loadExample(page, 'status-pill');
  await expect(page.locator('.wb-tree-name', { hasText: 'Status pill' })).toBeVisible();
  // double-click renames inline
  await page.locator('.wb-tree-row').first().dblclick();
  await page.locator('.wb-tree-rename').fill('My pill');
  await page.locator('.wb-tree-rename').press('Enter');
  await expect(page.locator('.wb-tree-name', { hasText: 'My pill' })).toBeVisible();
  // the JSON pane keeps names so Apply round-trips losslessly…
  await openJson(page);
  expect(await page.inputValue('#wb-json-text')).toContain('"_elmName": "My pill"');
  // …copies keep them by default (SP ignores them); clean is opt-in
  await page.click('#wb-json-copy');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('"_elmName": "My pill"');
  await page.uncheck('#wb-json-names');
  await page.click('#wb-json-copy');
  expect(await page.evaluate(() => navigator.clipboard.readText())).not.toContain('_elmName');
});

test('style editor explains properties: ⓘ opens a doc card with clickable examples', async ({ page }) => {
  await page.locator('.wb-tree-row').first().click();
  const styleSection = page.locator('details.wb-inspector-section')
    .filter({ has: page.locator('summary', { hasText: /^Style/ }) });
  await styleSection.locator('.wb-kv-add').click();
  const row = styleSection.locator('.wb-kv-row').last();
  await row.locator('.wb-kv-key').fill('flex-flow');
  await expect(row.locator('.wb-kv-info')).toHaveClass(/wb-kv-info-known/);
  await row.locator('.wb-kv-info').click();
  const card = row.locator('.wb-doccard');
  await expect(card).toBeVisible();
  await expect(card.locator('.wb-doccard-prop')).toHaveText('flex-flow');
  // the mental model: family diagram + plain-language story + flex glossary
  await expect(card.locator('.wb-doccard-figure svg')).toBeVisible();
  await expect(card.locator('.wb-doccard-plain')).toContainText('shelf');
  await expect(card.locator('.wb-doccard-gloss')).toContainText('justify-content');
  // examples render as chips — clicking one applies it as the value
  await card.locator('.wb-doccard-ex', { hasText: 'row wrap' }).click();
  await expect(row.locator('.wb-kv-val')).toHaveValue('row wrap');
  // glossary terms switch the card without closing it
  await card.locator('.wb-doccard-gloss .wb-doccard-rel', { hasText: 'align-items' }).click();
  await expect(card.locator('.wb-doccard-prop')).toHaveText('align-items');
  // clicking elsewhere closes the card
  await page.locator('.wb-lp-header').click({ position: { x: 4, y: 4 } });
  await expect(card).toBeHidden();
});

test('doc card groups longhands: padding-left gets the padding card, variants switch the row', async ({ page }) => {
  await page.locator('.wb-tree-row').first().click();
  const styleSection = page.locator('details.wb-inspector-section')
    .filter({ has: page.locator('summary', { hasText: /^Style/ }) });
  await styleSection.locator('.wb-kv-add').click();
  const row = styleSection.locator('.wb-kv-row').last();
  await row.locator('.wb-kv-key').fill('padding-left');
  await row.locator('.wb-kv-info').click();
  const card = row.locator('.wb-doccard');
  // one card serves the whole group — variants row lists the siblings
  const variants = card.locator('.wb-doccard-related');
  await expect(variants).toContainText('padding-top');
  await expect(variants.locator('.wb-doccard-rel.active')).toHaveText('padding-left');
  // «syntax» chips render distinctly (box-shadow style notation, not clickable values)
  await variants.locator('.wb-doccard-rel', { hasText: /^padding$/ }).click();
  await expect(row.locator('.wb-kv-key')).toHaveValue('padding');
  await expect(card.locator('.wb-doccard-syntax')).toContainText('top right bottom left');
});

test('style playground: value chips style the sample live, apply merges into selection', async ({ page }) => {
  // select the DueDate grid column's element to apply onto
  await page.locator('.wb-tree-row', { has: page.locator('.wb-tree-name', { hasText: 'DueDate' }) }).click();
  // entry via ☰ menu — consequence-free overlay
  await page.click('#wb-menu-btn');
  await page.click('#wb-playground');
  const pg = page.locator('.wb-pg');
  await expect(pg).toBeVisible();
  // default prop is padding (box family); click a value → the sample chip wears it
  await pg.locator('.wb-pg-val', { hasText: /^16px$/ }).click();
  await expect(page.locator('.wb-pg-target')).toHaveCSS('padding', '16px');
  // it stacks in the readout
  await expect(pg.locator('.wb-pg-out')).toContainText('padding: 16px');
  // switch family to paint, pick a background color
  await pg.locator('.wb-pg-fam', { hasText: 'Paint & ink' }).click();
  await pg.locator('.wb-pg-prop', { hasText: /^background-color$/ }).click();
  await pg.locator('.wb-pg-val', { hasText: '#107c10' }).click();
  await expect(page.locator('.wb-pg-target')).toHaveCSS('background-color', 'rgb(16, 124, 16)');
  // apply to the selected element (the DueDate column, sp-path 2) — merges via the undoable store
  await pg.locator('.wb-pg-apply').click();
  await expect(pg.locator('.wb-pg-apply')).toContainText('Applied');
  await page.keyboard.press('Escape');
  await expect(pg).toBeHidden();
  const target = page.locator('.wb-grid [data-sp-path="2"]').first();
  await expect(target).toHaveCSS('padding', '16px');
  await expect(target).toHaveCSS('background-color', 'rgb(16, 124, 16)');
});

test('doc card links into the playground with the property preselected', async ({ page }) => {
  await page.locator('.wb-tree-row').first().click();
  const styleSection = page.locator('details.wb-inspector-section')
    .filter({ has: page.locator('summary', { hasText: /^Style/ }) });
  await styleSection.locator('.wb-kv-add').click();
  const row = styleSection.locator('.wb-kv-row').last();
  await row.locator('.wb-kv-key').fill('justify-content');
  await row.locator('.wb-kv-info').click();
  await row.locator('.wb-doccard .wb-doccard-play').click();
  const pg = page.locator('.wb-pg');
  await expect(pg).toBeVisible();
  await expect(pg.locator('.wb-pg-fam.active')).toHaveText('Arranging children');
  await expect(pg.locator('.wb-pg-prop.active')).toHaveText('justify-content');
  await expect(pg.locator('.wb-pg-stagelab').first()).toContainText('SHELF');
});

test('Title column toggle hides the context column in the column preview', async ({ page }) => {
  await loadExample(page, 'status-pill');
  await expect(page.locator('.wb-mock-cell:not(.wb-mock-cell-fmt)').first()).toBeVisible();
  await page.uncheck('#wb-titlecol');
  await expect(page.locator('.wb-mock-cell:not(.wb-mock-cell-fmt)').first()).toBeHidden();
  await page.check('#wb-titlecol');
  await expect(page.locator('.wb-mock-cell:not(.wb-mock-cell-fmt)').first()).toBeVisible();
  // the toggle only appears for column-kind previews
  await loadExample(page, 'row-card');
  await expect(page.locator('#wb-titlecol')).toBeHidden();
});

test('wrap-in-parent works on the root', async ({ page }) => {
  const rootRow = page.locator('.wb-tree-row').first();
  await rootRow.hover();
  await rootRow.locator('button[title*="Wrap"]').click();
  await openJson(page);
  const json = JSON.parse(await page.inputValue('#wb-json-text'));
  expect(json.rowFormatter.style.display).toBe('flex');
  expect(json.rowFormatter.children).toHaveLength(1);
});

test('box-model editor writes per-side padding to the selected element', async ({ page }) => {
  await loadRowFixture(page);
  // select the view root in the tree structure, then drop to the Simple lens
  await page.locator('.wb-tree-row').first().click();
  await page.locator('.wb-lens-tab[data-lens="simple"]').click();
  const padTop = page.locator('.wb-box.wb-box-padding input.wb-box-top').first();
  await padTop.fill('33');
  await padTop.blur();
  await expect(page.locator('.wb-mock-viewrow [data-sp-path]').first()).toHaveCSS('padding-top', '33px');
});

test('alignment editor: summary chip opens picker, position grid writes layout styles', async ({ page }) => {
  await loadRowFixture(page);
  const target = page.locator('.wb-mock-viewrow [data-sp-path]').first();
  await page.locator('.wb-tree-row').first().click();
  await page.locator('.wb-lens-tab[data-lens="simple"]').click();
  // summary chip shows a plain-language readout and opens the picker
  const summary = page.locator('.wb-align-summary');
  await expect(summary).toContainText('Side by side');
  await summary.click();
  // 3×3 position grid: click "center · middle" — buttons sit where the result puts content
  await page.locator('.wb-align-cell[title="center · middle"]').click();
  await expect(target).toHaveCSS('justify-content', 'center');
  await expect(target).toHaveCSS('align-items', 'center');
  await expect(summary).toContainText('centered · middle');
  // spread chip switches the main axis to space-between
  await page.locator('.wb-align-chip', { hasText: 'To the edges' }).click();
  await expect(target).toHaveCSS('justify-content', 'space-between');
  // spacing chips are click-only — no typing anywhere in this editor
  await page.locator('.wb-align-chip', { hasText: '8px' }).click();
  await expect(target).toHaveCSS('gap', '8px');
});

test('box model: arrow-stepping adjusts padding live without losing focus', async ({ page }) => {
  await loadRowFixture(page);
  const target = page.locator('.wb-mock-viewrow [data-sp-path]').first();
  await page.locator('.wb-tree-row').first().click();
  await page.locator('.wb-lens-tab[data-lens="simple"]').click();
  const padTop = page.locator('.wb-box.wb-box-padding input.wb-box-top').first();
  await padTop.click();
  await padTop.press('ArrowUp');
  await padTop.press('ArrowUp');
  await expect(padTop).toBeFocused();
  await expect(target).toHaveCSS('padding-top', '12px'); // fixture starts at 10px
});

test('dark mode recolors sp-css background token classes — engine probe', async ({ page }) => {
  // Pins the visual-compare finding: pills rendered light under wb-dark.
  // If this passes while real captures show light pills, the harness flow
  // (not the engine) is where the light palette leaks in.
  await openJson(page);
  await page.fill('#wb-json-text', JSON.stringify({
    elmType: 'div',
    attributes: { class: 'sp-css-backgroundColor-neutralLighter' },
    txtContent: 'probe',
  }));
  await page.click('#wb-json-apply');
  const probe = page.locator('.wb-mock-cell-fmt [data-sp-path]').first();
  await expect(probe).toHaveCSS('background-color', 'rgb(49, 49, 49)'); // dark default #313131
  await page.click('#wb-menu-btn');
  await page.click('#wb-theme');
  await expect(page.locator('body')).not.toHaveClass(/wb-dark/);
  await expect(probe).toHaveCSS('background-color', 'rgb(243, 242, 241)'); // light #f3f2f1
  // the harness reloads between captures — autosave must restore the choice too
  await page.reload();
  await expect(page.locator('body')).not.toHaveClass(/wb-dark/);
  await expect(page.locator('.wb-mock-cell-fmt [data-sp-path]').first())
    .toHaveCSS('background-color', 'rgb(243, 242, 241)');
});

test('customCardProps flyout renders a beak (isBeakVisible)', async ({ page }) => {
  await page.locator('.wb-fmt-tab-view').click();
  // inserts at the grid root — arrives as a new grid column
  await openPalette(page);
  await page.locator('#wb-palette-pop .wb-palette-item', { hasText: 'Hover card' }).click();
  await page.locator('.wb-grid .wb-has-card').first().click();
  await expect(page.locator('.wb-flyout-beak')).toBeVisible();
});

test('Structure pane: formatter tabs + document dropdown frame the active tree', async ({ page }) => {
  // the two formatter tabs are always present; the tree shows the active doc
  await expect(page.locator('.wb-fmt-tab-view')).toBeVisible();
  await expect(page.locator('.wb-fmt-tab-cols')).toBeVisible();
  await expect(page.locator('#wb-doc-pill')).toBeVisible();
  await expect(page.locator('#wb-tree-body .wb-tree-row').first()).toBeVisible();
});

test('Structure pane: the reference row opens & selects that column formatter', async ({ page }) => {
  // the grid's Status column renders another column's formatter — an opaque reference row
  const statusRow = page.locator('.wb-tree-row', { has: page.locator('.wb-tree-name', { hasText: 'Status' }) });
  // the reference row is a sibling of the row (not inside it), so climb to the
  // row's wrap node and find it there; clicking it (not the row) switches the
  // workspace to that column formatter
  const statusStub = statusRow.locator('xpath=following-sibling::*[1]');
  await expect(statusStub).toHaveClass(/wb-tree-stylestub/);
  await statusStub.click();
  await expect(page.locator('.wb-fmt-tab-cols')).toHaveClass(/active/);
  await expect(page.locator('.wb-doc-pill-name')).toHaveText('Status');
  await expect(page.locator('.wb-current-chip')).toContainText('@currentField → Status');
});

test('Structure pane: an unregistered reference row is inert', async ({ page }) => {
  // a view referencing a column with no registered formatter
  await openJson(page);
  await page.fill('#wb-json-text', JSON.stringify({
    rowFormatter: {
      elmType: 'div',
      children: [{ elmType: 'div', columnFormatterReference: '[$Ghost]' }],
    },
  }));
  await page.click('#wb-json-apply');
  // the host node's reference row is marked missing and has no click handler
  const ghostStub = page.locator('.wb-tree-stylestub-missing').first();
  await expect(ghostStub.locator('.wb-stub-name')).toHaveText('Ghost');
  await expect(ghostStub).toHaveAttribute('title', /isn't registered/);
  await ghostStub.click();
  // still on the view — the click went nowhere
  await expect(page.locator('.wb-fmt-tab-view')).toHaveClass(/active/);
});
