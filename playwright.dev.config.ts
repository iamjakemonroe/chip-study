// The journeys against the dev server, where React StrictMode sets every screen up twice: catches
// code that keeps hold of something a first setup made (npm run e2e:dev).
import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: 'e2e',
  testMatch: /app\.spec\.ts/,
  timeout: 60_000,
  reporter: [['list']],
  use: { baseURL: 'http://localhost:4318', trace: 'off' },
  projects: [{ name: 'chromium-desktop', use: { ...devices['Desktop Chrome'], channel: 'chrome', viewport: { width: 1440, height: 900 } } }],
  webServer: { command: 'npx vite --mode e2e --port 4318 --strictPort', port: 4318, reuseExistingServer: false, timeout: 60_000 },
});
