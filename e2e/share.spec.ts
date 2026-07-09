/**
 * Share links (W1 of the collaborative-hub epic), the Explain tab and the
 * Stress Test overlay — the URL IS the workspace, and opening someone
 * else's link must never clobber your own autosaved work.
 *
 * Recipients are modeled as REAL fresh browser contexts (their own storage),
 * seeded via addInitScript where "existing own work" is part of the story —
 * seeding through the app's page would be flushed over by its own
 * beforeunload autosave.
 */
import { test, expect, type Page, type Browser } from '@playwright/test';
import { freshApp, loadExample, openJson } from './helpers';

const KEY = 'list-formatting-sandbox.project.v1';

test.beforeEach(async ({ page }) => { await freshApp(page, { acceptDialogs: true }); });

/** Mint a share link for the current workspace via the Share dialog. */
async function mintShareLink(page: Page): Promise<string> {
  await page.click('#wb-share');
  const input = page.locator('#wb-share-url');
  await expect(input).not.toHaveValue('', { timeout: 10_000 });
  const link = await input.inputValue();
  await page.keyboard.press('Escape');
  return link;
}

/** A recipient: a fresh context (own storage), optionally with existing work. */
async function recipient(browser: Browser, ownWork?: string | null): Promise<Page> {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  if (ownWork) {
    await ctx.addInitScript(({ key, own }) => { localStorage.setItem(key, own); }, { key: KEY, own: ownWork });
  }
  const p = await ctx.newPage();
  p.on('dialog', (d) => { void d.accept(); });
  return p;
}

/** The sender's "own work": an edit on the default grid, waited into autosave. */
async function makeOwnWork(page: Page): Promise<string> {
  await page.click('#wb-kebab-btn');
  await page.click('.wb-snapmenu .wb-kebab-item[data-tool="text"]');
  await expect.poll(() => page.evaluate((k) => localStorage.getItem(k), KEY), { timeout: 5_000 }).not.toBeNull();
  return (await page.evaluate((k) => localStorage.getItem(k), KEY))!;
}

test('share round trip: mint a link, open it fresh, Save a copy persists it', async ({ page, browser }) => {
  await loadExample(page, 'status-pill'); // a column formatter — distinct from the grid default
  const link = await mintShareLink(page);
  expect(link).toContain('#w1=');

  // a clean profile opens the link
  const p2 = await recipient(browser);
  await p2.goto(link);

  // the shared workspace is on the canvas, the fragment is stripped, and
  // NOTHING has been written to the recipient's autosave
  await expect(p2.locator('.wb-share-banner')).toBeVisible();
  expect(p2.url()).not.toContain('#w1=');
  await openJson(p2);
  await expect(p2.locator('#wb-kind')).toHaveValue('grid');
  expect(await p2.evaluate((k) => localStorage.getItem(k), KEY)).toBeNull();

  // the explicit gesture is what persists it
  await p2.click('.wb-share-keep');
  await expect(p2.locator('.wb-share-banner')).toHaveCount(0);
  expect(await p2.evaluate((k) => localStorage.getItem(k), KEY)).not.toBeNull();

  // and it survives a refresh as the recipient's own workspace, banner-free
  await p2.reload();
  await openJson(p2);
  await expect(p2.locator('#wb-kind')).toHaveValue('grid');
  await expect(p2.locator('.wb-share-banner')).toHaveCount(0);
  await p2.context().close();
});

test('a share link never clobbers existing work; Discard returns to it', async ({ page, browser }) => {
  const ownWork = await makeOwnWork(page);

  // someone shares a row-card workspace at them
  await loadExample(page, 'row-card');
  const link = await mintShareLink(page);

  const p2 = await recipient(browser, ownWork);
  await p2.goto(link);

  // viewing the shared workspace — their own autosave is byte-identical
  await expect(p2.locator('.wb-share-banner')).toBeVisible();
  await openJson(p2);
  await expect(p2.locator('#wb-kind')).toHaveValue('row');
  expect(await p2.evaluate((k) => localStorage.getItem(k), KEY)).toBe(ownWork);

  // Discard goes back to their own work
  await p2.click('.wb-share-discard');
  await expect(p2.locator('.wb-share-banner')).toHaveCount(0);
  await expect(p2.locator('#wb-kind')).toHaveValue('grid');
  expect(await p2.evaluate((k) => localStorage.getItem(k), KEY)).toBe(ownWork);
  await p2.context().close();
});

test('Save a copy over existing work backs it up, restorable from the ☰ menu', async ({ page, browser }) => {
  const ownWork = await makeOwnWork(page);
  await loadExample(page, 'status-pill');
  const link = await mintShareLink(page);

  const p2 = await recipient(browser, ownWork);
  await p2.goto(link);
  await p2.click('.wb-share-keep');

  // previous work moved to the additive backup key — nothing lost
  expect(await p2.evaluate((k) => localStorage.getItem(`${k}.bak`), KEY)).toBe(ownWork);

  // the ☰ restore item brings it back (and swaps, so the shared copy survives too)
  await p2.click('#wb-menu-btn');
  await expect(p2.locator('#wb-restore-backup')).toBeVisible();
  await p2.click('#wb-restore-backup');
  await openJson(p2);
  await expect(p2.locator('#wb-kind')).toHaveValue('grid');
  await p2.context().close();
});

test('the share dialog can leave mock data out of the link', async ({ page }) => {
  await page.click('#wb-share');
  const input = page.locator('#wb-share-url');
  await expect(input).not.toHaveValue('');
  const withData = await input.inputValue();
  await page.click('#wb-share-include-data');
  await expect(input).not.toHaveValue(withData);
  await expect(page.locator('#wb-share-size')).toContainText('0 mock rows');
});

test('Explain tab reads the formatter back in plain English and refuses honestly', async ({ page }) => {
  await openJson(page);
  await page.click('#wb-side-tab-explain');
  // the default grid workspace has plenty to say (CFR cells, field text)
  await expect(page.locator('.wb-explain-entry').first()).toBeVisible();
  await expect(page.locator('.wb-explain-list')).toContainText('Shows');
  // Explain navigates like a lint warning: click selects the element
  await page.locator('.wb-explain-entry').first().click();
  // paste something outside the vocabulary → an honest "can't explain yet"
  await page.click('#wb-side-tab-json');
  await page.fill('#wb-json-text', JSON.stringify({ elmType: 'div', txtContent: '=mystery([$Title])' }));
  await page.click('#wb-json-apply');
  await page.click('#wb-side-tab-explain');
  await expect(page.locator('.wb-explain-unexplained')).toContainText("can’t explain this yet");
});

test('Stress test renders the edge-case matrix read-only; adding a row is explicit', async ({ page }) => {
  const before = await page.evaluate((k) => localStorage.getItem(k), KEY);
  await page.click('#wb-menu-btn');
  await page.click('#wb-menu-more');
  await page.click('#wb-stress');
  const overlay = page.locator('.wb-stress-overlay');
  await expect(overlay).toBeVisible();
  await expect(overlay.locator('.wb-stress-variant h3')).toContainText(['Empty state', 'The Novel']);
  await expect(overlay.locator('.wb-stress-row').first()).toBeVisible();

  // browsing is read-only: closing leaves the workspace and autosave untouched
  await page.keyboard.press('Escape');
  await expect(overlay).toHaveCount(0);
  await expect(page.locator('.wb-grid-row')).toHaveCount(3);
  expect(await page.evaluate((k) => localStorage.getItem(k), KEY)).toBe(before);

  // the one explicit write: Add to my rows
  await page.click('#wb-menu-btn');
  await page.click('#wb-menu-more');
  await page.click('#wb-stress');
  await page.locator('.wb-stress-add').first().click();
  await page.keyboard.press('Escape');
  await expect(page.locator('.wb-grid-row')).toHaveCount(4);
});
