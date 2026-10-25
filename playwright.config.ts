import { defineConfig, devices } from '@playwright/test'

const API_PORT = 8798
const WEB_PORT = 5199

export default defineConfig({
  testDir: 'e2e',
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: [['list']],
  use: { baseURL: `http://localhost:${WEB_PORT}`, trace: 'retain-on-failure' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
  webServer: [
    {
      // Fresh DB each run; OTP codes land in the log so tests can read them.
      command: `rm -rf e2e/.tmp && mkdir -p e2e/.tmp && DB_PATH=e2e/.tmp/test.db PORT=${API_PORT} DISABLE_RATE_LIMIT=1 npx tsx server/index.ts 2>&1 | tee e2e/.tmp/api.log`,
      url: `http://localhost:${API_PORT}/api/products`,
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: `API_URL=http://localhost:${API_PORT} npx vite --port ${WEB_PORT} --strictPort`,
      url: `http://localhost:${WEB_PORT}`,
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
})
