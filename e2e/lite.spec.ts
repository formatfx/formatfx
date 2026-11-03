/**
 * FormatFX Lite (lite.html) — the cards-only test page (docs/LITE.md).
 * Contracts: a drag is ONE undoable change; Copy JSON hands over a gallery
 * formatter of free-layout parts; a SharePoint-designer card pasted in opens
 * as parts; a list-row layout is refused with a reason.
 */
import { test, expect, type Page } from '@playwright/test';

const KEY = 'formatfx-lite:v1';

async function freshLite(page: Page): Promise<void> {
  await page.goto('/lite.html');
  await page.evaluate((k) => localStorage.removeItem(k), KEY);
  await page.reload();
  await expect(page.locator('.lt-card-host [data-sp-path="2"]')).toBeVisible();
}

interface Part { _elmName?: string; txtContent?: string; style?: Record<string, string> }
async function savedParts(page: Page): Promise<Part[]> {
  const saved = await page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? 'null'), KEY);
  return saved.doc.root.children as Part[];
}

const designerCard = {
  $schema: 'https://developer.microsoft.com/json-schemas/sp/v2/tile-formatting.schema.json',
  height: 220,
  width: 254,
  formatter: {
    elmType: 'div',
    attributes: { class: 'sp-card-container' },
    children: [
      { elmType: 'div', attributes: { class: 'sp-card-defaultClickButton', role: 'button' }, customRowAction: { action: 'defaultClick' } },
      {
        elmType: 'div',
        attributes: { class: 'sp-card-subContainer sp-card-borderHighlight' },
        children: [
          { elmType: 'div', attributes: { class: 'sp-card-displayColumnContainer' }, children: [
            { elmType: 'p', txtContent: '[!Title.DisplayName]', attributes: { class: 'sp-card-label' } },
            { elmType: 'p', txtContent: '[$Title]', attributes: { class: 'sp-card-content sp-card-highlightedContent' } },
          ] },
          { elmType: 'div', attributes: { class: 'sp-card-displayColumnContainer' }, children: [
            { elmType: 'p', txtContent: '[$Status]', attributes: { class: 'sp-card-content' } },
          ] },
        ],
      },
    ],
  },
};

test('a drag moves the part in the JSON, and one undo puts it back', async ({ page }) => {
  await freshLite(page);
  const title = page.locator('.lt-card-host [data-sp-path="2"]');
  const box = (await title.boundingBox())!;
  await page.mouse.move(box.x + 20, box.y + 8);
  await page.mouse.down();
  await page.mouse.move(box.x + 50, box.y + 38, { steps: 6 });
  await page.mouse.up();
  await expect(page.locator('.lt-ctx-name')).toHaveText('Title');
  expect((await savedParts(page))[2].style?.left).not.toBe('16px');
  await page.keyboard.press('Control+z');
  const back = (await savedParts(page))[2].style;
  expect([back?.left, back?.top]).toEqual(['16px', '22px']);
});

test('arrow keys nudge, and a run of nudges is one undo step', async ({ page }) => {
  await freshLite(page);
  await page.locator('.lt-card-host [data-sp-path="2"]').click();
  for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight');
  expect((await savedParts(page))[2].style?.left).toBe('19px');
  await page.keyboard.press('Control+z');
  expect((await savedParts(page))[2].style?.left).toBe('16px');
});

test('Copy JSON hands over a gallery formatter of free-layout parts', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await freshLite(page);
  await page.getByRole('button', { name: 'Copy JSON' }).click();
  await expect(page.locator('.lt-toast')).toContainText('Copied');
  const json = JSON.parse(await page.evaluate(() => navigator.clipboard.readText()));
  expect(json.$schema).toContain('view-formatting.schema.json');
  expect([json.width, json.height]).toEqual([254, 236]);
  expect(json.formatter.style.position).toBe('relative');
  const parts = json.formatter.children.slice(1) as Part[];
  expect(parts.length).toBeGreaterThan(5);
  for (const p of parts) expect(p.style?.position).toBe('absolute');
});

test('a pasted SharePoint card opens as parts; a list-row layout is refused', async ({ page }) => {
  await freshLite(page);
  await page.getByRole('button', { name: 'Paste JSON' }).click();
  await page.locator('dialog textarea').fill(JSON.stringify(designerCard));
  await page.getByRole('button', { name: 'Open card' }).click();
  await expect(page.locator('dialog[open]')).toHaveCount(0);
  await expect(page.locator('.lt-toast')).toContainText('Opened as free layout');
  const names = (await savedParts(page)).map((p) => p._elmName ?? p.txtContent);
  expect(names).toEqual(expect.arrayContaining(['Background', '[!Title.DisplayName]', '[$Title]', '[$Status]']));

  await page.getByRole('button', { name: 'Paste JSON' }).click();
  await page.locator('dialog textarea').fill(JSON.stringify({ rowFormatter: { elmType: 'div' } }));
  await page.getByRole('button', { name: 'Open card' }).click();
  await expect(page.locator('.lt-dialog-error')).toContainText('list-row layout');
});
