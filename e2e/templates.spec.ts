/**
 * E2E: the row view builder. The Templates button on the row-view toolbar (and
 * "+ New rowview" in the document dropdown) opens the builder on a WIREFRAME
 * GALLERY; picking a layout enters the zone editor with a live preview. A
 * style exclusion is felt (a greyed control with a reason); Apply replaces the
 * layout as ONE undoable step; fields AND components drag from the chips bar
 * into zones; the width presets squeeze the preview so wrap behavior is
 * watchable.
 */
import { test, expect, type Page } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  page.on('dialog', (d) => { void d.accept(); }); // accept the overwrite confirm
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
});

function header(page: Page, label: string) {
  return page.locator('.wb-grid-header', { has: page.locator('.wb-grid-header-label', { hasText: label }) });
}

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
