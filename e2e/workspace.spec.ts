/**
 * E2E: workspace navigation (view ⇄ column formatters), the showcase
 * defaults, wrap-in-parent, the box-model editor and side-pane modes.
 */
import { test, expect, type Page } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  page.on('dialog', (d) => { void d.accept(); });
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
});

async function openStudio(page: Page): Promise<void> {
  await page.click('#wb-studio-toggle');
  // the Advanced door now opens on the validated-JSON tab; these specs drive
  // the Properties pane, so land there explicitly.
  await page.click('.wb-tabs button[data-tab="inspector"]');
}

// the example/sample loader now lives in the ☰ menu — open it, then pick
async function loadExample(page: Page, value: string): Promise<void> {
  await page.click('#wb-menu-btn');
  await page.selectOption('#wb-example', value);
}

async function openTab(page: Page, tab: 'inspector' | 'json' | 'data'): Promise<void> {
  await page.click(`.wb-tabs button[data-tab="${tab}"]`);
}

/** Load a known row-layout document (the box-model/alignment fixture):
 *  a flex row with 10px/14px padding, rendered once per mock row. */
async function loadRowFixture(page: Page): Promise<void> {
  await openStudio(page);
  await openTab(page, 'json');
  await page.fill('#wb-json-text', JSON.stringify({
    rowFormatter: {
      elmType: 'div',
      _elmName: 'Fixture row',
      style: { 'display': 'flex', 'align-items': 'center', 'padding': '10px 14px' },
      children: [{ elmType: 'span', txtContent: '[$Title]' }],
    },
  }));
  await page.click('#wb-json-apply');
  await openTab(page, 'inspector');
}

test('edit a column formatter, switch back, the view reflects it (CFR round-trip)', async ({ page }) => {
  await openStudio(page);
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
  // back to the view — the grid's Status column renders the edited formatter
  await page.locator('.wb-doc-header', { hasText: 'View formatter' }).click();
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
  await openStudio(page);
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
  // the JSON tab keeps names so Apply round-trips losslessly…
  await openTab(page, 'json');
  expect(await page.inputValue('#wb-json-text')).toContain('"_elmName": "My pill"');
  // …copies keep them by default (SP ignores them); clean is opt-in
  await page.click('#wb-json-copy');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('"_elmName": "My pill"');
  await page.uncheck('#wb-json-names');
  await page.click('#wb-json-copy');
  expect(await page.evaluate(() => navigator.clipboard.readText())).not.toContain('_elmName');
});

test('style editor explains properties: ⓘ opens a doc card with clickable examples', async ({ page }) => {
  await openStudio(page);
  await page.locator('.wb-tree-row').first().click();
  const styleSection = page.locator('details.wb-inspector-section')
    .filter({ has: page.locator('summary', { hasText: /^Style$/ }) });
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
  await page.locator('.wb-pane-palette .wb-pane-title').click();
  await expect(card).toBeHidden();
});

test('doc card groups longhands: padding-left gets the padding card, variants switch the row', async ({ page }) => {
  await openStudio(page);
  await page.locator('.wb-tree-row').first().click();
  const styleSection = page.locator('details.wb-inspector-section')
    .filter({ has: page.locator('summary', { hasText: /^Style$/ }) });
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
  await openStudio(page);
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
  // apply to the selected element (root) — merges via the undoable store
  await pg.locator('.wb-pg-apply').click();
  await expect(pg.locator('.wb-pg-apply')).toContainText('Applied');
  await page.keyboard.press('Escape');
  await expect(pg).toBeHidden();
  const target = page.locator('.wb-grid [data-sp-path="2"]').first();
  await expect(target).toHaveCSS('padding', '16px');
  await expect(target).toHaveCSS('background-color', 'rgb(16, 124, 16)');
});

test('doc card links into the playground with the property preselected', async ({ page }) => {
  await openStudio(page);
  await page.locator('.wb-tree-row').first().click();
  const styleSection = page.locator('details.wb-inspector-section')
    .filter({ has: page.locator('summary', { hasText: /^Style$/ }) });
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

test('element playground: real subtree, masked children, stash & resume, apply', async ({ page }) => {
  await openStudio(page);
  // open the playground ON the grid root (a real element with named children)
  await page.locator('.wb-tree-row', { has: page.locator('.wb-tree-name', { hasText: 'Row layout' }) }).click();
  await page.locator('.wb-inspector-play').click();
  const pg = page.locator('.wb-pg');
  await expect(pg).toBeVisible();
  await expect(pg.locator('.wb-pg-tree-target .wb-pg-tree-name')).toHaveText('Row layout');
  // children render for real but are masked with their names (click-to-descend)
  await expect(pg.locator('.wb-pgx-child[data-pgx-name="Title"]')).toBeVisible();
  // dial in a pick (padding family is the default)
  await pg.locator('.wb-pg-val', { hasText: /^8px$/ }).click();
  await expect(pg.locator('.wb-pg-out')).toContainText('padding: 8px');
  // stash & close — consequence-free, the document is untouched
  await pg.locator('button', { hasText: 'Stash & close' }).click();
  await expect(pg).toBeHidden();
  await openTab(page, 'json');
  expect(await page.inputValue('#wb-json-text')).not.toContain('"padding": "8px"');
  // reopen → the stash resumes
  await openTab(page, 'inspector');
  await page.locator('.wb-inspector-play').click();
  await expect(pg.locator('.wb-pg-out')).toContainText('padding: 8px');
  // descend into a child via the structure tree and come back — picks
  // survive the round trip (the stash dot marks the parent meanwhile)
  await pg.locator('.wb-pg-tree-child', { hasText: 'Title' }).first().click();
  await expect(pg.locator('.wb-pg-tree-target .wb-pg-tree-name')).toHaveText('Title');
  await expect(pg.locator('.wb-pg-tree-ancestor', { hasText: 'Row layout' }).locator('.wb-pg-tree-stash')).toBeVisible();
  await pg.locator('.wb-pg-tree-ancestor', { hasText: 'Row layout' }).click();
  await expect(pg.locator('.wb-pg-out')).toContainText('padding: 8px');
  // apply for real this time
  await pg.locator('.wb-pg-apply').click();
  await page.keyboard.press('Escape');
  await openTab(page, 'json');
  expect(await page.inputValue('#wb-json-text')).toContain('"padding": "8px"');
  // applying must never cost an element its name (tree falls back to a
  // class hint when _elmName is lost — that's the bug signature)
  await expect(page.locator('.wb-tree-name', { hasText: 'Row layout' })).toBeVisible();
  expect(await page.inputValue('#wb-json-text')).toContain('"_elmName": "Row layout"');
});

test('playground polish: quick looks stack whole bundles, the property card applies examples, current styles are listed', async ({ page }) => {
  await openStudio(page);
  await page.locator('.wb-tree-row', { has: page.locator('.wb-tree-name', { hasText: 'Row layout' }) }).click();
  await page.locator('.wb-inspector-play').click();
  const pg = page.locator('.wb-pg');
  // one click dresses the element in the whole pill bundle…
  await pg.locator('.wb-pg-macro', { hasText: 'Pill' }).click();
  await expect(pg.locator('.wb-pg-out')).toContainText('border-radius: 12px');
  await expect(pg.locator('.wb-pg-out')).toContainText('padding: 2px 10px');
  // …and a second click takes the whole look off again
  await pg.locator('.wb-pg-macro', { hasText: 'Pill' }).click();
  await expect(pg.locator('.wb-pg-out')).not.toContainText('border-radius');
  // the formatted property card: clicking an example applies it as a pick
  await expect(pg.locator('.wb-pg-doc-prop')).toHaveText('padding');
  await pg.locator('.wb-pg-doc .wb-doccard-ex').first().click();
  await expect(pg.locator('.wb-pg-out')).toContainText('padding: 2px 10px');
  // what the element already wears is listed (the grid root is a flex row)
  await expect(pg.locator('.wb-pg-cur-row', { hasText: 'display' })).toBeVisible();
  await expect(pg.locator('.wb-pg-cur-row', { hasText: 'gap' })).toContainText('12px');
});

test('element playground marks CFR slots and can enter the referenced formatter', async ({ page }) => {
  await openStudio(page);
  await page.locator('.wb-tree-row').first().click(); // Row layout root
  await page.locator('.wb-inspector-play').click();
  const pg = page.locator('.wb-pg');
  // the CFR child's overlay says where its content comes from
  await expect(pg.locator('.wb-pgx-child[data-pgx-name="Progress ⤷ [$Progress]"]')).toBeVisible();
  // descend into the slot — the structure tree offers to open the referenced formatter
  await pg.locator('.wb-pg-tree-child', { hasText: 'Progress' }).first().click();
  await expect(pg.locator('.wb-pg-stagelab').first()).toContainText('content is rendered by the [$Progress] column formatter');
  await pg.locator('.wb-pg-navcfr').click(); // confirm() auto-accepted
  // the playground now targets the column formatter's root…
  await expect(pg.locator('.wb-pg-tree-target .wb-pg-tree-name')).toHaveText('Progress bar');
  // …because the workspace switched to editing [$Progress]
  await expect(page.locator('.wb-crumb-tail')).toHaveText('Progress');
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
  await openStudio(page);
  const rootRow = page.locator('.wb-tree-row').first();
  await rootRow.hover();
  await rootRow.locator('button[title*="Wrap"]').click();
  await openTab(page, 'json');
  const json = JSON.parse(await page.inputValue('#wb-json-text'));
  expect(json.rowFormatter.style.display).toBe('flex');
  expect(json.rowFormatter.children).toHaveLength(1);
});

test('box-model editor writes per-side padding to the selected element', async ({ page }) => {
  await loadRowFixture(page);
  // select the view root in the tree structure
  await page.locator('.wb-tree-row').first().click();
  const padTop = page.locator('.wb-box-padding input.wb-box-top').first();
  await padTop.fill('33');
  await padTop.blur();
  await expect(page.locator('.wb-mock-viewrow [data-sp-path]').first()).toHaveCSS('padding-top', '33px');
});

test('alignment editor: summary chip opens picker, position grid writes layout styles', async ({ page }) => {
  await loadRowFixture(page);
  const target = page.locator('.wb-mock-viewrow [data-sp-path]').first();
  await page.locator('.wb-tree-row').first().click();
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
  const padTop = page.locator('.wb-box-padding input.wb-box-top').first();
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
  await openStudio(page);
  await openTab(page, 'json');
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
  await openStudio(page);
  await page.locator('.wb-doc-header', { hasText: 'View formatter' }).click();
  // inserts at the grid root — arrives as a new grid column
  await page.locator('.wb-palette-item', { hasText: 'Hover card' }).click();
  await page.locator('.wb-grid .wb-has-card').first().click();
  await expect(page.locator('.wb-flyout-beak')).toBeVisible();
});

test('side pane: auto-hide collapses to a rail, hover opens, outside click closes', async ({ page }) => {
  await openStudio(page);
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
  await openStudio(page);
  const before = (await page.locator('#wb-pane-side').boundingBox())!.width;
  await page.click('#wb-side-max');
  const after = (await page.locator('#wb-pane-side').boundingBox())!.width;
  expect(after).toBeGreaterThan(before + 100);
  await expect(page.locator('#wb-side-max')).toHaveClass(/active/);
  await page.click('#wb-side-max');
});

test('Structure pane: view + column sections collapse independently', async ({ page }) => {
  await openStudio(page);
  // both sections live side-by-side: the view formatter on top, columns below
  await expect(page.locator('#wb-tree-view .wb-doc-header', { hasText: 'View formatter' })).toBeVisible();
  await expect(page.locator('#wb-tree-cols .wb-doc-header', { hasText: '[$Status]' })).toBeVisible();
  // collapse the top section — its body hides, the columns stay
  await page.click('#wb-tree-view-head');
  await expect(page.locator('#wb-tree-view')).toBeHidden();
  await expect(page.locator('#wb-tree-cols')).toBeVisible();
  await page.click('#wb-tree-view-head'); // restore
  await expect(page.locator('#wb-tree-view')).toBeVisible();
  // collapse the bottom section independently
  await page.click('#wb-tree-cols-head');
  await expect(page.locator('#wb-tree-cols')).toBeHidden();
  await expect(page.locator('#wb-tree-view')).toBeVisible();
});

test('Structure pane: a ⤷ chip opens & selects that column formatter below', async ({ page }) => {
  await openStudio(page);
  // the grid's Status column renders another column's formatter (⤷ chip)
  const statusRow = page.locator('.wb-tree-row', { has: page.locator('.wb-tree-name', { hasText: 'Status' }) });
  // clicking the chip (not the row) slips over to the column section and selects it
  await statusRow.locator('.wb-chip-cfr').click();
  await expect(page.locator('#wb-tree-cols .wb-doc-header.active')).toContainText('[$Status]');
  await expect(page.locator('.wb-current-chip')).toContainText('@currentField → Status');
});

test('Structure pane: a ⤷ chip for an unregistered ref lands on the missing row', async ({ page }) => {
  await openStudio(page);
  // a view referencing a column with no registered formatter
  await openTab(page, 'json');
  await page.fill('#wb-json-text', JSON.stringify({
    rowFormatter: {
      elmType: 'div',
      children: [{ elmType: 'div', columnFormatterReference: '[$Ghost]' }],
    },
  }));
  await page.click('#wb-json-apply');
  await openTab(page, 'inspector');
  // the unresolved reference shows in the column section
  const missing = page.locator('#wb-tree-cols .wb-doc-missing[data-missing-ref="Ghost"]');
  await expect(missing).toBeVisible();
  // collapse the column section, then click the ⤷ chip — it should re-expand
  await page.click('#wb-tree-cols-head');
  await expect(page.locator('#wb-tree-cols')).toBeHidden();
  await page.locator('.wb-tree-row', { has: page.locator('.wb-chip-cfr') }).first()
    .locator('.wb-chip-cfr').click();
  // the section re-expands and the click lands on the missing row (no active doc switch)
  await expect(page.locator('#wb-tree-cols')).toBeVisible();
  await expect(missing).toBeVisible();
  await expect(page.locator('#wb-tree-cols .wb-doc-header.active')).toHaveCount(0);
});
