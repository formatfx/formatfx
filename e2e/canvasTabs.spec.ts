/**
 * E2E: the CANVAS TAB STRIP — the one navigation surface
 * (COLUMNS-COMPONENTS-VIEWS §2). The standing ▦ Grid tab plus one tab per
 * opened view (☰/▤) or ⬡ component workshop; tabs open/focus, close, rename
 * inline, rearrange by drag, and the open set persists across reloads.
 * A component tab COVERS the canvas with the workshop; the surface (and
 * state.doc) waits untouched underneath. The old formatter tablist, document
 * pill and view strip are gone.
 */
import { test, expect } from '@playwright/test';
import { freshApp, canvasTab, openGridTab, makeRowView } from './helpers';

test.beforeEach(async ({ page }) => { await freshApp(page, { acceptDialogs: true }); });

test('the strip lands with the standing Grid tab only; the retired navigation chrome is gone', async ({ page }) => {
  const tabs = page.locator('#wb-canvastabs .wb-canvastab');
  await expect(tabs).toHaveCount(1);
  await expect(tabs.first()).toHaveClass(/wb-canvastab-grid/);
  await expect(tabs.first()).toHaveClass(/active/);
  await expect(tabs.first()).toContainText('Grid');
  // the Grid tab is standing — it has no close button
  await expect(tabs.first().locator('.wb-canvastab-close')).toHaveCount(0);
  // the pre-migration navigation surfaces are gone for good
  await expect(page.locator('.wb-fmt-tab')).toHaveCount(0);
  await expect(page.locator('#wb-doc-pill')).toHaveCount(0);
  await expect(page.locator('#wb-viewstrip')).toHaveCount(0);
  await expect(page.locator('#wb-ribbon')).toHaveCount(0);
});

test('opening a view appends its tab; tab clicks are NAVIGATION between grid and view', async ({ page }) => {
  await makeRowView(page, ['Title', 'Status']);
  // the new view opened as the second tab, active
  const viewTab = canvasTab(page, 'View 1');
  await expect(viewTab).toHaveClass(/wb-canvastab-view/);
  await expect(viewTab).toHaveClass(/active/);
  await expect(page.locator('.wb-mock-viewrow')).toHaveCount(3);

  // Grid tab click = navigation back to the floor (the view waits in its tab)
  await openGridTab(page);
  await expect(canvasTab(page, 'Grid')).toHaveClass(/active/);
  await expect(page.locator('.wb-grid-headrow')).toBeVisible();
  await viewTab.locator('.wb-canvastab-btn').click();
  await expect(viewTab).toHaveClass(/active/);
  await expect(page.locator('.wb-mock-viewrow')).toHaveCount(3);

  // navigation never mutates: ONE Ctrl+Z removes the view creation itself —
  // the tab flips back and forth added nothing to the undo stack
  await page.keyboard.press('Control+z');
  await expect(page.locator('#wb-canvastabs .wb-canvastab')).toHaveCount(1);
  await expect(page.locator('.wb-grid-headrow')).toBeVisible();
});

test('double-click renames a view tab inline; Enter commits, Esc cancels; the name persists', async ({ page }) => {
  await makeRowView(page, ['Title']);
  const viewTab = canvasTab(page, 'View 1');
  await viewTab.locator('.wb-canvastab-btn').dblclick();
  const input = page.locator('.wb-canvastab-input');
  await expect(input).toHaveValue('View 1');
  await input.fill('Sprint board');
  await input.press('Enter');
  await expect(canvasTab(page, 'Sprint board')).toBeVisible();
  // the views list in the left pane speaks the new name too
  await expect(page.locator('.wb-viewslist-row')).toContainText('Sprint board');

  // Esc cancels a rename without committing
  await canvasTab(page, 'Sprint board').locator('.wb-canvastab-btn').dblclick();
  await page.locator('.wb-canvastab-input').fill('Nope');
  await page.keyboard.press('Escape');
  await expect(canvasTab(page, 'Sprint board')).toBeVisible();
  await expect(canvasTab(page, 'Nope')).toHaveCount(0);

  // names are project data — the rename survives a reload
  await page.reload();
  await expect(canvasTab(page, 'Sprint board')).toBeVisible();
});

test('closing a view tab never deletes the view — it waits in the views list and reopens', async ({ page }) => {
  await makeRowView(page, ['Title', 'DueDate']);
  await canvasTab(page, 'View 1').locator('.wb-canvastab-close').click();
  // back on the grid, tab gone…
  await expect(page.locator('#wb-canvastabs .wb-canvastab')).toHaveCount(1);
  await expect(page.locator('.wb-grid-headrow')).toBeVisible();
  // …but the view itself survives in the left pane's views list
  const row = page.locator('.wb-viewslist-row', { hasText: 'View 1' });
  await expect(row).toBeVisible();
  // reopening from the list restores the tab (open = focus, never a duplicate)
  await row.locator('.wb-viewslist-open').click();
  await expect(canvasTab(page, 'View 1')).toHaveClass(/active/);
  await expect(page.locator('.wb-mock-viewrow')).toHaveCount(3);
  await row.locator('.wb-viewslist-open').click();
  await expect(page.locator('#wb-canvastabs .wb-canvastab')).toHaveCount(2);
});

test('the open tab set persists across a reload, active tab included', async ({ page }) => {
  await makeRowView(page, ['Title', 'Status']);
  await expect(canvasTab(page, 'View 1')).toHaveClass(/active/);
  await page.reload();
  await expect(page.locator('#wb-canvastabs .wb-canvastab')).toHaveCount(2);
  await expect(canvasTab(page, 'View 1')).toHaveClass(/active/);
  await expect(page.locator('.wb-mock-viewrow')).toHaveCount(3);
});

test('tabs rearrange by drag — presentational metadata, off the undo stack, autosaved', async ({ page }) => {
  await makeRowView(page, ['Title']);
  await openGridTab(page);
  await makeRowView(page, ['Status']);
  await expect(page.locator('#wb-canvastabs .wb-canvastab-name'))
    .toHaveText(['Grid', 'View 1', 'View 2']);

  // drag View 2 onto View 1's left half → insert before it
  await canvasTab(page, 'View 2').dragTo(canvasTab(page, 'View 1'), { targetPosition: { x: 5, y: 10 } });
  await expect(page.locator('#wb-canvastabs .wb-canvastab-name'))
    .toHaveText(['Grid', 'View 2', 'View 1']);
  // the reordered strip autosaves and survives a reload
  await page.reload();
  await expect(page.locator('#wb-canvastabs .wb-canvastab-name'))
    .toHaveText(['Grid', 'View 2', 'View 1']);

  // reordering is presentation, not a document change — the undo stack holds
  // only the two view creations, so the FIRST Ctrl+Z removes View 2 (the last
  // document step), not the rearrangement
  await openGridTab(page);
  await makeRowView(page, ['DueDate']); // View 3, a fresh undoable step
  await canvasTab(page, 'View 3').dragTo(canvasTab(page, 'View 2'), { targetPosition: { x: 5, y: 10 } });
  await expect(page.locator('#wb-canvastabs .wb-canvastab-name'))
    .toHaveText(['Grid', 'View 3', 'View 2', 'View 1']);
  await page.keyboard.press('Control+z');
  await expect(page.locator('#wb-canvastabs .wb-canvastab-name'))
    .toHaveText(['Grid', 'View 2', 'View 1']);
});

test('a component tab is the WORKSHOP: it covers the canvas; the surface waits underneath', async ({ page }) => {
  // open a built-in's workshop from the library row's ✎
  const node = page.locator('.wb-comp-node')
    .filter({ has: page.locator('.wb-comp-rowname', { hasText: 'Deadline chip' }) }).first();
  await node.locator('.wb-comp-row').hover();
  await node.locator('.wb-comp-rowedit').click();

  const compTab = canvasTab(page, 'Deadline chip');
  await expect(compTab).toHaveClass(/wb-canvastab-comp/);
  await expect(compTab).toHaveClass(/active/);
  // the workshop covers the canvas region
  await expect(page.locator('#wb-workshop .wb-ce-workshop')).toBeVisible();
  await expect(page.locator('#wb-canvas')).toBeHidden();
  // the This-view card swaps to the def card while a workshop is up
  await expect(page.locator('#wb-lp-viewcard')).toContainText('Deadline chip');
  // v1 constraint: the staged def is NOT the surface — the kind select
  // (which follows state.doc) disables while a component tab is up
  await expect(page.locator('#wb-kind')).toBeDisabled();

  // Grid tab uncovers the canvas; the workshop tab stays open
  await openGridTab(page);
  await expect(page.locator('#wb-canvas')).toBeVisible();
  await expect(page.locator('#wb-workshop')).toBeHidden();
  await expect(compTab).not.toHaveClass(/active/);
  await expect(page.locator('#wb-kind')).toBeEnabled();
});

test('staged workshop edits survive a tab switch, show the dirty dot, and closing discards them', async ({ page }) => {
  const node = page.locator('.wb-comp-node')
    .filter({ has: page.locator('.wb-comp-rowname', { hasText: 'Deadline chip' }) }).first();
  await node.locator('.wb-comp-row').hover();
  await node.locator('.wb-comp-rowedit').click();
  const ce = page.locator('#wb-workshop .wb-ce');

  // a staged style gesture dirties the tab (the dot appears)
  await ce.locator('.wb-ce-style .wb-ce-swatch[title="#5c2d91"]').first().click();
  await expect(page.locator('.wb-canvastab-dirty')).toHaveCount(1);
  await expect(page.locator('.wb-canvastab-dot')).toBeVisible();

  // switching away and back keeps the staging alive (keep-alive, not a save)
  await openGridTab(page);
  await canvasTab(page, 'Deadline chip').locator('.wb-canvastab-btn').click();
  await expect(ce.locator('.wb-ce-preview [style*="rgb(92, 45, 145)"]').first()).toBeVisible();
  await expect(page.locator('.wb-canvastab-dirty')).toHaveCount(1);

  // closing a dirty tab asks (auto-accepted) — close means discard
  await canvasTab(page, 'Deadline chip').locator('.wb-canvastab-close').click();
  await expect(page.locator('#wb-canvastabs .wb-canvastab')).toHaveCount(1);
  await node.locator('.wb-comp-row').hover();
  await node.locator('.wb-comp-rowedit').click();
  await expect(page.locator('#wb-workshop .wb-ce-preview [style*="rgb(92, 45, 145)"]')).toHaveCount(0);
  await expect(page.locator('.wb-canvastab-dirty')).toHaveCount(0);
});

test('"＋ New component…" starts a blank def in its own workshop tab', async ({ page }) => {
  await page.locator('.wb-comp-newdef').click();
  const compTab = canvasTab(page, 'New component');
  await expect(compTab).toHaveClass(/wb-canvastab-comp/);
  await expect(compTab).toHaveClass(/active/);
  await expect(page.locator('#wb-workshop .wb-ce-name')).toHaveValue('New component');
  // a second ask never collides — the next blank def numbers itself
  await openGridTab(page);
  await page.locator('.wb-comp-newdef').click();
  await expect(canvasTab(page, 'New component 2')).toHaveClass(/active/);
});
