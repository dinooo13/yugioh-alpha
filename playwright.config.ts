import { defineConfig, devices } from '@playwright/test'
import { fileURLToPath } from 'node:url'

const PORT = Number(process.env.E2E_PORT) || 3300
const baseURL = `http://localhost:${PORT}`
const e2eDbFile = fileURLToPath(new URL('./e2e-data/e2e.db', import.meta.url))

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: 'list',
  use: {
    baseURL,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      // Chromium sends `Accept-Language: en-US` by default; pin German so the
      // German assertions don't depend on the browser once Accept-Language
      // detection is switched on (ADR 0014).
      use: { ...devices['Desktop Chrome'], locale: 'de-DE' },
    },
  ],
  webServer: {
    command: 'node .output/server/index.mjs',
    url: baseURL,
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      PORT: String(PORT),
      NUXT_DB_FILE_PATH: e2eDbFile,
      NUXT_BETTER_AUTH_SECRET: 'e2e-test-secret-not-for-production-use-only',
      NUXT_PUBLIC_BETTER_AUTH_URL: baseURL,
      NUXT_E2E_SEED_CATALOG: '1',
      NUXT_ASSISTANT_PROVIDER: 'fake',
    },
  },
})
