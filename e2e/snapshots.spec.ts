/**
 * E2E: snapshots (issue #140) + navigation back.
 *
 * The 🕘 button on the Formatters bar opens the snapshot menu. Snapshots are
 * full-workspace-only (owner decision, 2026-07-03): the ONE take action
 * captures the view formatter + every column formatter + the view name, and
 * every restore is one undoable step. Legacy scoped captures (pre-full-only
 * storage) stay restorable under a collapsed group. Snapshots persist in
 * localStorage (additive key) across reloads. The ← button retraces doc
 * switches — navigation history, not undo.
 */
import { test, expect } from '@playwright/test';
import { freshApp, header, openJson } from './helpers';

test.beforeEach(async ({ page }) => { await freshApp(page, { acceptDialogs: true }); });

test('take a snapshot, mutate the view, restore it — and Ctrl+Z brings the mutation back', async ({ page }) => {
  // ONE take action — always the whole workspace, no scoped variant
  await page.click('#wb-snap-btn');
  const menu = page.locator('.wb-snapmenu');
  await expect(menu.locator('.wb-snap-take')).toHaveCount(1);
  await expect(menu.locator('.wb-snap-take')).toContainText('Take a snapshot');
  await menu.locator('.wb-snap-take').click();
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

test('drilled into a column, the snapshot still captures (and restores) that column formatter', async ({ page }) => {
  // drill into the Status column formatter — the capture overlays the open doc
  await page.locator('.wb-grid-cell.wb-cell-linked').first().dblclick();
  await expect(page.locator('.wb-doc-pill-name')).toHaveText('Status');

  await page.click('#wb-snap-btn');
  const menu = page.locator('.wb-snapmenu');
  await expect(menu.locator('.wb-snap-take')).toContainText('Take a snapshot');
  await menu.locator('.wb-snap-take').click();
  await page.keyboard.press('Escape');

  // restyle the pill via the JSON pane
  await openJson(page);
  await page.fill('#wb-json-text', JSON.stringify({ elmType: 'div', txtContent: "='X-'+[$Status]" }));
  await page.click('#wb-json-apply');
  await expect(page.locator('.wb-mock-row:not(.wb-mock-header) .wb-mock-cell-fmt').first()).toContainText('X-In Progress');

  // restore the snapshot — back on the view, the original Status pill renders
  await page.click('#wb-snap-btn');
  await page.locator('.wb-snapmenu .wb-snap-restore').first().click();
  await expect(page.locator('.wb-fmt-tab-view')).toHaveClass(/active/);
  await expect(page.locator('.wb-grid-row').first()).not.toContainText('X-In Progress');
});

test('a snapshot restores the view AND a column formatter in one undoable step', async ({ page }) => {
  await page.click('#wb-snap-btn');
  await page.locator('.wb-snapmenu .wb-snap-take').click();
  await expect(page.locator('.wb-snapmenu .wb-snap-row')).toHaveCount(1);
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

  // restore: both revert together
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
  await page.locator('.wb-snapmenu .wb-snap-take').click();
  await page.keyboard.press('Escape');
  await page.reload();
  await page.click('#wb-snap-btn');
  await expect(page.locator('.wb-snapmenu .wb-snap-row')).toHaveCount(1);
  // deleting removes it from the list
  await page.locator('.wb-snapmenu .wb-snap-del').click();
  await expect(page.locator('.wb-snapmenu .wb-snap-row')).toHaveCount(0);
});

test('legacy scoped snapshots stay restorable under the collapsed group', async ({ page }) => {
  // seed a pre-full-only scoped capture straight into the additive store key
  await page.evaluate(() => {
    localStorage.setItem('wb-snapshots.v1', JSON.stringify({
      version: 1,
      snapshots: [{
        id: 'legacy-1',
        takenAt: new Date().toISOString(),
        label: 'Status column',
        scope: { kind: 'column', field: 'Status' },
        payload: { root: { elmType: 'div', txtContent: "='L-'+[$Status]" } },
      }],
    }));
  });
  await page.reload();

  await page.click('#wb-snap-btn');
  const menu = page.locator('.wb-snapmenu');
  // it is NOT in the main list, and there is no scoped take action anywhere
  await expect(menu.locator('.wb-snap-take')).toHaveCount(1);
  await expect(menu.locator('.wb-snapmenu-empty')).toBeVisible();
  const legacy = menu.locator('.wb-snap-legacy');
  await expect(legacy.locator('summary')).toContainText('Older, scoped snapshots (1)');
  await expect(legacy.locator('.wb-snap-row')).toBeHidden(); // collapsed by default

  // expand and restore — the scoped payload still applies (one undoable step)
  await legacy.locator('summary').click();
  await legacy.locator('.wb-snap-restore').click();
  await expect(page.locator('#wb-toast')).toContainText('Ctrl+Z');
  await expect(page.locator('.wb-grid-row').first()).toContainText('L-In Progress');
  await page.keyboard.press('Control+z');
  await expect(page.locator('.wb-grid-row').first()).not.toContainText('L-In Progress');
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
  await expect(page.locator('.wb-doc-pill-name')).toHaveText('Grid');
  await expect(page.locator('.wb-fmt-tab-view')).toHaveClass(/active/);
  await expect(back).toBeDisabled();
});
