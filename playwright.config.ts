import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;

// Builds the web app and runs the real server, then drives a main screen and
// phones in separate browser contexts (each has its own device token).
export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  reporter: process.env.CI ? 'github' : 'list',
  use: { baseURL: `http://localhost:${PORT}`, trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `npm run build -w @otrpg/web && npm start -w @otrpg/server`,
    env: { PORT: String(PORT), SEED: '5' },
    url: `http://localhost:${PORT}/healthz`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
