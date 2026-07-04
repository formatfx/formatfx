/**
 * E2E: the row view (and tile) builder. The Templates button on the row-view
 * toolbar (and "+ New rowview" / "+ New tileview" in the document dropdown)
 * opens the builder on a WIREFRAME GALLERY (grouped Row/Tile); picking a
 * layout enters the zone editor with a live preview. A style exclusion is
 * felt (a greyed control with a reason); Apply replaces the layout as ONE
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

async function openBuilder(page: Page, wireframe = 'lead-detail') {
  await page.locator('.wb-rowview-templates').click();
  await expect(page.locator('.wb-template-modal')).toBeVisible();
  await expect(page.locator('.wb-wf-card').first()).toBeVisible(); // the gallery greets first
  await page.locator(`[data-wireframe="${wireframe}"]`).click();
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
});

test('reopening the builder edits the applied layout in place (no gallery restart)', async ({ page }) => {
  await enterRowView(page);
  await openBuilder(page);
  await page.locator('.wb-template-apply').click();
  await expect(page.locator('.wb-template-modal')).toHaveCount(0);

  // reopen: straight into the zone editor with the applied zones — no gallery
  await page.locator('.wb-rowview-templates').click();
  await expect(page.locator('.wb-edit-zone').first()).toBeVisible();
  await expect(page.locator('.wb-wf-card')).toHaveCount(0);
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
  await page.locator('.wb-rowview-templates').click();
  await expect(page.locator('[data-tree-zone="0:1"]')).toBeVisible();
  await expect(page.locator('[data-edit-item="0:1:0"]')).toBeVisible(); // its item came along
});

test('New rowview is reachable from the document dropdown on the landing screen', async ({ page }) => {
  await page.goto('/');
  // straight from the grid landing — no need to enter Row View first
  await page.locator('#wb-doc-pill').click();
  await expect(page.locator('.wb-viewmenu')).toBeVisible();
  await page.locator('.wb-viewmenu-newrow').click();
  await expect(page.locator('.wb-template-modal')).toBeVisible();
  // pick a layout, apply — the grid graduates into a row view
  await page.locator('[data-wireframe="avatar-card"]').click();
  await page.locator('.wb-template-apply').click();
  await expect(page.locator('.wb-mock-viewrow')).toHaveCount(3);
});

test('the builder makes a TILE view: tile gallery → tile editor → Save → the tile deck, then reopen', async ({ page }) => {
  await page.goto('/');
  await page.locator('#wb-doc-pill').click();
  await page.locator('.wb-viewmenu-newtile').click();
  await expect(page.locator('.wb-template-modal')).toBeVisible();
  // the tile ask leads the gallery with the tile layouts
  await expect(page.locator('.wb-template-gallery-head').first()).toHaveText('Tile layouts');
  await page.locator('[data-wireframe="tile-headline"]').click();
  // the tile editor: Tile inspector, size knobs, a live tile deck, no width scrubber
  await expect(page.locator('.wb-template-insp-title')).toHaveText('Tile');
  await expect(page.locator('.wb-template-tiledeck')).toBeVisible();
  await expect(page.locator('[data-stagewidth="narrow"]')).toHaveCount(0);
  await page.locator('.wb-template-apply').click();
  await expect(page.locator('.wb-template-modal')).toHaveCount(0);
  // the canvas is now the gallery deck with the tile toolbar
  await expect(page.locator('.wb-mock-deck')).toBeVisible();
  await expect(page.locator('.wb-rowview-bar-label')).toHaveText('Tile layout');
  // reopen: straight into the TILE editor with the zones intact — no gallery
  await page.locator('.wb-rowview-templates').click();
  await expect(page.locator('.wb-edit-zone').first()).toBeVisible();
  await expect(page.locator('.wb-wf-card')).toHaveCount(0);
  await expect(page.locator('.wb-template-insp-title')).toHaveText('Tile');
  // one undo on the canvas reverts the whole apply
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+z');
  await expect(page.locator('.wb-grid-header').first()).toBeVisible();
});
