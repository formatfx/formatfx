/**
 * The comparison run: render a fixture in the sandbox, deploy the SAME JSON
 * to a real SharePoint list, probe what each surface painted, and let
 * verdict.ts judge. Screenshots of both surfaces attach to the HTML report
 * (npx playwright show-report e2e/visual-compare/report).
 *
 * The two tests run in order in one worker: the sandbox test writes its
 * probes to artifacts/, the SharePoint test reads them. Run them together
 * (npm run visual:compare), not with -g filters.
 *
 * Without SP_SITE_URL + a bottled session, the SharePoint half skips and
 * the sandbox half still runs — the harness stays testable anywhere.
 */
import { test, expect } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { freshApp, openJson } from '../helpers';
import { SP_SITE_URL, SP_LIST, STATE_PATH, ROWS, hasAuthState } from './config';
import { ensureList, applyColumnFormatter, spGet } from './sp';
import { probeCells, type CellProbe } from './probes';
import { verdict } from './verdict';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = fs.readFileSync(path.join(DIR, 'fixtures', 'status-pill.column.json'), 'utf8');
const PROBE_FILE = path.join(DIR, 'artifacts', 'sandbox-probes.json');

test.describe.configure({ mode: 'serial' });

test('sandbox side: render the fixture over the mock rows', async ({ page }, testInfo) => {
  await freshApp(page);
  // the COLUMN FORMATTERS tab opens the Status column formatter — the same
  // column the fixture drives, over mock rows with the same three statuses
  await page.locator('.wb-fmt-tab-cols').click();
  await expect(page.locator('.wb-doc-pill-name')).toHaveText('Status');
  await openJson(page);
  await page.fill('#wb-json-text', FIXTURE);
  await page.click('#wb-json-apply');

  const cells = page.locator('.wb-mock-row:not(.wb-mock-header) .wb-mock-cell-fmt');
  await expect(cells.first()).toContainText('In Progress');
  await expect(cells).toHaveCount(ROWS.length);

  const probes = await probeCells(
    Array.from({ length: ROWS.length }, (_, i) => cells.nth(i)));
  fs.mkdirSync(path.dirname(PROBE_FILE), { recursive: true });
  fs.writeFileSync(PROBE_FILE, JSON.stringify(probes, null, 2));

  await testInfo.attach('sandbox', {
    body: await page.locator('.wb-mock-list').screenshot(), contentType: 'image/png',
  });
});

test('sharepoint side: deploy the same JSON to a real list and compare', async ({ browser }, testInfo) => {
  test.skip(!SP_SITE_URL, 'Set SP_SITE_URL to compare against a real tenant.');
  test.skip(!hasAuthState(), 'No bottled session — run `npm run visual:auth` first.');
  test.skip(!fs.existsSync(PROBE_FILE),
    'No sandbox probes from this run — run the full visual:compare (the sandbox test writes them), not a -g filter.');

  const sandboxProbes: CellProbe[] = JSON.parse(fs.readFileSync(PROBE_FILE, 'utf8'));

  const ctx = await browser.newContext({
    storageState: STATE_PATH, viewport: { width: 1440, height: 900 },
  });
  try {
    const page = await ctx.newPage();
    // REST calls ride the page's own cookies, so park on the site first
    await page.goto(SP_SITE_URL);

    const listUrl = await ensureList(page, SP_SITE_URL, SP_LIST, ROWS);
    await applyColumnFormatter(page, SP_SITE_URL, listUrl, JSON.stringify(JSON.parse(FIXTURE)));

    const view = await spGet(page, `${listUrl}?$select=DefaultViewUrl`);
    const rel = view.body?.DefaultViewUrl;
    if (view.status >= 400 || typeof rel !== 'string') {
      throw new Error(`Could not read the list's DefaultViewUrl (HTTP ${view.status}) — session expired? Re-run visual:auth.`);
    }
    await page.goto(new URL(rel, SP_SITE_URL).href);

    // ⚠ first-live-run watch spot #2: modern-list DOM selectors. Rows carry
    // data-automationid="DetailsRow"; each cell's data-automation-key starts
    // with the field's internal name. If these drift, fix them here only.
    const rows = page.locator('[data-automationid="DetailsRow"]');
    await expect(rows).toHaveCount(ROWS.length, { timeout: 30_000 });
    const cells = Array.from({ length: ROWS.length },
      (_, i) => rows.nth(i).locator('[data-automation-key^="Status"]'));

    const spProbes = await probeCells(cells);
    await testInfo.attach('sharepoint', {
      body: await page.locator('[data-automationid="list"]').screenshot(), contentType: 'image/png',
    });

    const v = verdict(sandboxProbes, spProbes);
    await testInfo.attach('verdict', {
      body: JSON.stringify({ ...v, sandboxProbes, spProbes }, null, 2), contentType: 'application/json',
    });
    expect(v.pass, v.notes.join('\n')).toBe(true);
  } finally {
    await ctx.close();
  }
});
