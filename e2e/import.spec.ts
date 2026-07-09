/**
 * E2E: schema import (native "Export to CSV with schema" + the List Snapshot)
 * — imported CustomFormatters register as column LOOKS (unstamped, rendered
 * embedded in the grid), the review opts individual formatters out, captured
 * views open as their own canvas tabs, and the deploy panel stays lint-gated.
 */
import { test, expect, type Page } from '@playwright/test';
import { freshApp, header, canvasTab, importPastedText, openDataDock, openJson } from './helpers';

test.beforeEach(async ({ page }) => { await freshApp(page, { acceptDialogs: true }); });

/** Minimal synthetic native export: schema header + CSV body. */
function listSchemaCsv(): string {
  const schema = {
    schemaXmlList: [
      '<Field Type="Text" Name="Title" DisplayName="Task name" ReadOnly="FALSE" />',
      '<Field Type="Choice" Name="Phase" DisplayName="Phase"><CHOICES><CHOICE>Plan</CHOICE><CHOICE>Build</CHOICE></CHOICES></Field>',
      '<Field Type="Number" Name="Pct" DisplayName="Pct" CustomFormatter="{&quot;elmType&quot;:&quot;div&quot;,&quot;txtContent&quot;:&quot;=@currentField+\'%\'&quot;}" />',
    ],
  };
  return `ListSchema=${JSON.stringify(schema)}\n` +
    '"Task name","Phase","Pct"\n' +
    '"Ship the sandbox","Build","75"\n' +
    '"Write the docs","Plan","20"\n';
}

async function importExport(page: Page): Promise<void> {
  await importPastedText(page, listSchemaCsv());
  // listSchemaCsv carries a column formatter (Pct) → confirm the opt-out review
  await page.click('#wb-fmt-review-import');
}

test('native CSV-with-schema import: fields, real rows, live formatters register as LOOKS', async ({ page }) => {
  await importExport(page);
  await expect(page.locator('#wb-toast')).toContainText('Imported 3 fields');
  await expect(page.locator('#wb-toast')).toContainText('2 rows');
  await expect(page.locator('#wb-toast')).toContainText('1 column look');
  // data grid shows the imported internal names
  await expect(page.locator('.wb-data-fieldname', { hasText: 'Phase' })).toBeVisible();
  // the untouched grid workspace rebuilds around the import: real headers
  // (display names), and the recovered look renders embedded immediately
  await expect(page.locator('.wb-grid-header-label')).toHaveText(['Task name', 'Phase', 'Pct']);
  await expect(page.locator('.wb-grid-row').first()).toContainText('75%');
  // an imported look is UNSTAMPED — no def backs it, so no ⬡ header mark; the
  // header menu offers the remove/lift doors, never silent editability
  await expect(header(page, 'Pct').locator('.wb-grid-look')).toHaveCount(0);
  await header(page, 'Pct').click();
  await expect(page.locator('.wb-grid-menu button', { hasText: 'Remove the look' })).toBeVisible();
  await expect(page.locator('.wb-grid-menu button', { hasText: 'Save as component…' })).toBeVisible();
  await expect(page.locator('.wb-grid-menu button', { hasText: 'Change the component…' })).toHaveCount(0);
});

test('import review opts a column formatter out: unchecked → column imports but no look registers', async ({ page }) => {
  await importPastedText(page, listSchemaCsv());
  // the review lists the one formatter-bearing column (Pct); uncheck it
  const review = page.locator('#wb-fmt-review');
  await expect(review).toContainText('[$Pct]');
  await review.locator('input[type="checkbox"]').uncheck();
  await page.click('#wb-fmt-review-import');
  // the column + data still import…
  await expect(page.locator('#wb-toast')).toContainText('Imported 3 fields');
  await expect(page.locator('.wb-data-fieldname', { hasText: 'Pct' })).toBeVisible();
  // …but no look registered: the cell shows the raw value and the header menu
  // offers the apply on-ramp instead of the look actions
  await expect(page.locator('#wb-toast')).not.toContainText('column look');
  await expect(page.locator('.wb-grid-row').first()).not.toContainText('75%');
  await header(page, 'Pct').click();
  await expect(page.locator('.wb-grid-menu button', { hasText: 'Remove the look' })).toHaveCount(0);
});

test('an imported look compiles back to real column-formatter JSON (@currentField round trip)', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await importExport(page);
  // the look store speaks explicit [$Pct]; the export compiles on demand
  await header(page, 'Pct').click();
  await page.locator('.wb-grid-menu button', { hasText: 'Copy column JSON' }).click();
  await expect(page.locator('#wb-toast')).toContainText('Pct formatter JSON copied');
  const parsed = JSON.parse(await page.evaluate(() => navigator.clipboard.readText()));
  expect(parsed.$schema).toContain('column-formatting');
  expect(JSON.stringify(parsed)).toContain('@currentField');
  expect(JSON.stringify(parsed)).not.toContain('[$Pct]');
});

/** Synthetic List Snapshot — what the live-extract snippet captures. */
function listSnapshot(opts: { defaultViewFormatter?: boolean } = {}): string {
  return JSON.stringify({
    formatfx: 'list-snapshot',
    version: 1,
    siteUrl: 'https://contoso.sharepoint.com/sites/team',
    list: 'Tasks',
    fields: [
      { internalName: 'Title', displayName: 'Task name', type: 'Text' },
      {
        internalName: 'Phase', type: 'Choice', choices: ['Plan', 'Build'],
        customFormatter: JSON.stringify({ elmType: 'div', txtContent: '@currentField' }),
      },
      { internalName: 'Pct', type: 'Number' },
    ],
    views: [
      {
        title: 'All Items', isDefault: true, viewFields: ['LinkTitle', 'Phase'],
        ...(opts.defaultViewFormatter ? {
          customFormatter: JSON.stringify({
            $schema: 'https://developer.microsoft.com/json-schemas/sp/v2/view-formatting.schema.json',
            rowFormatter: { elmType: 'div', _elmName: 'Imported row', txtContent: "='»'+[$Title]+'«'" },
          }),
        } : {}),
      },
      { title: 'Board', viewFields: ['Phase'] },
    ],
    rows: [
      { Title: 'Ship the bridge', Phase: 'Build', Pct: 75 },
      { Title: 'Write the docs', Phase: 'Plan', Pct: 20 },
    ],
  });
}

test('list snapshot import: fields + views land; the default view\'s row formatting opens as its own tab', async ({ page }) => {
  await openDataDock(page);
  await page.click('button:has-text("Import schema…")');
  // the live block advertises the zero-install path
  await expect(page.locator('.wb-live-extract')).toContainText('Live from SharePoint');
  await page.fill('.wb-schema-form textarea', listSnapshot({ defaultViewFormatter: true }));
  await page.click('button:has-text("Import pasted text")');
  await page.click('#wb-fmt-review-import'); // Phase carries a column formatter → confirm the review
  await expect(page.locator('#wb-toast')).toContainText('Imported 3 fields');
  await expect(page.locator('#wb-toast')).toContainText('2 views');
  await expect(page.locator('#wb-toast')).toContainText('"All Items" opened as its own view');
  // the captured view formatter opened as its OWN named view — a canvas tab
  await expect(page.locator('.wb-mock-viewrow').first()).toContainText('»Ship the bridge«');
  await expect(canvasTab(page, 'All Items')).toHaveClass(/active/);
  // …and the views section lists both captured views
  await expect(page.locator('.wb-schema-form', { hasText: 'Views from your list' })).toContainText('Board');
  // one undo removes the imported sheet again — back on the (rebuilt) grid
  await page.keyboard.press('Control+z');
  await expect(page.locator('.wb-grid')).toBeVisible();
});

test('list snapshot without a default-view formatter rebuilds the grid; the views section lists them', async ({ page }) => {
  await importPastedText(page, listSnapshot());
  await page.click('#wb-fmt-review-import'); // Phase carries a column formatter → confirm the review
  // grid rebuilt around the snapshot (display names as headers)
  await expect(page.locator('.wb-grid-header-label')).toHaveText(['Task name', 'Phase', 'Pct']);
  // no view had a formatter — the views section still lists them, without Open buttons
  const views = page.locator('.wb-schema-form', { hasText: 'Views from your list' });
  await expect(views).toContainText('All Items · default · no row formatting');
  await expect(views.locator('button', { hasText: 'Open as a view' })).toHaveCount(0);
});

test('deploy panel: lint-gated snippet generation from the JSON tab', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await openJson(page);
  await page.click('#wb-json-kebab'); // #257: Deploy lives in the deploy-row kebab
  await page.click('#wb-json-deploy');
  // grid/row documents deploy as VIEW formatting
  await expect(page.locator('#wb-deploy-target')).toContainText('view');
  await page.click('#wb-deploy-copy');
  await expect(page.locator('#wb-toast')).toContainText('Deploy snippet copied');
  const snippet = await page.evaluate(() => navigator.clipboard.readText());
  expect(snippet).toContain("getByTitle('All%20Items')");
  expect(snippet).toContain('X-HTTP-Method');
  expect(snippet).toContain('rowFormatter');

  // a document with a lint ERROR refuses to generate (refuse-and-teach)
  await page.fill('#wb-json-text', JSON.stringify({
    rowFormatter: { elmType: 'div', txtContent: '=not([$Title])' },
  }));
  await page.click('#wb-json-apply');
  await page.click('#wb-deploy-copy');
  await expect(page.locator('#wb-toast')).toContainText('Not deploying');
});
