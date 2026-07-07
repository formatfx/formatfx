/**
 * E2E: snapshots (issue #140) + navigation back.
 *
 * The 🕘 button on the left pane's nav row opens the snapshot menu. Snapshots
 * are full-workspace-only (owner decision, 2026-07-03): the ONE take action
 * captures the floor + every view + every column LOOK, and every restore is
 * one undoable step. Legacy scoped captures (pre-full-only storage) stay
 * restorable under a collapsed group. Snapshots persist in localStorage
 * (additive key) across reloads. The ← button retraces surface switches —
 * navigation history, not undo.
 */
import { test, expect } from '@playwright/test';
import { freshApp, header, canvasTab, openGridTab, makeRowView } from './helpers';

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

test('a snapshot captures the column LOOKS: remove one, restore brings it back', async ({ page }) => {
  await page.click('#wb-snap-btn');
  await page.locator('.wb-snapmenu .wb-snap-take').click();
  await page.keyboard.press('Escape');

  // strip Status's look — plain value, no ⬡ mark
  await header(page, 'Status').click();
  await page.locator('.wb-grid-menu button', { hasText: 'Remove the look' }).click();
  await expect(header(page, 'Status').locator('.wb-grid-look')).toHaveCount(0);

  // restore — the look (and its ⬡ mark) is back
  await page.click('#wb-snap-btn');
  await page.locator('.wb-snapmenu .wb-snap-restore').first().click();
  await expect(header(page, 'Status').locator('.wb-grid-look')).toHaveCount(1);
  await expect(page.locator('.wb-grid-row').first().locator('.wb-grid-cell[data-col="1"] [style*="border-radius"]').first())
    .toBeVisible();
});

test('a snapshot restores the layout AND a column look in one undoable step', async ({ page }) => {
  await page.click('#wb-snap-btn');
  await page.locator('.wb-snapmenu .wb-snap-take').click();
  await expect(page.locator('.wb-snapmenu .wb-snap-row')).toHaveCount(1);
  await page.keyboard.press('Escape');

  // mutate the layout (hide DueDate) AND the looks (strip Status)
  await header(page, 'DueDate').click();
  await page.locator('.wb-grid-menu button', { hasText: 'Hide column' }).click();
  await header(page, 'Status').click();
  await page.locator('.wb-grid-menu button', { hasText: 'Remove the look' }).click();
  await expect(header(page, 'DueDate')).toHaveCount(0);
  await expect(header(page, 'Status').locator('.wb-grid-look')).toHaveCount(0);

  // restore: both revert together
  await page.click('#wb-snap-btn');
  await page.locator('.wb-snapmenu .wb-snap-restore').first().click();
  await expect(header(page, 'DueDate')).toHaveCount(1);
  await expect(header(page, 'Status').locator('.wb-grid-look')).toHaveCount(1);

  // …and ONE Ctrl+Z brings both mutations back
  await page.keyboard.press('Control+z');
  await expect(header(page, 'DueDate')).toHaveCount(0);
  await expect(header(page, 'Status').locator('.wb-grid-look')).toHaveCount(0);
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

  // expand and restore — the scoped payload still applies as Status's LOOK
  // (one undoable step: the store and the placed grid cell together)
  await legacy.locator('summary').click();
  await legacy.locator('.wb-snap-restore').click();
  await expect(page.locator('#wb-toast')).toContainText('Ctrl+Z');
  await expect(page.locator('.wb-grid-row').first()).toContainText('L-In Progress');
  await page.keyboard.press('Control+z');
  await expect(page.locator('.wb-grid-row').first()).not.toContainText('L-In Progress');
});

test('the ← button retraces surface switches — not undo', async ({ page }) => {
  const back = page.locator('#wb-nav-back');
  await expect(back).toBeDisabled(); // nowhere to go yet

  // wander: grid → a new view → back to the grid via its tab
  await makeRowView(page, ['Title', 'Status']);
  await expect(canvasTab(page, 'View 1')).toHaveClass(/active/);
  await openGridTab(page);
  await expect(canvasTab(page, 'Grid')).toHaveClass(/active/);

  // back retraces the trail: grid → view → grid, then disables
  await expect(back).toBeEnabled();
  await back.click();
  await expect(canvasTab(page, 'View 1')).toHaveClass(/active/);
  await expect(page.locator('.wb-mock-viewrow')).toHaveCount(3);
  await back.click();
  await expect(canvasTab(page, 'Grid')).toHaveClass(/active/);
  await expect(back).toBeDisabled();
  // retracing was NAVIGATION: the undo stack still holds only the view
  // creation — one Ctrl+Z removes the view, not the wandering
  await page.keyboard.press('Control+z');
  await expect(page.locator('#wb-canvastabs .wb-canvastab')).toHaveCount(1);
});
