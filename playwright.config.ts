import { defineConfig, devices } from '@playwright/test';

/** End-to-end tests against the built app (vite preview, the e2e build), with Supabase answered
 * in the browser (e2e/mock.ts). Chromium (the installed Chrome) and WebKit, each on a phone, an
 * iPad and a desktop. */
const sizes = {
  phone: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 },
  ipad: { viewport: { width: 820, height: 1180 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
  desktop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
};

export default defineConfig({
  testDir: 'e2e',
  timeout: 45_000,
  expect: { timeout: 8_000 },
  fullyParallel: true,
  workers: 4,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:4317',
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
    locale: 'en-GB',
    timezoneId: 'Africa/Lagos',
  },
  projects: [
    { name: 'chromium-desktop', use: { ...devices['Desktop Chrome'], channel: 'chrome', ...sizes.desktop } },
    { name: 'chromium-ipad', use: { ...devices['Desktop Chrome'], channel: 'chrome', ...sizes.ipad } },
    { name: 'chromium-phone', use: { ...devices['Desktop Chrome'], channel: 'chrome', ...sizes.phone } },
    { name: 'webkit-desktop', use: { ...devices['Desktop Safari'], ...sizes.desktop } },
    { name: 'webkit-ipad', use: { ...devices['iPad (gen 7)'], ...sizes.ipad } },
    { name: 'webkit-phone', use: { ...devices['iPhone 13'], ...sizes.phone } },
  ],
  webServer: {
    command: 'npx vite build --mode e2e && npx vite preview --mode e2e --outDir dist-e2e --port 4317 --strictPort',
    url: 'http://localhost:4317',
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
