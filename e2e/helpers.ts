/**
 * Shared mechanics for the browser UI specs — navigation and chrome-opening
 * only. The assertions (the actual contracts) stay in each spec file; nothing
 * in here should ever encode an expectation about app behavior.
 */
import { expect, type Locator, type Page } from '@playwright/test';

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

/** A canvas tab in the strip above the canvas, located by its visible name
 *  ('Grid', a view name, or a component name). */
export function canvasTab(page: Page, name: string): Locator {
  return page.locator('#wb-canvastabs .wb-canvastab', {
    has: page.locator('.wb-canvastab-name', { hasText: name }),
  });
}

/** Click the standing ▦ Grid tab (a no-op when the grid is already up). */
export async function openGridTab(page: Page): Promise<void> {
  await page.locator('#wb-canvastabs .wb-canvastab-grid .wb-canvastab-btn').click();
}

/** Ctrl-click grid headers into a multi-selection and graduate them into a
 *  row view via the areas bar — the shared on-ramp several specs walk. */
export async function makeRowView(page: Page, labels: string[]): Promise<void> {
  for (const l of labels) await header(page, l).click({ modifiers: ['Control'] });
  await page.locator('.wb-areas-bar button', { hasText: 'Make a row view' }).click();
}

// The JSON pane (the escape hatch behind the topbar JSON button) is hidden by
// default — reveal it idempotently. The left edit pane and canvas stay visible.
export async function openJson(page: Page): Promise<void> {
  if (!(await page.locator('#wb-pane-side').isVisible())) await page.click('#wb-json-toggle');
}

// The pane's head kebab (⋮ beside the JSON ⇄ Explain tabs) carries everything
// but Apply: copy/download/deploy, output options, the surface Type select.
// Idempotent — a blind click would toggle an already-open panel closed.
export async function openJsonKebab(page: Page): Promise<void> {
  await openJson(page);
  if (!(await page.locator('#wb-json-kebab-panel').isVisible())) await page.click('#wb-json-kebab');
}

// The full palette now lives in the kebab (⋮) menu: open it, click "More
// elements", and the popover (.wb-palette-pop) opens. Its items are
// .wb-palette-item; clicking one inserts AND closes the popover.
export async function openPalette(page: Page): Promise<void> {
  await page.click('#wb-kebab-btn');
  await page.click('.wb-snapmenu .wb-kebab-item[data-tool="palette"]');
}

// The app-level Undo control moved into the kebab (⋮) menu. Open it, assert the
// Undo item is disabled (the app undo stack is empty), then close it again.
export async function expectAppUndoDisabled(page: Page): Promise<void> {
  await page.click('#wb-kebab-btn');
  await expect(page.locator('.wb-snapmenu .wb-tool-undo')).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(page.locator('.wb-snapmenu')).toHaveCount(0);
}

// the example/sample loader lives in the ☰ menu behind More… (#257) — open
// the menu, expand the drawer, then pick
export async function loadExample(page: Page, value: string): Promise<void> {
  await page.click('#wb-menu-btn');
  await page.click('#wb-menu-more');
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
