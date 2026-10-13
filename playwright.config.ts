import { defineConfig } from '@playwright/test';

// Runs against the production build (vite preview) unless BASE_URL points somewhere else (e.g. the live site).
const BASE_URL = process.env.BASE_URL ?? 'http://localhost:4174/album-margarita/';

export default defineConfig({
  testDir: 'e2e',
  timeout: 180_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 2,
  reporter: [['list']],
  use: {
    baseURL: BASE_URL,
    channel: 'chrome',
    headless: true,
    trace: 'off',
  },
  webServer: process.env.BASE_URL
    ? undefined
    : { command: 'npm run preview', url: 'http://localhost:4174/album-margarita/', reuseExistingServer: true, timeout: 60_000 },
  projects: [
    { name: 'mobile', use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 } },
    { name: 'desktop', use: { viewport: { width: 1366, height: 850 } } },
  ],
});
