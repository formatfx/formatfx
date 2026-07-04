import { defineConfig } from '@playwright/test';

/**
 * Config for the visual-compare harness ONLY. Specs here end in .vspec.ts,
 * which the main playwright.config.ts never matches — this suite exists
 * solely behind `npm run visual:auth` / `npm run visual:compare` and must
 * never run in CI (it needs a real, interactively-authenticated tenant).
 *
 * Browser selection mirrors the main config (installed Edge by default,
 * PW_CHANNEL / PW_EXECUTABLE overrides for other machines and containers).
 */
const channel = process.env.PW_CHANNEL ?? 'msedge';

export default defineConfig({
  testDir: '.',
  testMatch: '**/*.vspec.ts',
  outputDir: './artifacts',
  timeout: 60_000,
  workers: 1, // the SP side mutates one shared list — never in parallel
  use: {
    ...(process.env.PW_EXECUTABLE
      ? { launchOptions: { executablePath: process.env.PW_EXECUTABLE, args: ['--no-sandbox'] } }
      : channel === 'bundled' ? {} : { channel }),
    viewport: { width: 1440, height: 900 },
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'npm run dev',
    port: 5173,
    reuseExistingServer: true,
  },
  reporter: [['list'], ['html', { outputFolder: './report', open: 'never' }]],
});
