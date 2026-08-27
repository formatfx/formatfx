/**
 * E2E: the row view (and tile) builder. The Templates entry in the
 * structure-header kebab (and the single "＋ New view…" in the left pane's
 * views list) opens the builder on the LAYOUT SELECTOR — a narrow left list
 * (Row + Tile groups) beside a live right-pane preview; selecting drills the
 * left pane into details, and Next enters the zone editor. A style exclusion
 * is felt (a greyed control with a reason); Apply replaces the layout as ONE
 * undoable step; fields AND components drag from the chips bar into zones;
 * the width presets squeeze the row preview so wrap behavior is watchable,
 * while tiles preview as a live deck at their configured box.
 */
import { test, expect, type Page } from '@playwright/test';
import { freshApp, header } from './helpers';

// dialogs accepted for the overwrite confirm
test.beforeEach(async ({ page }) => { await freshApp(page, { acceptDialogs: true }); });

async function enterRowView(page: Page) {
  await header(page, 'Title').click({ modifiers: ['Control'] });
  await header(page, 'Status').click({ modifiers: ['Control'] });
  await page.locator('.wb-areas-bar button', { hasText: 'Make a row view' }).click();
  await expect(page.locator('.wb-rowview-bar')).toBeVisible();
}

/** Open the builder from the structure-header kebab (Templates moved off the
 *  canvas toolbar, 2026-07-10). */
async function clickTemplates(page: Page) {
  await page.locator('#wb-structure-kebab').click();
  await page.locator('.wb-viewkebab-templates').click();
}

async function openBuilder(page: Page, wireframe = 'lead-detail') {
  await clickTemplates(page);
  await expect(page.locator('.wb-template-modal')).toBeVisible();
  await expect(page.locator('.wb-lay-row').first()).toBeVisible(); // the selector greets first
  await page.locator(`[data-wireframe="${wireframe}"]`).click();
  await page.locator('.wb-template-next').click();
  await expect(page.locator('.wb-edit-zone').first()).toBeVisible();
}

test('the builder opens on the gallery, then a card exclusion is felt in the editor', async ({ page }) => {
  await enterRowView(page);
  await openBuilder(page);
  await expect(page.locator('.wb-template-preview .wb-template-prow').first()).toBeVisible();
  // picking the card style greys the generic border control, with a reason
  await page.locator('.wb-template-inspector [data-rowstyle="card"]').click();
  await expect(page.locator('[data-toggle="border"]')).toHaveClass(/wb-disabled/);
  await expect(page.locator('[data-toggle="border"]')).toHaveAttribute('title', /Card style manages its own border/);
});

test('Apply replaces the row layout and Ctrl+Z reverts it in one step', async ({ page }) => {
  await enterRowView(page);
  await openBuilder(page);
  await page.locator('.wb-template-apply').click();
  await expect(page.locator('.wb-template-modal')).toHaveCount(0);
  await expect(page.locator('.wb-mock-viewrow')).toHaveCount(3);
  // a single undo reverts the whole replacement and stays in row view
  await page.keyboard.press('Control+z');
  await expect(page.locator('.wb-rowview-bar')).toBeVisible();
});

test('a field chip dragged onto a zone lands as a new item', async ({ page }) => {
  await enterRowView(page);
  await openBuilder(page);
  await page.locator('.wb-template-field-chip', { hasText: 'DueDate' }).first()
    .dragTo(page.locator('[data-edit-zone="0"]'));
  await expect(page.locator('[data-edit-zone="0"] [data-field-name="DueDate"]')).toHaveCount(1);
});

test('a component chip dragged into a zone binds best-guess and maps its slots', async ({ page }) => {
  await enterRowView(page);
  await openBuilder(page);
  await page.locator('.wb-template-comp-chip', { hasText: 'Deadline chip' })
    .dragTo(page.locator('[data-edit-zone="1"]'));
  await expect(page.locator('[data-component-id="builtin-deadline-chip"]')).toHaveCount(1);
  // the drop selects the item; its slot picker is prefilled with the date column
  await expect(page.locator('select[data-slot="Due"]')).toHaveValue('DueDate');
  await expect(page.locator('.wb-template-apply')).toBeEnabled();
});

test('the width presets squeeze the preview stage (watch zones wrap)', async ({ page }) => {
  await enterRowView(page);
  await openBuilder(page, 'title-chips');
  await page.locator('[data-stagewidth="narrow"]').click();
  await expect(page.locator('.wb-template-stage')).toHaveCSS('width', '360px');
  // the squeeze is REAL: the edit row's box narrows with the stage (and rows
  // clip at the boundary instead of painting past it)
  const prow = await page.locator('.wb-template-prow--edit').boundingBox();
  expect(prow!.width).toBeLessThanOrEqual(360);
});

test('the stage edge handle drag-resizes the preview (it must be grabbable)', async ({ page }) => {
  await enterRowView(page);
  await openBuilder(page, 'title-chips');
  await page.locator('[data-stagewidth="narrow"]').click();
  await expect(page.locator('.wb-template-stage')).toHaveCSS('width', '360px');
  const handle = await page.locator('.wb-template-widthhandle').boundingBox();
  // the handle must be the hit target at its own center (it once painted
  // UNDER the stage and could not be grabbed at all)
  const hit = await page.evaluate(([x, y]) =>
    document.elementFromPoint(x, y)?.className ?? '', [handle!.x + handle!.width / 2, handle!.y + handle!.height / 2]);
  expect(hit).toContain('wb-template-widthhandle');
  await page.mouse.move(handle!.x + handle!.width / 2, handle!.y + handle!.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle!.x + handle!.width / 2 + 150, handle!.y + handle!.height / 2, { steps: 4 });
  await page.mouse.up();
  const w = await page.locator('.wb-template-stage').evaluate((n) => n.getBoundingClientRect().width);
  expect(w).toBeGreaterThan(450); // ~360 + 150, minus rounding
});

test('alignment edits: the root row is selectable and both levels write real flex alignment', async ({ page }) => {
  await enterRowView(page);
  await openBuilder(page); // lead-detail
  // the tree leads with the standing ROOT row, selected while nothing else is
  await expect(page.locator('[data-tree-root]')).toHaveClass(/wb-ztree-on/);
  await expect(page.locator('.wb-template-insp-title')).toHaveText('Row');
  // top-level: zones line up at the top instead of centered
  await page.locator('[data-rootvalign="top"]').click();
  await expect(page.locator('.wb-edit-rowroot')).toHaveCSS('align-items', 'flex-start');
  // zone level: select Lead via the tree, bottom-align its items
  await page.locator('[data-tree-zone="0"]').click();
  await expect(page.locator('[data-tree-root]')).not.toHaveClass(/wb-ztree-on/);
  await page.locator('[data-valign="bottom"]').click();
  await expect(page.locator('[data-edit-zone="0"]')).toHaveCSS('align-items', 'flex-end');
  // the canvas ▦ tag re-selects the root without hunting for empty canvas
  await page.locator('.wb-edit-root-tag').click();
  await expect(page.locator('.wb-template-insp-title')).toHaveText('Row');
  // Save, reopen: the alignment round-trips into the builder's controls
  await page.locator('.wb-template-apply').click();
  await expect(page.locator('.wb-template-modal')).toHaveCount(0);
  await clickTemplates(page);
  await expect(page.locator('.wb-edit-zone').first()).toBeVisible();
  await expect(page.locator('[data-rootvalign="top"]')).toHaveClass(/wb-seg-on/);
  await page.locator('[data-tree-zone="0"]').click();
  await expect(page.locator('[data-valign="bottom"]')).toHaveClass(/wb-seg-on/);
});

test('reopening the builder edits the applied layout in place (no gallery restart)', async ({ page }) => {
  await enterRowView(page);
  await openBuilder(page);
  await page.locator('.wb-template-apply').click();
  await expect(page.locator('.wb-template-modal')).toHaveCount(0);

  // reopen: straight into the zone editor with the applied zones — no selector
  await clickTemplates(page);
  await expect(page.locator('.wb-edit-zone').first()).toBeVisible();
  await expect(page.locator('.wb-lay-row')).toHaveCount(0);
  await expect(page.locator('.wb-edit-zone-tag').first()).toContainText('Lead');

  // tweak one zone (selected via the TREE — the deterministic surface) and re-apply
  await page.locator('[data-tree-zone="1"]').click();
  await page.locator('[data-zoneflow="stack"]').click();
  await page.locator('.wb-template-apply').click();
  await expect(page.locator('.wb-mock-viewrow')).toHaveCount(3);
  await page.keyboard.press('Control+z');
  await expect(page.locator('.wb-mock-viewrow')).toHaveCount(3); // prior layout, still a row view
});

test('positional drops: before-an-item on the canvas, into-a-zone via the tree, all undoable', async ({ page }) => {
  await enterRowView(page);
  await openBuilder(page);
  // drop DueDate at the LEFT edge of the Lead zone's Title item → it lands BEFORE it
  await page.locator('.wb-template-field-chip', { hasText: 'DueDate' }).first()
    .dragTo(page.locator('[data-edit-item="0:0"]'), { targetPosition: { x: 4, y: 8 } });
  await expect(page.locator('[data-edit-item="0:0"]')).toHaveAttribute('data-field-name', 'DueDate');
  // move it via the TREE: its item row dropped on the Details zone row's body → INTO
  // (Details already seeds its own DueDate — duplicates are legal, so expect 2)
  await page.locator('[data-tree-item="0:0"]').dragTo(page.locator('[data-tree-zone="1"]'));
  await expect(page.locator('[data-edit-zone="1"] [data-field-name="DueDate"]')).toHaveCount(2);
  // two Ctrl+Z unwind both gestures inside the builder (the document is untouched)
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+z');
  await expect(page.locator('[data-edit-item="0:0"]')).toHaveAttribute('data-field-name', 'Title');
  await expect(page.locator('[data-edit-zone="1"] [data-field-name="DueDate"]')).toHaveCount(1);
});

test('a chip dropped on a tree zone row EDGE spawns a new zone there', async ({ page }) => {
  await enterRowView(page);
  await openBuilder(page);
  await expect(page.locator('.wb-edit-zone')).toHaveCount(2);
  // top edge of the first zone row = BEFORE → a new zone appears at position 0
  await page.locator('.wb-template-field-chip', { hasText: 'DueDate' }).first()
    .dragTo(page.locator('[data-tree-zone="0"]'), { targetPosition: { x: 30, y: 2 } });
  await expect(page.locator('.wb-edit-zone')).toHaveCount(3);
  await expect(page.locator('[data-edit-zone="0"] [data-field-name="DueDate"]')).toHaveCount(1);
});

test('zones nest: drop a zone onto a zone, and the nest survives Apply → reopen', async ({ page }) => {
  await enterRowView(page);
  await openBuilder(page);
  // nest Details into Lead: its tree row dropped on the Lead tree row's BODY
  await page.locator('[data-tree-zone="1"]').dragTo(page.locator('[data-tree-zone="0"]'));
  await expect(page.locator('[data-edit-zone="0:1"]')).toBeVisible();   // nested box on the canvas
  await expect(page.locator('[data-tree-zone="0:1"]')).toBeVisible();   // indented row in the tree
  // apply, reopen — the recursive round trip brings the nest back
  await page.locator('.wb-template-apply').click();
  await expect(page.locator('.wb-template-modal')).toHaveCount(0);
  await clickTemplates(page);
  await expect(page.locator('[data-tree-zone="0:1"]')).toBeVisible();
  await expect(page.locator('[data-edit-item="0:1:0"]')).toBeVisible(); // its item came along
});

test('the selector: select → live preview + details, Back keeps the place, Next resumes', async ({ page }) => {
  await page.locator('.wb-viewslist-newview').click();
  await expect(page.locator('.wb-template-modal')).toBeVisible();
  // nothing selected: a quiet prompt on the right, Next waiting
  await expect(page.locator('.wb-lay-placeholder')).toBeVisible();
  await expect(page.locator('.wb-template-next')).toBeDisabled();
  // selecting live-previews with the sample data and drills into details
  await page.locator('[data-wireframe="lead-detail"]').click();
  await expect(page.locator('.wb-template-preview .wb-template-prow').first()).toBeVisible();
  await expect(page.locator('.wb-lay-detail-name')).toHaveText('Lead + details');
  // Back to the list: the selection stays highlighted, the preview stays up
  await page.locator('.wb-lay-back').click();
  await expect(page.locator('[data-wireframe="lead-detail"]')).toHaveClass(/wb-lay-on/);
  await expect(page.locator('.wb-template-preview .wb-template-prow').first()).toBeVisible();
  // Next enters the editor; the editor's back arrow returns drilled-in
  await page.locator('.wb-template-next').click();
  await expect(page.locator('.wb-edit-zone').first()).toBeVisible();
  await page.locator('.wb-template-layouts').click();
  await expect(page.locator('.wb-lay-detail-name')).toHaveText('Lead + details');
  // …and Next resumes the same seeded config without a restart
  await page.locator('.wb-template-next').click();
  await expect(page.locator('.wb-edit-zone').first()).toBeVisible();
});

test('New view is reachable from the views list on the landing screen', async ({ page }) => {
  // straight from the grid landing (freshApp already navigated) — the views
  // list's ＋ is the on-ramp; a second goto would race the beforeEach reload
  await page.locator('.wb-viewslist-newview').click();
  await expect(page.locator('.wb-template-modal')).toBeVisible();
  // pick a layout, go Next, create — the workspace gains a named row view
  await page.locator('[data-wireframe="avatar-card"]').click();
  await page.locator('.wb-template-next').click();
  await expect(page.locator('.wb-template-apply')).toHaveText('Create');
  await page.locator('.wb-template-apply').click();
  await expect(page.locator('.wb-mock-viewrow')).toHaveCount(3);
});

test('the builder makes a TILE view: selector → tile editor → Create → the tile deck, then reopen', async ({ page }) => {
  await page.locator('.wb-viewslist-newview').click();
  await expect(page.locator('.wb-template-modal')).toBeVisible();
  // both groups share the one selector — the tile group sits below the rows
  await expect(page.locator('[data-laygroup="tile"]')).toHaveText('Tile layouts');
  await page.locator('[data-wireframe="tile-headline"]').click();
  await expect(page.locator('.wb-lay-preview-kind')).toHaveText('Tile layout');
  await page.locator('.wb-template-next').click();
  // the tile editor: Tile inspector, size knobs, a live tile deck, no width scrubber
  await expect(page.locator('.wb-template-insp-title')).toHaveText('Tile');
  await expect(page.locator('.wb-template-tiledeck')).toBeVisible();
  await expect(page.locator('[data-stagewidth="narrow"]')).toHaveCount(0);
  await page.locator('.wb-template-apply').click();
  await expect(page.locator('.wb-template-modal')).toHaveCount(0);
  // the canvas is now the gallery deck with the tile toolbar
  await expect(page.locator('.wb-mock-deck')).toBeVisible();
  await expect(page.locator('.wb-rowview-bar-label')).toHaveText('Tile layout');
  // reopen: straight into the TILE editor with the zones intact — no selector
  await clickTemplates(page);
  await expect(page.locator('.wb-edit-zone').first()).toBeVisible();
  await expect(page.locator('.wb-lay-row')).toHaveCount(0);
  await expect(page.locator('.wb-template-insp-title')).toHaveText('Tile');
  // one undo on the canvas reverts the whole apply
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+z');
  await expect(page.locator('.wb-grid-header').first()).toBeVisible();
});
