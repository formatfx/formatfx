/**
 * E2E: schema import flow (native "Export to CSV with schema") and
 * columnFormatterReference rendering from the registry.
 */
import { test, expect, type Page } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    localStorage.clear();
    // most specs exercise the full surface — run them in advanced mode
    localStorage.setItem('wb-ui-prefs', JSON.stringify({ mode: 'advanced' }));
  });
  await page.reload();
});

async function openTab(page: Page, tab: 'inspector' | 'json' | 'data'): Promise<void> {
  await page.click(`.wb-tabs button[data-tab="${tab}"]`);
}

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
  await openTab(page, 'data');
  await page.click('button:has-text("Import schema…")');
  await page.fill('.wb-schema-form textarea', listSchemaCsv());
  await page.click('button:has-text("Import pasted text")');
}

test('native CSV-with-schema import: fields, real rows, formatters registered', async ({ page }) => {
  await importExport(page);
  await expect(page.locator('#wb-toast')).toContainText('Imported 3 fields');
  await expect(page.locator('#wb-toast')).toContainText('2 rows');
  await expect(page.locator('#wb-toast')).toContainText('1 live column formatters');
  // data grid shows the imported internal names
  await expect(page.locator('.wb-data-fieldname', { hasText: 'Phase' })).toBeVisible();
  // registry section lists the recovered formatter
  await expect(page.locator('.wb-schema-form', { hasText: 'Column formatter references' }))
    .toContainText('[$Pct]');
});

test('columnFormatterReference renders the registered formatter with swapped @currentField', async ({ page }) => {
  await importExport(page);
  await openTab(page, 'json');
  await page.fill('#wb-json-text', JSON.stringify({
    elmType: 'div',
    columnFormatterReference: '[$Pct]',
  }));
  await page.click('#wb-json-apply');
  // the referenced formatter shows the Pct value (75%), not a placeholder chip
  const firstCell = page.locator('.wb-mock-row:not(.wb-mock-header) .wb-mock-cell-fmt').first();
  await expect(firstCell).toContainText('75%');
  await expect(firstCell.locator('.wb-cfr-chip')).toHaveCount(0);
});

test('unregistered CFR shows the explanatory chip', async ({ page }) => {
  await openTab(page, 'json');
  await page.fill('#wb-json-text', JSON.stringify({
    elmType: 'div',
    columnFormatterReference: '[$NotRegistered]',
  }));
  await page.click('#wb-json-apply');
  const chip = page.locator('.wb-mock-row:not(.wb-mock-header) .wb-cfr-chip').first();
  await expect(chip).toBeVisible();
  await expect(chip).toContainText('NotRegistered');
});
