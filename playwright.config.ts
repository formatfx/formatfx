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

// PW_PORT: run against a private port when another dev server already owns
// 5173 — this machine runs concurrent sessions against one checkout (plus
// worktrees), and reuseExistingServer would otherwise attach the tests to
// whichever session's server got there first, silently testing THEIR code.
// --strictPort keeps vite from hopping ports and desyncing from webServer.port.
const port = Number(process.env.PW_PORT ?? 5173);

export default defineConfig({
  testDir: './e2e',
  // every test resets its own context (freshApp in e2e/helpers.ts), so tests
  // within a file can fan out across workers too, not just file-by-file
  fullyParallel: true,
  timeout: 30_000,
  use: {
    // PW_CHANNEL=bundled uses Playwright's own chromium (CI runners);
    // PW_EXECUTABLE points at any chromium binary (containers with no download);
    // --no-sandbox lets it launch as root in a container (harmless elsewhere).
    // default is the locally installed Edge so corporate machines need no download
    ...(process.env.PW_EXECUTABLE
      ? { launchOptions: { executablePath: process.env.PW_EXECUTABLE, args: ['--no-sandbox'] } }
      : channel === 'bundled' ? {} : { channel }),
    viewport: { width: 1440, height: 900 },
    screenshot: 'on',
  },
  webServer: {
    command: `npm run dev -- --port ${port} --strictPort`,
    port,
    reuseExistingServer: true,
  },
  reporter: [['list'], ['html', { open: 'never' }]],
});
