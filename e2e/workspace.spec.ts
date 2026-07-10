/**
 * E2E: the workspace loop — columns are data (the shelf), components are the
 * formatting (instance card, workshop re-bakes), views are the layouts. Plus
 * the standing editor surfaces: element naming, the style doc cards, the
 * playground, box-model/alignment editors, the dark-mode engine probe and the
 * Select/Live canvas toggle.
 */
import { test, expect, type Page } from '@playwright/test';
import { freshApp, header, openGridTab, openJson, openJsonKebab, openPalette, stageWorkshopColor } from './helpers';

test.beforeEach(async ({ page }) => { await freshApp(page, { acceptDialogs: true }); });

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
  await page.click('#wb-json-apply'); // on the floor: the grid now holds the fixture tree
  // graduate it into a row-view SHEET so the row surface renders it (the kind
  // select lives in the pane's head kebab)
  await openJsonKebab(page);
  await page.selectOption('#wb-pane-side #wb-kind', 'row');
}

test('the columns shelf: a chip click inserts the column into the open surface — dressed ones arrive dressed', async ({ page }) => {
  // Owner is dressed-but-unplaced (Persona look) — one click adds it
  await page.locator('.wb-colchip', { has: page.locator('.wb-colchip-name', { hasText: 'Owner' }) }).click();
  await expect(page.locator('#wb-toast')).toContainText('Added the Owner column to the grid');
  await expect(page.locator('.wb-grid-header-label')).toContainText(['Owner']);
  await expect(header(page, 'Owner').locator('.wb-grid-look')).toHaveCount(1);
  await expect(page.locator('.wb-grid-row').first().locator('img').first()).toBeVisible();
  // chips are data-only: type-tagged, no formatter state painted on them
  await expect(page.locator('.wb-colchip', { has: page.locator('.wb-colchip-name', { hasText: 'Owner' }) })
    .locator('.wb-colchip-type')).toHaveText('person');
  // one Ctrl+Z removes the added column
  await page.keyboard.press('Control+z');
  await expect(page.locator('.wb-grid-header-label')).not.toContainText(['Owner']);
});

test('a chip click refuses while a workshop covers the canvas — the staged def is not a surface', async ({ page }) => {
  const node = page.locator('.wb-comp-node')
    .filter({ has: page.locator('.wb-comp-rowname', { hasText: 'Deadline chip' }) }).first();
  await node.locator('.wb-comp-row').hover();
  await node.locator('.wb-comp-rowedit').click();
  await expect(page.locator('#wb-workshop .wb-ce')).toBeVisible();
  await page.locator('.wb-colchip', { has: page.locator('.wb-colchip-name', { hasText: 'Owner' }) }).click();
  await expect(page.locator('#wb-toast')).toContainText('A component workshop is open');
  // nothing landed: back on the grid, the column count is unchanged
  await openGridTab(page);
  await expect(page.locator('.wb-grid-header-label')).toHaveCount(6);
});

test('field-chip drags: the tree and the canvas both take FIELD drops (§5 drag grammar)', async ({ page }) => {
  const chip = page.locator('.wb-colchip', { has: page.locator('.wb-colchip-name', { hasText: 'Tags' }) });
  // onto a tree row → the look-aware cell lands at that target
  await chip.dragTo(page.locator('#wb-tree-body .wb-tree-row').first());
  await expect(page.locator('.wb-grid-header-label')).toContainText(['Tags']);
  await page.keyboard.press('Control+z');
  await expect(page.locator('.wb-grid-header-label')).not.toContainText(['Tags']);
  // onto rendered canvas content → inserted at the drop target, selected
  await chip.dragTo(page.locator('.wb-grid-cell[data-col="0"]').first());
  await expect(page.locator('#wb-toast')).toContainText('Added the Tags column');
  await page.keyboard.press('Control+z');
});

test('the instance card re-binds a slot: store and placed cell rewrite together, one undo step', async ({ page }) => {
  // select the Status column's bound instance in the tree
  await page.locator('#wb-tree-body .wb-tree-row',
    { has: page.locator('.wb-tree-name', { hasText: 'Status pill' }) }).locator('.wb-tree-label').click();
  const card = page.locator('.wb-inst-card');
  await expect(card.locator('.wb-inst-head')).toContainText('Status pill');
  // "Bound to <column ▾>": type-filtered like the mapper (choice/text fit)
  const sel = card.locator('.wb-inst-slot-select').first();
  await expect(sel).toHaveValue('Status');
  await sel.selectOption('Tags');
  await expect(page.locator('#wb-toast')).toContainText('bound to Tags');
  // the grid column re-renders the new binding immediately
  await expect(page.locator('.wb-grid-row').first().locator('.wb-grid-cell[data-col="1"]'))
    .toContainText('web;intranet;sprint-12');
  // ONE Ctrl+Z restores binding + cell together (they can never disagree)
  await page.keyboard.press('Control+z');
  await expect(page.locator('.wb-grid-row').first().locator('.wb-grid-cell[data-col="1"]'))
    .toContainText('In Progress');
});

test('the instance card detaches to plain elements — provenance gone, one undo restores it', async ({ page }) => {
  await page.locator('#wb-tree-body .wb-tree-row',
    { has: page.locator('.wb-tree-name', { hasText: 'Status pill' }) }).locator('.wb-tree-label').click();
  await page.locator('.wb-inst-card .wb-inst-detach').click();
  await expect(page.locator('#wb-toast')).toContainText('Detached from “Status pill”');
  // the tree row loses its binding language (Status pill + Data bar shipped
  // bound — one of the two bindtags is gone)
  await expect(page.locator('#wb-tree-body .wb-tree-bindtag')).toHaveCount(1);
  // …and the selection now shows NO instance card (plain elements)
  await expect(page.locator('.wb-inst-card')).toHaveCount(0);
  await page.keyboard.press('Control+z');
  await expect(page.locator('#wb-tree-body .wb-tree-bindtag')).toHaveCount(2);
});

test('workshop save re-bakes a worn column: edit YOUR component, every column wearing it updates, one undo', async ({ page }) => {
  // package Status's look as YOUR component and dress Status in it
  await header(page, 'Status').click();
  await page.locator('.wb-grid-menu button', { hasText: 'Save as component…' }).click();
  await page.locator('.wb-compmap .wb-compmap-name').fill('My pill');
  await page.locator('.wb-compmap .wb-compmap-insert').click();
  await header(page, 'Status').click();
  await page.locator('.wb-grid-menu button', { hasText: 'Remove the look' }).click();
  await header(page, 'Status').click();
  await page.locator('.wb-grid-menu button', { hasText: 'Apply a component…' }).click();
  await page.locator('.wb-grid-menu button', { hasText: 'My pill' }).click();
  await expect(header(page, 'Status').locator('.wb-grid-look')).toHaveAttribute('title', /My pill/);

  // open its workshop from the library and stage a purple restyle
  const node = page.locator('.wb-comp-node')
    .filter({ has: page.locator('.wb-comp-rowname', { hasText: 'My pill' }) }).first();
  await node.locator('.wb-comp-row').hover();
  await node.locator('.wb-comp-rowedit').click();
  const ce = page.locator('#wb-workshop .wb-ce');
  const purple = '[style*="rgb(92, 45, 145)"]';
  await stageWorkshopColor(page, '#5c2d91');
  // staged ≠ saved: the grid (under the workshop cover) has no purple yet
  await expect(page.locator(`#wb-canvas ${purple}`)).toHaveCount(0);
  // the save counts every usage: the worn column + its placed grid cell
  const save = ce.locator('.wb-ce-save');
  await expect(save).toHaveText(/Save and apply to \d+ place/);
  await save.click();
  await expect(page.locator('#wb-toast')).toContainText(/one Ctrl\+Z reverts/);
  // the worn column re-baked: the grid renders purple once per mock row
  await openGridTab(page);
  await expect(page.locator(`#wb-canvas ${purple}`)).toHaveCount(3);
  // ONE Ctrl+Z reverts the whole apply (store + placed cells together)
  await page.keyboard.press('Control+z');
  await expect(page.locator(`#wb-canvas ${purple}`)).toHaveCount(0);
});

test('the JSON pane Copy puts the compiled view JSON on the clipboard — looks embedded, no references', async ({ page, context }) => {
  // #257: the topbar JSON button opens the pane; copying lives on the pane
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await openJsonKebab(page);
  await page.click('#wb-json-copy');
  await expect(page.locator('#wb-toast')).toContainText('JSON copied');
  const text = await page.evaluate(() => navigator.clipboard.readText());
  const parsed = JSON.parse(text);
  expect(parsed.rowFormatter.elmType).toBe('div');
  // the looks ship EMBEDDED (clones of bound instances), never as references
  expect(text).not.toContain('columnFormatterReference');
  expect(text).toContain('_component');
});

test('element naming: showcase and presets arrive named, double-click renames, shipped JSON stays clean', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  // the showcase tree reads as names, not anonymous divs — except the grid
  // floor's root, whose pre-stamped promotion name must stay hidden (#198)
  await expect(page.locator('#wb-tree-body .wb-tree-name', { hasText: 'Row layout' })).toHaveCount(0);
  await expect(page.locator('#wb-tree-body .wb-tree-name', { hasText: 'DueDate' })).toBeVisible();
  await expect(page.locator('#wb-tree-body .wb-tree-name', { hasText: 'Status pill' })).toBeVisible();
  // double-click renames inline
  await page.locator('.wb-tree-row .wb-tree-label').first().dblclick();
  await page.locator('.wb-tree-rename').fill('My title');
  await page.locator('.wb-tree-rename').press('Enter');
  await expect(page.locator('.wb-tree-name', { hasText: 'My title' })).toBeVisible();
  // the JSON pane keeps names so Apply round-trips losslessly…
  await openJson(page);
  expect(await page.inputValue('#wb-json-text')).toContain('"_elmName": "My title"');
  // …copies keep them by default (SP ignores them); clean is opt-in — Copy and
  // the names option both live in the pane's head kebab (a copy click closes
  // the dropdown; toggling an option keeps it open)
  await openJsonKebab(page);
  await page.click('#wb-json-copy');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('"_elmName": "My title"');
  await openJsonKebab(page);
  await page.uncheck('#wb-json-names');
  await page.click('#wb-json-copy');
  expect(await page.evaluate(() => navigator.clipboard.readText())).not.toContain('_elmName');
});

test('style editor explains properties: ⓘ opens a doc card with clickable examples', async ({ page }) => {
  await page.locator('.wb-tree-row .wb-tree-label').first().click();
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
  await page.locator('.wb-lp-nav').click({ position: { x: 4, y: 4 } });
  await expect(card).toBeHidden();
});

test('doc card groups longhands: padding-left gets the padding card, variants switch the row', async ({ page }) => {
  await page.locator('.wb-tree-row .wb-tree-label').first().click();
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
  await page.locator('.wb-tree-row', { has: page.locator('.wb-tree-name', { hasText: 'DueDate' }) }).locator('.wb-tree-label').click();
  // entry via ☰ menu (behind More…, #257) — consequence-free overlay
  await page.click('#wb-menu-btn');
  await page.click('#wb-menu-more');
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
  await page.locator('.wb-tree-row .wb-tree-label').first().click();
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

test('wrap-in-parent works on the root (of a view sheet — the grid tree has no root row)', async ({ page }) => {
  await loadRowFixture(page);
  const rootRow = page.locator('.wb-tree-row').first();
  await rootRow.hover();
  await rootRow.locator('button[title*="Wrap"]').click();
  await openJson(page);
  const json = JSON.parse(await page.inputValue('#wb-json-text'));
  // the new wrapper is the root; the old root (the named fixture) is its child
  expect(json.rowFormatter.style.display).toBe('flex');
  expect(json.rowFormatter.children).toHaveLength(1);
  expect(json.rowFormatter.children[0]._elmName).toBe('Fixture row');
});

test('box-model editor writes per-side padding to the selected element', async ({ page }) => {
  await loadRowFixture(page);
  // select the view root in the tree structure, then drop to the Simple lens
  await page.locator('.wb-tree-row .wb-tree-label').first().click();
  await page.locator('.wb-lens-tab[data-lens="simple"]').click();
  const padTop = page.locator('.wb-box.wb-box-padding input.wb-box-top').first();
  await padTop.fill('33');
  await padTop.blur();
  await expect(page.locator('.wb-mock-viewrow [data-sp-path]').first()).toHaveCSS('padding-top', '33px');
});

test('alignment editor: summary chip opens picker, position grid writes layout styles', async ({ page }) => {
  await loadRowFixture(page);
  const target = page.locator('.wb-mock-viewrow [data-sp-path]').first();
  await page.locator('.wb-tree-row .wb-tree-label').first().click();
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
  await page.locator('.wb-tree-row .wb-tree-label').first().click();
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
  // a bare column payload becomes the current field's LOOK — the probe
  // renders embedded in that grid column
  const probe = page.locator('.wb-grid').getByText('probe').first();
  await expect(probe).toHaveCSS('background-color', 'rgb(49, 49, 49)'); // dark default #313131
  await page.click('#wb-menu-btn');
  await page.click('#wb-theme');
  await expect(page.locator('body')).not.toHaveClass(/wb-dark/);
  await expect(probe).toHaveCSS('background-color', 'rgb(243, 242, 241)'); // light #f3f2f1
  // the harness reloads between captures — autosave must restore the choice
  // too. A reload lands on the FLOOR, where the look renders embedded.
  await page.reload();
  await expect(page.locator('body')).not.toHaveClass(/wb-dark/);
  await expect(page.locator('.wb-grid').getByText('probe').first())
    .toHaveCSS('background-color', 'rgb(243, 242, 241)');
});

test('customCardProps flyout renders a beak (isBeakVisible)', async ({ page }) => {
  // inserts at the grid root — arrives as a new grid column
  await openPalette(page);
  await page.locator('.wb-palette-pop .wb-palette-item', { hasText: 'Hover card' }).click();
  await page.locator('.wb-grid .wb-has-card').first().click();
  await expect(page.locator('.wb-flyout-beak')).toBeVisible();
});

test('the left pane frames the active surface: tree + shelf + library + views list, no retired chrome', async ({ page }) => {
  // the structure tree renders the active tab's document
  await expect(page.locator('#wb-tree-body .wb-tree-row').first()).toBeVisible();
  // the shelf and the library are standing (collapsible) sections; the views list closes the pane
  await expect(page.locator('.wb-lp-sec[data-sec="columns"] .wb-lp-sec-title')).toHaveText('Columns');
  await expect(page.locator('#wb-lp-shelf .wb-colchip').first()).toBeVisible();
  await expect(page.locator('#wb-lp-library')).toBeVisible();
  await expect(page.locator('.wb-lp-sec-head[data-sec-head="views"] .wb-lp-sec-title')).toHaveText('Views');
  // the formatter tablist and the document pill died with the drill-in model
  await expect(page.locator('.wb-fmt-tab')).toHaveCount(0);
  await expect(page.locator('#wb-doc-pill')).toHaveCount(0);
  // the This-view card hides on the grid (no view-scoped behavior to show)
  await expect(page.locator('#wb-lp-viewcard')).toBeHidden();
});

test('the pane sections fold away and back (Columns · Components · Inspector), per-section', async ({ page }) => {
  const shelf = page.locator('#wb-lp-shelf');
  const library = page.locator('#wb-lp-library');
  const inspector = page.locator('#wb-lp-inspector');
  const headFor = (id: string) => page.locator(`.wb-lp-sec-head[data-sec-head="${id}"]`);

  // everything starts expanded — the section bodies are visible
  await expect(shelf).toBeVisible();
  await expect(library).toBeVisible();
  await expect(inspector).toBeVisible();
  await expect(headFor('components')).toHaveAttribute('aria-expanded', 'true');

  // fold Components: its body truly hides (real CSS), the neighbours stay put
  await headFor('components').click();
  await expect(library).toBeHidden();
  await expect(headFor('components')).toHaveAttribute('aria-expanded', 'false');
  await expect(shelf).toBeVisible();
  await expect(inspector).toBeVisible();

  // folds are independent — collapse Columns too, then bring Components back
  await headFor('columns').click();
  await expect(shelf).toBeHidden();
  await expect(library).toBeHidden(); // Components still folded
  await headFor('components').click();
  await expect(library).toBeVisible();
  await expect(shelf).toBeHidden(); // Columns still folded
});

test('the structure-header ⋮ kebab holds density, row class, hide toggles and command buttons', async ({ page }) => {
  // a view via the kind select in the pane's head kebab (carries the grid's columns)
  await openJsonKebab(page);
  await page.selectOption('#wb-pane-side #wb-kind', 'row');
  await expect(page.locator('.wb-mock-viewrow')).toHaveCount(3);
  const cardHost = page.locator('#wb-lp-viewcard');
  await expect(cardHost).toBeVisible();
  await expect(cardHost.locator('.wb-viewcard-name')).toHaveText('View 1');
  await expect(cardHost.locator('.wb-viewcard-kind')).toHaveText('row view');
  // the card carries no inline settings and no kebab anymore — the ⋮ moved
  // onto the Structure section header (2026-07-10)
  await expect(cardHost.locator('.wb-viewcard-seg')).toHaveCount(0);
  await expect(cardHost.locator('.wb-viewcard-rowclass')).toHaveCount(0);
  await expect(cardHost.locator('.wb-viewcard-kebab')).toHaveCount(0);
  await page.locator('#wb-structure-kebab').click();
  const kebab = page.locator('.wb-viewkebab');
  await expect(kebab).toBeVisible();

  // density is a one-step view knob — and the body-owned panel survives its own gesture
  await kebab.locator('[data-prop="density"] .wb-viewcard-segbtn', { hasText: 'Compact' }).click();
  await expect(page.locator('.wb-mock-viewrow > [data-sp-path=""]').first()).toHaveCSS('gap', '8px');
  await expect(kebab).toBeVisible();
  await page.keyboard.press('Control+z');

  // the row class commits on Enter as ONE mutation, lands in viewExtras
  await kebab.locator('.wb-viewcard-rowclass').fill('sp-row-card');
  await kebab.locator('.wb-viewcard-rowclass').press('Enter');
  await expect(page.locator('#wb-toast')).toContainText('sp-row-card');
  expect(await page.inputValue('#wb-json-text')).toContain('"additionalRowClass": "sp-row-card"');
  await page.keyboard.press('Control+z');

  // a hide toggle writes the wrapper prop (Show later deletes it — clean export)
  await kebab.locator('[data-prop="hideSelection"] .wb-viewcard-segbtn', { hasText: 'Hide' }).click();
  expect(await page.inputValue('#wb-json-text')).toContain('"hideSelection": true');

  // the Command buttons drill-in: a preset is ONE undoable step and emits the
  // alias-complete commandBarProps (the pnp hide-all pattern)
  await kebab.locator('.wb-viewkebab-commands').click();
  await expect(kebab.locator('.wb-viewkebab-group')).toHaveCount(5);
  await kebab.locator('.wb-viewkebab-preset[data-preset="entryOnly"]').click();
  const json = await page.inputValue('#wb-json-text');
  expect(json).toContain('"commandBarProps"');
  expect(json).toContain('"key": "editInGridView"');
  expect(json).not.toContain('"key": "new"'); // Collect entries keeps + New visible
  await page.keyboard.press('Control+z');
  expect(await page.inputValue('#wb-json-text')).not.toContain('commandBarProps');

  // Escape closes the panel
  await page.keyboard.press('Escape');
  await expect(page.locator('.wb-viewkebab')).toHaveCount(0);

  // a behavior lands in the scan: insert an Action button, its row appears
  await openPalette(page);
  await page.locator('.wb-palette-pop .wb-palette-item', { hasText: 'Action button' }).click();
  const behavior = cardHost.locator('.wb-viewcard-behavior');
  await expect(behavior).toContainText('editProps');
  // clicking it jumps to (selects) the carrying element
  await behavior.click();
  await expect(page.locator('#wb-canvas .wb-selected').first()).toBeVisible();
});

test('left pane chrome: frozen section headers, a collapsible Views section, the props splitter', async ({ page }) => {
  // the tree region now leads with its own "Structure" header
  await expect(page.locator('.wb-lp-sec-head[data-sec-head="tree"] .wb-lp-sec-title')).toHaveText('Structure');
  // Views folds like its siblings (2026-07-09 owner brief)
  const viewsHead = page.locator('.wb-lp-sec-head[data-sec-head="views"]');
  await expect(viewsHead.locator('.wb-lp-sec-title')).toHaveText('Views');
  await viewsHead.click();
  await expect(page.locator('.wb-lp-sec[data-sec="views"]')).toHaveClass(/wb-collapsed/);
  await expect(page.locator('#wb-lp-views')).toBeHidden();
  await viewsHead.click();
  await expect(page.locator('#wb-lp-views')).toBeVisible();
  // section headers freeze while their region scrolls
  await expect(page.locator('.wb-lp-sec[data-sec="columns"] > .wb-lp-sec-head')).toHaveCSS('position', 'sticky');
  await expect(page.locator('.wb-lp-sec[data-sec="inspector"] > .wb-lp-sec-head')).toHaveCSS('position', 'sticky');
  // the shelves/props boundary drags (props grows) and double-click resets
  const splitter2 = page.locator('#wb-lp-splitter2');
  await expect(splitter2).toBeVisible();
  const props = page.locator('#wb-lp-props');
  const before = (await props.boundingBox())!.height;
  const box = (await splitter2.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y - 80, { steps: 4 });
  await page.mouse.up();
  const after = (await props.boundingBox())!.height;
  expect(after).toBeGreaterThan(before + 40);
  await splitter2.dblclick();
  const reset = (await props.boundingBox())!.height;
  expect(Math.abs(reset - before)).toBeLessThan(12);
});

test('Select/Live canvas toggle: Live fires customRowAction, Select selects instead', async ({ page }) => {
  // insert an Action button (customRowAction: editProps) — a new grid column
  await openPalette(page);
  await page.locator('.wb-palette-pop .wb-palette-item', { hasText: 'Action button' }).click();
  const btn = page.locator('.wb-grid .wb-grid-cell div[role="button"]').first();
  await expect(btn).toBeVisible();

  // Select (the default — click-safety): clicking selects, nothing fires
  await expect(page.locator('.wb-canvas-mode.active')).toHaveText('Select');
  await btn.click();
  await expect(page.locator('.wb-grid .wb-selected').first()).toBeVisible();

  // flip Live: the same click routes through the real behavior
  await page.locator('.wb-canvas-mode', { hasText: 'Live' }).click();
  await expect(page.locator('#wb-toast')).toContainText('Live canvas');
  await page.locator('.wb-grid .wb-grid-cell div[role="button"]').first().click();
  await expect(page.locator('#wb-toast')).toContainText('customRowAction: editProps');

  // and back: Select is one click away, never a reload
  await page.locator('.wb-canvas-mode', { hasText: 'Select' }).click();
  await expect(page.locator('.wb-canvas-mode.active')).toHaveText('Select');
});


