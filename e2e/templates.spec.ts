/**
 * E2E: pre-built row-view templates. The Templates button on the row-view
 * toolbar opens a config modal with a live preview; a style exclusion is felt
 * (a greyed control with a reason); Apply replaces the layout as ONE undoable
 * step; and a field can be dragged from the palette into an area (the dropdown
 * + drag-drop "both 1 and 3" answer).
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

test('Templates opens a modal with a live preview, and a card exclusion is felt', async ({ page }) => {
  await enterRowView(page);
  await page.locator('.wb-rowview-templates').click();
  await expect(page.locator('.wb-template-modal')).toBeVisible();
  await expect(page.locator('.wb-template-preview .wb-template-prow').first()).toBeVisible();
  // picking the card style greys the generic border control, with a reason
  await page.locator('[data-field="rowStyle"]').selectOption('card');
  await expect(page.locator('[data-toggle="border"]')).toHaveClass(/wb-disabled/);
  await expect(page.locator('[data-toggle="border"]')).toHaveAttribute('title', /Card style manages its own border/);
});

test('Apply replaces the row layout and Ctrl+Z reverts it in one step', async ({ page }) => {
  await enterRowView(page);
  await page.locator('.wb-rowview-templates').click();
  await page.locator('[data-field="templateId"]').selectOption('equal');
  await page.locator('.wb-template-apply').click();
  await expect(page.locator('.wb-template-modal')).toHaveCount(0);
  await expect(page.locator('.wb-mock-viewrow')).toHaveCount(3);
  // a single undo reverts the whole replacement and stays in row view
  await page.keyboard.press('Control+z');
  await expect(page.locator('.wb-rowview-bar')).toBeVisible();
});

test('a field can be dragged from the palette into an area', async ({ page }) => {
  await enterRowView(page);
  await page.locator('.wb-rowview-templates').click();
  await page.locator('.wb-template-field-chip', { hasText: 'DueDate' }).first()
    .dragTo(page.locator('[data-area="0"]'));
  await expect(page.locator('[data-area="0"] [data-field="areaField"]')).toHaveValue('DueDate');
});
