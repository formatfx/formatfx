/**
 * One-time (per session expiry) auth bottling. Run headed:
 *
 *   SP_SITE_URL=https://tenant.sharepoint.com/sites/x npm run visual:auth
 *
 * You sign in by hand — MFA, conditional access, whatever your tenant wants.
 * The harness just waits until the site's own REST API answers as YOU, then
 * saves the browser storage state for later headless runs. This is the
 * app-registration-free auth path (docs/CONNECTIVITY.md §1) applied to
 * testing: the saved state IS a signed-in browser session, nothing more.
 */
import { test, expect } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { SP_SITE_URL, STATE_PATH } from './config';

test('sign in to SharePoint and bottle the session', async ({ page }) => {
  test.skip(!SP_SITE_URL, 'Set SP_SITE_URL to your SharePoint site to authenticate.');
  test.setTimeout(5 * 60_000); // human-speed: MFA prompts take as long as they take

  await page.goto(SP_SITE_URL);

  // Signed in = the site's REST API answers with the web title. Poll from
  // inside the page so the request rides the page's own cookies.
  await expect
    .poll(async () => page.evaluate(async (site) => {
      try {
        const r = await fetch(site + '/_api/web/title', {
          headers: { Accept: 'application/json;odata=nometadata' },
          credentials: 'same-origin',
        });
        return r.ok;
      } catch { return false; }
    }, SP_SITE_URL), { timeout: 5 * 60_000, intervals: [2_000] })
    .toBe(true);

  fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
  await page.context().storageState({ path: STATE_PATH });
  console.log(`Signed-in session saved to ${STATE_PATH} — you can run visual:compare now.`);
});
