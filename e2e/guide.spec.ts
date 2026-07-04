/**
 * Field guide (☰ menu → 📖): the Learn-style reader over guideContent.
 * Covers: opening, nav tree + active state, cross-page links, the
 * "In this article" rail, prev/next pager, filtering, and Esc to close.
 */
import { test, expect, type Page } from '@playwright/test';
import { freshApp } from './helpers';

test.beforeEach(async ({ page }) => { await freshApp(page); });

async function openGuide(page: Page): Promise<void> {
  await page.click('#wb-menu-btn');
  await page.click('#wb-guide');
  await expect(page.locator('.wb-guide-overlay')).toBeVisible();
}

test('opens from the ☰ menu with nav tree, overview article and rail', async ({ page }) => {
  await openGuide(page);
  // chapters in the library tree
  await expect(page.locator('.wb-guide-chapter')).toHaveText(
    ['Start here', 'The column system', 'The JSON layer', 'Field notes']);
  // lands on the overview, marked active in the nav
  await expect(page.locator('.wb-guide-article h1')).toHaveText('What a list really is');
  await expect(page.locator('.wb-guide-navitem.active')).toHaveText('What a list really is');
  // the "In this article" rail mirrors the page's h2s
  await expect(page.locator('.wb-guide-railitem').first()).toContainText('A list is a table');
  // the stack diagram renders
  await expect(page.locator('.wb-guide-fig svg').first()).toBeVisible();
});

test('nav tree switches pages; gotchas carry severity chips and linter tags', async ({ page }) => {
  await openGuide(page);
  await page.locator('.wb-guide-navitem', { hasText: 'The gotchas' }).click();
  await expect(page.locator('.wb-guide-article h1')).toHaveText('The gotchas');
  await expect(page.locator('.wb-guide-navitem.active')).toHaveText('The gotchas');
  await expect(page.locator('.wb-guide-gotcha', { hasText: 'Zero Whitespace Rule' })).toBeVisible();
  await expect(page.locator('.wb-guide-lintrule', { hasText: 'zero-whitespace' })).toBeVisible();
});

test('cross-page links and the prev/next pager navigate', async ({ page }) => {
  await openGuide(page);
  // overview links into the capability matrix
  await page.locator('.wb-guide-article a[data-guide-page="single-vs-multi"]').first().click();
  await expect(page.locator('.wb-guide-article h1')).toContainText('capability matrix');
  await expect(page.locator('.wb-guide-matrix')).toBeVisible();
  // pager: next continues reading order, prev returns
  await page.locator('.wb-guide-pager .wb-guide-next').click();
  await expect(page.locator('.wb-guide-article h1')).toContainText('Formatting JSON');
  await page.locator('.wb-guide-pager button').first().click();
  await expect(page.locator('.wb-guide-article h1')).toContainText('capability matrix');
});

test('rail click jumps to the section and the scroll spy follows', async ({ page }) => {
  await openGuide(page);
  await page.locator('.wb-guide-navitem', { hasText: 'Everything that joins' }).click();
  await page.locator('.wb-guide-railitem', { hasText: 'Choice vs lookup vs managed metadata' }).click();
  await expect(page.locator('#jn-which')).toBeInViewport();
  await expect(page.locator('.wb-guide-railitem.active')).toContainText('Choice vs lookup');
});

test('filter narrows the tree; Esc closes and reopening resumes the page', async ({ page }) => {
  await openGuide(page);
  await page.fill('.wb-guide-search', 'calculated');
  // every remaining page mentions calculated columns; overview-only pages drop out
  const items = page.locator('.wb-guide-navitem');
  await expect(items.count()).resolves.toBeGreaterThan(0);
  await expect(page.locator('.wb-guide-navitem', { hasText: 'Calculated columns' })).toBeVisible();
  await page.fill('.wb-guide-search', 'zzz-no-match');
  await expect(page.locator('.wb-guide-none')).toBeVisible();
  // open a specific page, close with Esc, reopen → resumes there
  await page.fill('.wb-guide-search', '');
  await page.locator('.wb-guide-navitem', { hasText: 'Commands & actions' }).click();
  await page.keyboard.press('Escape');
  await expect(page.locator('.wb-guide-overlay')).toBeHidden();
  await openGuide(page);
  await expect(page.locator('.wb-guide-article h1')).toContainText('Commands');
});
