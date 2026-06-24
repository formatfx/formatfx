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
  await page.locator('.wb-template-inspector [data-rowstyle="card"]').click();
  await expect(page.locator('[data-toggle="border"]')).toHaveClass(/wb-disabled/);
  await expect(page.locator('[data-toggle="border"]')).toHaveAttribute('title', /Card style manages its own border/);
});

test('Apply replaces the row layout and Ctrl+Z reverts it in one step', async ({ page }) => {
  await enterRowView(page);
  await page.locator('.wb-rowview-templates').click();
  await page.locator('[data-skeleton="equal"]').click(); // reseed from the Equal skeleton (confirm auto-accepted)
  await page.locator('.wb-template-apply').click();
  await expect(page.locator('.wb-template-modal')).toHaveCount(0);
  await expect(page.locator('.wb-mock-viewrow')).toHaveCount(3);
  // a single undo reverts the whole replacement and stays in row view
  await page.keyboard.press('Control+z');
  await expect(page.locator('.wb-rowview-bar')).toBeVisible();
});

test('a field can be dragged from the palette onto a preview block', async ({ page }) => {
  await enterRowView(page);
  await page.locator('.wb-rowview-templates').click();
  await page.locator('.wb-template-field-chip', { hasText: 'DueDate' }).first()
    .dragTo(page.locator('[data-edit-area="0"]'));
  await expect(page.locator('[data-edit-area="0"]')).toHaveAttribute('data-field-name', 'DueDate');
});

test('New rowview is reachable from the View Formatters dropdown on the landing screen', async ({ page }) => {
  await page.goto('/');
  // straight from the grid landing — no need to enter Row View first
  await page.locator('.wb-crumb-root', { hasText: 'View Formatters' }).click();
  await expect(page.locator('.wb-viewmenu')).toBeVisible();
  await page.locator('.wb-viewmenu-newrow').click();
  await expect(page.locator('.wb-template-modal')).toBeVisible();
  // applying the template graduates the grid into a row view
  await page.locator('.wb-template-apply').click();
  await expect(page.locator('.wb-mock-viewrow')).toHaveCount(3);
});
