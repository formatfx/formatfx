/**
 * Shared mechanics for the browser UI specs — navigation and chrome-opening
 * only. The assertions (the actual contracts) stay in each spec file; nothing
 * in here should ever encode an expectation about app behavior.
 */
import type { Locator, Page } from '@playwright/test';

/**
 * A fresh app for one test: land on '/', wipe the autosaved project, reload.
 * Pass acceptDialogs where the flow under test raises confirms (e.g. applying
 * name-less JSON over a named design asks first).
 */
export async function freshApp(page: Page, opts: { acceptDialogs?: boolean } = {}): Promise<void> {
  if (opts.acceptDialogs) page.on('dialog', (d) => { void d.accept(); });
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
}

/** A grid column header, located by its label. */
export function header(page: Page, label: string): Locator {
  return page.locator('.wb-grid-header', { has: page.locator('.wb-grid-header-label', { hasText: label }) });
}

// The JSON pane (the "Advanced" escape hatch) is hidden by default — reveal it
// idempotently. The left edit pane and canvas are always visible.
export async function openJson(page: Page): Promise<void> {
  if (!(await page.locator('#wb-pane-side').isVisible())) await page.click('#wb-json-toggle');
}

// The full palette is a popover off the draw toolbar. Items live in
// #wb-palette-pop .wb-palette-item; clicking one inserts AND closes the popover.
export async function openPalette(page: Page): Promise<void> {
  await page.click('.wb-tool[data-tool="palette"]');
}

// the example/sample loader lives in the ☰ menu — open it, then pick
export async function loadExample(page: Page, value: string): Promise<void> {
  await page.click('#wb-menu-btn');
  await page.selectOption('#wb-example', value);
}

/** The Data editor is a dock below the preview; reveal it (it starts collapsed). */
export async function openDataDock(page: Page): Promise<void> {
  const dock = page.locator('#wb-data-dock');
  if (await dock.evaluate((el) => el.classList.contains('wb-min'))) {
    await page.click('#wb-data-min');
  }
}

/**
 * Run text through the schema-import form (Data dock → Import schema… →
 * paste → Import pasted text). Specs build their own schema/CSV payloads —
 * what a given payload should produce is the spec's contract, not ours.
 */
export async function importPastedText(page: Page, text: string): Promise<void> {
  await openDataDock(page);
  await page.click('button:has-text("Import schema…")');
  await page.fill('.wb-schema-form textarea', text);
  await page.click('button:has-text("Import pasted text")');
}
