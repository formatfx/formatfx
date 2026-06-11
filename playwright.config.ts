import { defineConfig } from '@playwright/test';

/**
 * Visual/E2E tests. Uses the browser already installed on your machine
 * (Edge by default — no download, so corporate proxies can't block setup).
 * Override with PW_CHANNEL=chrome if you don't have Edge.
 *
 *   npm run test:ui            # run headless, screenshots in test-results/
 *   npm run test:ui -- --ui    # interactive runner
 */
const channel = process.env.PW_CHANNEL ?? 'msedge';

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  use: {
    // PW_CHANNEL=bundled uses Playwright's own chromium (CI runners);
    // default is the locally installed Edge so corporate machines need no download
    ...(channel === 'bundled' ? {} : { channel }),
    viewport: { width: 1440, height: 900 },
    screenshot: 'on',
  },
  webServer: {
    command: 'npm run dev',
    port: 5173,
    reuseExistingServer: true,
  },
  reporter: [['list'], ['html', { open: 'never' }]],
});
