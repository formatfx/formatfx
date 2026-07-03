/**
 * E2E: snapshots (issue #140) + navigation back.
 *
 * The 🕘 button beside the document dropdown opens the snapshot menu: the
 * primary action snapshots the SELECTED formatter (placement decides the
 * primary — owner decision), "Snapshot everything" is the alternative right
 * beside it, and every restore is one undoable step. Snapshots persist in
 * localStorage (additive key) across reloads. The ← button retraces doc
 * switches — navigation history, not undo.
 */
import { test, expect, type Page } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  page.on('dialog', (d) => { void d.accept(); });
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
});

function header(page: Page, label: string) {
  return page.locator('.wb-grid-header', { has: page.locator('.wb-grid-header-label', { hasText: label }) });
}

async function openJson(page: Page): Promise<void> {
  if (!(await page.locator('#wb-pane-side').isVisible())) await page.click('#wb-json-toggle');
}

test('snapshot the view, mutate it, restore it — and Ctrl+Z brings the mutation back', async ({ page }) => {
  // take a view snapshot (the primary action names the view)
  await page.click('#wb-snap-btn');
  const menu = page.locator('.wb-snapmenu');
  await expect(menu.locator('.wb-snap-take').first()).toContainText('Snapshot the View 1 view');
  await menu.locator('.wb-snap-take').first().click();
  await expect(menu.locator('.wb-snap-row')).toHaveCount(1);
  await page.keyboard.press('Escape');

  // mutate the view: hide the Status column via its header menu
  await header(page, 'Status').click();
  await page.locator('.wb-grid-menu button', { hasText: 'Hide column' }).click();
  await expect(header(page, 'Status')).toHaveCount(0);

  // restore — Status is back
  await page.click('#wb-snap-btn');
  await page.locator('.wb-snapmenu .wb-snap-restore').first().click();
  await expect(page.locator('.wb-snapmenu')).toHaveCount(0); // restore closes the menu
  await expect(header(page, 'Status')).toHaveCount(1);
  await expect(page.locator('#wb-toast')).toContainText('Ctrl+Z');

  // the restore itself is one undoable step
  await page.keyboard.press('Control+z');
  await expect(header(page, 'Status')).toHaveCount(0);
});

test('drilled into a column, the primary snapshots THAT column and restores it', async ({ page }) => {
  // drill into the Status column formatter
  await page.locator('.wb-grid-cell.wb-cell-linked').first().dblclick();
  await expect(page.locator('.wb-doc-pill-name')).toHaveText('Status');

  // the menu's primary action now names the column
  await page.click('#wb-snap-btn');
  const menu = page.locator('.wb-snapmenu');
  await expect(menu.locator('.wb-snap-take').first()).toContainText('Snapshot the Status column formatter');
  await expect(menu.locator('.wb-snapmenu-group').first()).toContainText('Status column');
  await menu.locator('.wb-snap-take').first().click();
  await page.keyboard.press('Escape');

  // restyle the pill via the JSON pane
  await openJson(page);
  await page.fill('#wb-json-text', JSON.stringify({ elmType: 'div', txtContent: "='X-'+[$Status]" }));
  await page.click('#wb-json-apply');
  await expect(page.locator('.wb-mock-row:not(.wb-mock-header) .wb-mock-cell-fmt').first()).toContainText('X-In Progress');

  // restore the snapshot — the original pill text is back
  await page.click('#wb-snap-btn');
  await page.locator('.wb-snapmenu .wb-snap-restore').first().click();
  await expect(page.locator('.wb-mock-row:not(.wb-mock-header) .wb-mock-cell-fmt').first())
    .not.toContainText('X-In Progress');
});

test('"Snapshot everything" restores the view AND a column formatter in one undoable step', async ({ page }) => {
  await page.click('#wb-snap-btn');
  await page.locator('.wb-snapmenu .wb-snap-take-all').click();
  await expect(page.locator('.wb-snapmenu .wb-snap-row')).toHaveCount(1); // the Everything group
  await page.keyboard.press('Escape');

  // mutate the view (hide DueDate) AND the Status column formatter (via drill-in)
  await header(page, 'DueDate').click();
  await page.locator('.wb-grid-menu button', { hasText: 'Hide column' }).click();
  await page.locator('.wb-grid-cell.wb-cell-linked').first().dblclick();
  await openJson(page);
  await page.fill('#wb-json-text', JSON.stringify({ elmType: 'div', txtContent: "='Y-'+[$Status]" }));
  await page.click('#wb-json-apply');
  await page.locator('.wb-fmt-tab-view').click();
  await expect(header(page, 'DueDate')).toHaveCount(0);
  await expect(page.locator('.wb-grid-row').first()).toContainText('Y-In Progress');

  // restore everything: both revert together
  await page.click('#wb-snap-btn');
  await page.locator('.wb-snapmenu .wb-snap-restore').first().click();
  await expect(header(page, 'DueDate')).toHaveCount(1);
  await expect(page.locator('.wb-grid-row').first()).not.toContainText('Y-In Progress');

  // …and ONE Ctrl+Z brings both mutations back
  await page.keyboard.press('Control+z');
  await expect(header(page, 'DueDate')).toHaveCount(0);
  await expect(page.locator('.wb-grid-row').first()).toContainText('Y-In Progress');
});

test('snapshots persist across a reload (their own additive storage key)', async ({ page }) => {
  await page.click('#wb-snap-btn');
  await page.locator('.wb-snapmenu .wb-snap-take').first().click();
  await page.keyboard.press('Escape');
  await page.reload();
  await page.click('#wb-snap-btn');
  await expect(page.locator('.wb-snapmenu .wb-snap-row')).toHaveCount(1);
  // deleting removes it from the list
  await page.locator('.wb-snapmenu .wb-snap-del').click();
  await expect(page.locator('.wb-snapmenu .wb-snap-row')).toHaveCount(0);
});

test('the ← button retraces doc switches — not undo', async ({ page }) => {
  const back = page.locator('#wb-nav-back');
  await expect(back).toBeDisabled(); // nowhere to go yet

  // wander: view → Status → Progress (via the column dropdown gallery)
  await page.locator('.wb-grid-cell.wb-cell-linked').first().dblclick();
  await expect(page.locator('.wb-doc-pill-name')).toHaveText('Status');
  await page.click('#wb-doc-pill');
  await page.locator('.wb-colgal-card', { has: page.locator('.wb-colgal-label', { hasText: 'Progress' }) }).click();
  await expect(page.locator('.wb-doc-pill-name')).toHaveText('Progress');

  // back retraces the trail: Progress → Status → view, then disables
  await expect(back).toBeEnabled();
  await expect(back).toHaveAttribute('title', /Status column/);
  await back.click();
  await expect(page.locator('.wb-doc-pill-name')).toHaveText('Status');
  await back.click();
  await expect(page.locator('.wb-doc-pill-name')).toHaveText('View 1');
  await expect(page.locator('.wb-fmt-tab-view')).toHaveClass(/active/);
  await expect(back).toBeDisabled();
});
