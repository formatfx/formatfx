/**
 * E2E: LOOK legibility — "teal ⬡ = a component at work". A column's look is a
 * component applied to it (COLUMNS-COMPONENTS-VIEWS §1): the header wears the
 * ⬡ mark when a stamped instance backs the look, the structure tree speaks
 * the binding language ("⬡ Name ← Column"), grid columns highlight only for
 * payloads they accept (the look-drop), and the inspector's INSTANCE card is
 * the provenance surface. The violet § channel (CFR marks, reference tags,
 * scope chips, style banners) is gone from the DOM entirely.
 */
import { test, expect } from '@playwright/test';
import { freshApp, header } from './helpers';

test.beforeEach(async ({ page }) => { await freshApp(page, { acceptDialogs: true }); });

test('⬡ header marks: look-wearing columns carry them, bare columns do not', async ({ page }) => {
  // Status and Progress ship wearing palette components; Title ships bare
  await expect(header(page, 'Status').locator('.wb-grid-look')).toHaveCount(1);
  await expect(header(page, 'Progress').locator('.wb-grid-look')).toHaveCount(1);
  await expect(header(page, 'Title').locator('.wb-grid-look')).toHaveCount(0);
  // the mark names the component it stands for
  await expect(header(page, 'Status').locator('.wb-grid-look'))
    .toHaveAttribute('title', /Status pill/);
});

test('the violet § channel is gone: no CFR marks, reference tags, chips, banners or scope chips', async ({ page }) => {
  await expect(page.locator('.wb-style-mark')).toHaveCount(0);
  await expect(page.locator('.wb-cfr-link')).toHaveCount(0);
  await expect(page.locator('.wb-cfr-chip')).toHaveCount(0);
  await expect(page.locator('.wb-tree-cfr-open')).toHaveCount(0);
  await expect(page.locator('.wb-scope-chip')).toHaveCount(0);
  await expect(page.locator('.wb-style-banner')).toHaveCount(0);
  await expect(page.locator('.wb-cell-linked')).toHaveCount(0);
});

test('tree binding language: instance rows read "⬡ Name ← Column"; plain rows carry neither', async ({ page }) => {
  const statusRow = page.locator('#wb-tree-body .wb-tree-row',
    { has: page.locator('.wb-tree-name', { hasText: 'Status pill' }) });
  await expect(statusRow.locator('.wb-comp-mark')).toHaveText('⬡');
  await expect(statusRow.locator('.wb-tree-bindtag')).toHaveText('← Status');
  const barRow = page.locator('#wb-tree-body .wb-tree-row',
    { has: page.locator('.wb-tree-name', { hasText: 'Data bar' }) });
  await expect(barRow.locator('.wb-tree-bindtag')).toHaveText('← Progress');
  // a plain column row (Title) has no mark and no bindtag
  const titleRow = page.locator('#wb-tree-body .wb-tree-row',
    { has: page.locator('.wb-tree-name', { hasText: 'Title' }) });
  await expect(titleRow.locator('.wb-comp-mark')).toHaveCount(0);
  await expect(titleRow.locator('.wb-tree-bindtag')).toHaveCount(0);
});

test('look-drop highlight is accept-gated: a ⬡ payload lights the whole column, a foreign payload nothing', async ({ page }) => {
  const marks = await page.evaluate(() => {
    const cell = document.querySelector('.wb-grid-cell[data-col="2"]')!; // DueDate
    const fire = (dt: DataTransfer): number => {
      cell.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
      const n = document.querySelectorAll('.wb-grid-drop-look').length;
      document.querySelectorAll('.wb-grid-drop-look').forEach((el) => el.classList.remove('wb-grid-drop-look'));
      return n;
    };
    const component = new DataTransfer();
    component.setData('application/x-wb-component', 'builtin-deadline-chip');
    const foreign = new DataTransfer();
    foreign.setData('text/plain', 'not a component');
    return { component: fire(component), foreign: fire(foreign) };
  });
  // the whole column highlights (header + one cell per mock row), never the grid
  expect(marks.component).toBe(4);
  expect(marks.foreign).toBe(0);
});

test('the instance card is the provenance surface: bound instances get it, plain elements do not', async ({ page }) => {
  // select the bound Status pill instance → the ⬡ card names the component
  await page.locator('#wb-tree-body .wb-tree-row',
    { has: page.locator('.wb-tree-name', { hasText: 'Status pill' }) }).click();
  const card = page.locator('.wb-inst-card');
  await expect(card).toBeVisible();
  await expect(card.locator('.wb-inst-head')).toContainText('Status pill');
  await expect(card.locator('.wb-inst-slot-select')).toHaveValue('Status');
  await expect(card.locator('.wb-inst-detach')).toBeVisible();
  await expect(card.locator('.wb-inst-removelook')).toBeVisible();
  // a plain element (the Title cell) shows no instance card
  await page.locator('#wb-tree-body .wb-tree-row',
    { has: page.locator('.wb-tree-name', { hasText: 'Title' }) }).click();
  await expect(page.locator('.wb-inst-card')).toHaveCount(0);
});

test('an imported (unstamped) look renders but wears no ⬡ mark — one gesture from editability', async ({ page }) => {
  // paste column JSON: it becomes the CURRENT field's look, unstamped (no def)
  await page.click('#wb-json-toggle');
  await page.fill('#wb-json-text', JSON.stringify({
    elmType: 'div', txtContent: "='»'+@currentField+'«'",
  }));
  await page.click('#wb-json-apply');
  await expect(page.locator('#wb-toast')).toContainText("applied as the Status column's look");
  // renders embedded in the grid…
  await expect(page.locator('.wb-grid-row').first()).toContainText('»In Progress«');
  // …but the ⬡ mark is gone: no def backs this look, so nothing names it
  await expect(header(page, 'Status').locator('.wb-grid-look')).toHaveCount(0);
  // the header menu still offers the doors: remove it, or LIFT it into a
  // component ("Save as component…") — never silently editable
  await header(page, 'Status').click();
  await expect(page.locator('.wb-grid-menu button', { hasText: 'Remove the look' })).toBeVisible();
  await expect(page.locator('.wb-grid-menu button', { hasText: 'Save as component…' })).toBeVisible();
  await expect(page.locator('.wb-grid-menu button', { hasText: 'Change the component…' })).toHaveCount(0);
});
