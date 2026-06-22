import { defineConfig, devices } from '@playwright/test';

// Cross-browser matrix (docs/compatibility.md §8): Chromium + WebKit + Firefox + emulated iPhone.
// A required CI gate, not an optional smoke test. The dev server is auto-started for the run.
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
  },
  webServer: {
    command: 'npm run dev -- --port 5173 --strictPort',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
    // The game is landscape-only (a portrait viewport surfaces the rotate prompt), so the emulated
    // iPhone runs in landscape — otherwise the rotate overlay covers the canvas and blocks input.
    { name: 'mobile-webkit', use: { ...devices['iPhone 13 landscape'] } },
  ],
});
