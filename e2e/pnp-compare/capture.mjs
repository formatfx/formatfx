/**
 * e2e/pnp-compare/capture.mjs — load each built workspace share URL in the
 * running app and screenshot what the renderer painted.
 *
 * Column fixtures screenshot the grid (headers + all mock rows); view
 * fixtures screenshot the row/tile canvas stage. Fixtures flagged hoverCard
 * also click the card trigger and capture the flyout. Console errors and the
 * app's runtime render issues are collected per sample into capture-log.json.
 *
 * Usage: node e2e/pnp-compare/capture.mjs <outDir> — expects a dev server on
 * the URLs already baked into <outDir>/workspaces.json and Playwright's
 * chromium (PLAYWRIGHT_BROWSERS_PATH honored).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const outDir = process.argv[2] ?? path.join(DIR, 'out');
const rendersDir = path.join(outDir, 'renders');
const workspaces = JSON.parse(fs.readFileSync(path.join(outDir, 'workspaces.json'), 'utf8'));
fs.mkdirSync(rendersDir, { recursive: true });

// PW_EXECUTABLE: explicit chromium binary for environments whose installed
// browser build doesn't match the pinned @playwright/test revision.
const browser = await chromium.launch(
  process.env.PW_EXECUTABLE ? { executablePath: process.env.PW_EXECUTABLE } : {},
);

// CDN-blocked container support: serve the npm-vendored fabric.min.css for
// the app's CDN <link> (ms-fontSize-*/ms-fontWeight-* utilities), abort the
// rest of that host fast, and inject locally-generated ms-Icon glyph CSS
// (gen-icon-css.mjs) so iconName comparisons are meaningful offline.
const fabricCss = process.env.FABRIC_CSS && fs.existsSync(process.env.FABRIC_CSS)
  ? fs.readFileSync(process.env.FABRIC_CSS, 'utf8') : null;
const iconsCss = fs.existsSync(path.join(outDir, 'icons.css'))
  ? fs.readFileSync(path.join(outDir, 'icons.css'), 'utf8') : null;
const log = [];
for (const ws of workspaces) {
  if (!ws.url) { log.push({ id: ws.id, skipped: ws.error }); continue; }
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 960 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const consoleErrors = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 300)); });
  page.on('pageerror', (e) => consoleErrors.push(String(e).slice(0, 300)));
  try {
    await page.route('**://res-1.cdn.office.net/**', (route) => {
      if (fabricCss && route.request().url().endsWith('fabric.min.css')) {
        return route.fulfill({ contentType: 'text/css', body: fabricCss });
      }
      return route.abort();
    });
    await page.goto(ws.url, { waitUntil: 'domcontentloaded' });
    if (iconsCss) await page.addStyleTag({ content: iconsCss });
    const target = ws.kind === 'column' ? '.wb-grid' : (ws.kind === 'tile' ? '.wb-mock-tile' : '.wb-mock-viewrow');
    // 'attached', not 'visible': offline image failures can legitimately
    // collapse a row to zero height, which Playwright counts as hidden.
    await page.waitForSelector(target, { state: 'attached', timeout: 15_000 });
    await page.waitForTimeout(1200); // icons/fonts/images settle
    await page.evaluate(() => document.querySelector('.wb-share-banner')?.remove());

    const shotTarget = ws.kind === 'column' ? page.locator('.wb-grid') : page.locator('.wb-canvas-stage');
    await shotTarget.screenshot({ path: path.join(rendersDir, `${ws.id}.png`) });

    if (ws.hoverCard) {
      // force: the editor's selection chrome can cover the card trigger
      await page.locator('.wb-has-card').first().click({ force: true });
      await page.waitForTimeout(400);
      const fly = page.locator('.wb-flyout');
      if (await fly.isVisible().catch(() => false)) {
        await page.waitForTimeout(300);
        await fly.screenshot({ path: path.join(rendersDir, `${ws.id}-card.png`) });
      } else {
        consoleErrors.push('hover card: flyout did not open');
      }
    }
    log.push({ id: ws.id, ok: true, consoleErrors });
    console.log(`✓ ${ws.id}${consoleErrors.length ? ` (${consoleErrors.length} console errors)` : ''}`);
  } catch (e) {
    log.push({ id: ws.id, ok: false, error: String(e.message ?? e).slice(0, 300), consoleErrors });
    console.error(`✗ ${ws.id}: ${String(e.message ?? e).split('\n')[0]}`);
  } finally {
    await ctx.close();
  }
}
await browser.close();
fs.writeFileSync(path.join(outDir, 'capture-log.json'), JSON.stringify(log, null, 2));
console.log(`\nrenders → ${rendersDir}`);
