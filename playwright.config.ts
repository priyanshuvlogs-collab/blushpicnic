// End-to-end tests (Playwright + the preinstalled Chromium).
//   npx playwright test                       # everything in tests/e2e
//   npx playwright test tests/e2e/booking.spec.ts --project=mobile
// The web server builds the site into dist-e2e (so it never clobbers dist/) and serves it with PHP
// using the same router as production-like local testing (clean URLs + /api/*.php).
import { defineConfig } from '@playwright/test';

const PORT = 4455;

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  expect: { timeout: 7_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    browserName: 'chromium',
    locale: 'en-CA',
    timezoneId: 'America/Toronto',
    contextOptions: { reducedMotion: 'reduce' },
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'mobile',
      use: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
    },
    {
      name: 'desktop',
      use: { viewport: { width: 1440, height: 900 } },
    },
  ],
  webServer: {
    command:
      'OUT_DIR=dist-e2e CACHE_DIR=node_modules/.astro-e2e npx astro build && php -S 127.0.0.1:4455 -t dist-e2e tests/router.php',
    url: `http://127.0.0.1:${PORT}/book`,
    reuseExistingServer: !process.env.CI,
    timeout: 300_000,
    stdout: 'ignore',
    stderr: 'ignore',
  },
});
