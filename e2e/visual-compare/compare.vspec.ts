/**
 * The comparison run, workspace-driven end to end:
 *
 *   1. Sandbox test — loads the workspace (SP_SHARE_URL if set, else it
 *      mints a share link from the app's default workspace), renders the
 *      grid, and captures every formatted column's cells: DOM probes
 *      (text + painted background) AND pixel crops of the painted element.
 *   2. SharePoint test — decodes the SAME share link in Node with the app's
 *      own codec, provisions the sacrificial list from it (columns, rows,
 *      column formatters, plus the view formatter on a second view), then
 *      captures the same cells on the real list and judges via verdict.ts:
 *      exact text, lenient color, pixel-diff triptychs (sandbox|SP|diff)
 *      attached per cell. The view-formatter view is captured as whole-row
 *      triptychs for human review (not scored in v1).
 *
 * The two tests run serially in one worker and hand off through artifacts/;
 * run them together (npm run visual:compare), not with -g filters. Without
 * SP_SITE_URL + a bottled session the SharePoint half skips and the sandbox
 * half still runs — the harness stays testable anywhere.
 * Report: npx playwright show-report e2e/visual-compare/report
 */
import { test, expect, type Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { freshApp } from '../helpers';
import { SP_SITE_URL, SP_LIST, SP_SHARE_URL, STATE_PATH, hasAuthState } from './config';
import { decodeShareUrl, planProvision, type WorkspaceFixture } from './workspace';
import { provisionList } from './sp';
import { probeCell, paintedElement, type CellProbe } from './probes';
import { diffCrops } from './imageDiff';
import { verdict, type CellComparison } from './verdict';
import { findInteractions, type InteractionPoint } from './interactions';
import type { LabeledNote } from './labels';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const CAPTURE_DIR = path.join(DIR, 'artifacts', 'sandbox-capture');
const CAPTURE_FILE = path.join(CAPTURE_DIR, 'capture.json');
/** Stable, predictable paths so a reviewing agent can Read the evidence
 *  directly (.claude/skills/visual-compare) without parsing the HTML report. */
const RUN_DIR = path.join(DIR, 'artifacts', 'run');

interface Capture {
  shareUrl: string;
  /** field internal name → per-row probes; crops live at <field>-<row>.png */
  columns: Record<string, CellProbe[]>;
  rowCount: number;
  /** Interactive features found in the workspace — each MUST be driven. */
  interactions: InteractionPoint[];
  /** hover-card probe per field ('null' = the card never opened in the sandbox). */
  hoverCards: Record<string, CellProbe | null>;
}

test.describe.configure({ mode: 'serial' });

/** The grid column index for a field by header label, or null when unplaced. */
async function gridColumnIndex(page: Page, label: string): Promise<number | null> {
  const headers = await page.locator('.wb-grid-header-label').allTextContents();
  const i = headers.indexOf(label);
  return i < 0 ? null : i;
}

test('sandbox side: render the workspace and capture every formatted column', async ({ page }, testInfo) => {
  let shareUrl = SP_SHARE_URL;
  if (!shareUrl) {
    // no workspace given — mint a link from the default workspace, so the
    // no-env smoke run exercises the share codec too
    await freshApp(page);
    await page.click('#wb-share');
    const input = page.locator('#wb-share-url');
    await expect(input).not.toHaveValue('', { timeout: 10_000 });
    shareUrl = await input.inputValue();
    await page.keyboard.press('Escape');
  }

  const ws = await decodeShareUrl(shareUrl);
  test.skip(ws.doc.kind !== 'grid',
    `The workspace's main document is a ${ws.doc.kind} view — v1 scores formatted grid columns only (the view formatter still deploys for human review).`);

  // render the workspace from its own share fragment on the local dev server
  await page.goto('/#' + new URL(shareUrl).hash.slice(1));
  await expect(page.locator('.wb-grid')).toBeVisible();

  const plan = planProvision(ws);
  const capture: Capture = { shareUrl, columns: {}, rowCount: plan.items.length, interactions: findInteractions(ws), hoverCards: {} };
  fs.rmSync(CAPTURE_DIR, { recursive: true, force: true });
  fs.mkdirSync(CAPTURE_DIR, { recursive: true });

  const colIndex: Record<string, number> = {};
  for (const { name } of plan.columnFormatters) {
    const field = ws.fields.find((f) => f.name === name);
    const col = await gridColumnIndex(page, field?.displayName ?? name);
    if (col === null) {
      // registered but not placed on this grid — nothing rendered to compare
      testInfo.annotations.push({ type: 'capture', description: `skipped ${name}: formatted but not placed on the grid` });
      continue;
    }
    colIndex[name] = col;
    const probes: CellProbe[] = [];
    for (let row = 0; row < capture.rowCount; row++) {
      const cell = page.locator('.wb-grid-row').nth(row).locator('.wb-grid-cell').nth(col);
      probes.push(await probeCell(cell));
      const painted = await paintedElement(cell);
      await painted.screenshot({ path: path.join(CAPTURE_DIR, `${name}-${row}.png`) });
    }
    capture.columns[name] = probes;
  }

  // interactive features: DRIVE each one and capture the effect (row 0).
  // View-formatter interactions (field '') are covered by the SP side's
  // whole-row evidence in v1 — the sandbox grid can't isolate them per cell.
  for (const it of capture.interactions) {
    if (!it.field || colIndex[it.field] === undefined) continue;
    const cell = page.locator('.wb-grid-row').first().locator('.wb-grid-cell').nth(colIndex[it.field]);
    if (it.kind === 'hoverCard') {
      // the sandbox's flyout emulation opens on click regardless of openOnEvent
      await cell.locator('.wb-has-card').first().click();
      const fly = page.locator('.wb-flyout');
      if (await fly.isVisible().catch(() => false)) {
        capture.hoverCards[it.field] = await probeCell(fly);
        await fly.screenshot({ path: path.join(CAPTURE_DIR, `${it.field}-hovercard.png`) });
      } else {
        capture.hoverCards[it.field] = null;
      }
      await page.mouse.click(5, 5); // dismiss before the next interaction
    } else {
      // rowAction / inlineEdit: the sandbox stubs actions — capture the
      // clicked state as evidence for the reviewing agent, unscored
      const target = cell.locator('button').first();
      if (await target.count()) {
        await target.click();
        await cell.screenshot({ path: path.join(CAPTURE_DIR, `${it.field}-${it.kind}-clicked.png`) });
        await page.keyboard.press('Escape');
      }
    }
  }
  fs.writeFileSync(CAPTURE_FILE, JSON.stringify(capture, null, 2));

  expect(Object.keys(capture.columns).length, 'workspace has no formatted columns to compare').toBeGreaterThan(0);
  await testInfo.attach('sandbox-grid', {
    body: await page.locator('.wb-grid').screenshot(), contentType: 'image/png',
  });
});

test('sharepoint side: provision the workspace on a real list and compare', async ({ browser }, testInfo) => {
  test.skip(!SP_SITE_URL, 'Set SP_SITE_URL to compare against a real tenant.');
  test.skip(!hasAuthState(), 'No bottled session — run `npm run visual:auth` first.');
  test.skip(!fs.existsSync(CAPTURE_FILE),
    'No sandbox capture from this run — run the full visual:compare (the sandbox test writes it), not a -g filter.');

  const capture: Capture = JSON.parse(fs.readFileSync(CAPTURE_FILE, 'utf8'));
  const ws: WorkspaceFixture = await decodeShareUrl(capture.shareUrl);
  const plan = planProvision(ws);

  fs.rmSync(RUN_DIR, { recursive: true, force: true });
  fs.mkdirSync(RUN_DIR, { recursive: true });

  const ctx = await browser.newContext({
    storageState: STATE_PATH, viewport: { width: 1440, height: 900 },
  });
  try {
    const page = await ctx.newPage();
    // REST calls ride the page's own cookies, so park on the site first
    await page.goto(SP_SITE_URL);
    const provisioned = await provisionList(page, SP_SITE_URL, SP_LIST, plan);
    for (const note of provisioned.notes) testInfo.annotations.push({ type: 'provision', description: note });

    // ── Phase A (scored): column formatters on the native default view ──
    await page.goto(new URL(provisioned.defaultViewUrl, SP_SITE_URL).href);
    // ⚠ first-live-run watch spot #2: modern-list DOM selectors. Rows carry
    // data-automationid="DetailsRow"; each cell's data-automation-key starts
    // with the field's internal name. If these drift, fix them here only.
    const rows = page.locator('[data-automationid="DetailsRow"]');
    await expect(rows).toHaveCount(capture.rowCount, { timeout: 30_000 });

    const comparisons: CellComparison[] = [];
    for (const [name, sandboxProbes] of Object.entries(capture.columns)) {
      for (let row = 0; row < capture.rowCount; row++) {
        const cell = rows.nth(row).locator(`[data-automation-key^="${name}"]`);
        const spProbe = await probeCell(cell);
        const spCrop = await (await paintedElement(cell)).screenshot();
        const sandboxCrop = fs.readFileSync(path.join(CAPTURE_DIR, `${name}-${row}.png`));
        const diff = diffCrops(sandboxCrop, spCrop);
        fs.writeFileSync(path.join(RUN_DIR, `${name}-${row}.png`), diff.triptych);
        await testInfo.attach(`${name}[${row}] sandbox|SP|diff`, { body: diff.triptych, contentType: 'image/png' });
        comparisons.push({
          label: `${name}[${row}]`, sandbox: sandboxProbes[row], sharepoint: spProbe,
          pixel: { mismatchRatio: diff.mismatchRatio, widthDelta: diff.widthDelta, heightDelta: diff.heightDelta },
        });
      }
    }

    // ── Phase C (scored for hover cards, evidence for clicks): drive every
    // interactive feature on the REAL list. Hover/click is not optional —
    // customCardProps, customRowAction and inlineEditField only exist when
    // driven (owner requirement).
    const extraNotes: LabeledNote[] = [];
    for (const it of capture.interactions) {
      if (!it.field || !capture.columns[it.field]) continue; // view-formatter interactions: Phase B evidence
      const cell = rows.first().locator(`[data-automation-key^="${it.field}"]`);
      if (it.kind === 'hoverCard') {
        const target = await paintedElement(cell);
        if (it.openOn === 'hover') await target.hover(); else await target.click();
        // ⚠ first-live-run watch spot #4: SP hover cards render into a Fluent
        // callout layer at document level — adjust this selector if it drifts
        const card = page.locator('.ms-Callout').first();
        const opened = await card.waitFor({ state: 'visible', timeout: 10_000 }).then(() => true, () => false);
        const sandboxCard = capture.hoverCards[it.field] ?? null;
        if (opened && sandboxCard) {
          const spCrop = await card.screenshot();
          fs.writeFileSync(path.join(RUN_DIR, `${it.field}-hovercard-sp.png`), spCrop);
          const sandboxCrop = fs.readFileSync(path.join(CAPTURE_DIR, `${it.field}-hovercard.png`));
          const diff = diffCrops(sandboxCrop, spCrop);
          fs.writeFileSync(path.join(RUN_DIR, `${it.field}-hovercard.png`), diff.triptych);
          await testInfo.attach(`${it.field} hover card sandbox|SP|diff`, { body: diff.triptych, contentType: 'image/png' });
          comparisons.push({
            label: `${it.field}[hoverCard]`, sandbox: sandboxCard, sharepoint: await probeCell(card),
            pixel: { mismatchRatio: diff.mismatchRatio, widthDelta: diff.widthDelta, heightDelta: diff.heightDelta },
          });
        } else if (opened !== Boolean(sandboxCard)) {
          extraNotes.push({
            label: 'hover-card-missing',
            message: `${it.field}: the hover card opened on ${opened ? 'SharePoint only' : 'the sandbox only'}`,
          });
        }
        await page.keyboard.press('Escape');
      } else {
        // rowAction / inlineEdit: click and prove SOMETHING happened —
        // before/after screenshots that pixel-match exactly mean a dead button
        const target = cell.locator('button, [data-automation-key] a').first();
        if (!(await target.count())) {
          extraNotes.push({ label: 'click-no-effect', message: `${it.field} (${it.kind}): no clickable element found on SharePoint` });
          continue;
        }
        const before = await page.screenshot();
        await target.click();
        await page.waitForTimeout(1_500); // panels/editors animate in
        const after = await page.screenshot();
        fs.writeFileSync(path.join(RUN_DIR, `${it.field}-${it.kind}-clicked-sp.png`), after);
        await testInfo.attach(`${it.field} ${it.kind} after click (SP)`, { body: after, contentType: 'image/png' });
        if (diffCrops(before, after).mismatchRatio === 0) {
          extraNotes.push({ label: 'click-no-effect', message: `${it.field} (${it.kind}): clicking changed nothing on SharePoint` });
        }
        await page.keyboard.press('Escape');
        await page.keyboard.press('Escape'); // dismiss any panel/editor before the next drive
      }
    }

    // ── Phase B (human review): the view formatter on its own view ──
    await page.goto(new URL(provisioned.formatterViewUrl, SP_SITE_URL).href);
    const vfRows = page.locator('[data-automationid="DetailsRow"]');
    await expect(vfRows.first()).toBeVisible({ timeout: 30_000 });
    for (let row = 0; row < Math.min(capture.rowCount, await vfRows.count()); row++) {
      const shot = await vfRows.nth(row).screenshot();
      fs.writeFileSync(path.join(RUN_DIR, `view-row-${row}.png`), shot);
      await testInfo.attach(`view-formatter row ${row} (unscored)`, { body: shot, contentType: 'image/png' });
    }

    const v = verdict(comparisons);
    v.notes.push(...extraNotes);
    // a hover card that exists on one surface only is a real divergence
    if (extraNotes.some((n) => n.label === 'hover-card-missing')) v.pass = false;
    const verdictJson = JSON.stringify({ ...v, provisionNotes: provisioned.notes, comparisons }, null, 2);
    fs.writeFileSync(path.join(RUN_DIR, 'verdict.json'), verdictJson);
    await testInfo.attach('verdict', { body: verdictJson, contentType: 'application/json' });
    expect(v.pass, v.notes.map((n) => `[${n.label}] ${n.message}`).join('\n')).toBe(true);
  } finally {
    await ctx.close();
  }
});
