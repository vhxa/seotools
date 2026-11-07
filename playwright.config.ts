import { defineConfig, devices } from '@playwright/test'
import { BASE_URL } from './e2e/support/env'

/**
 * Smoke tests against the production build, on a throwaway SQLite database (see
 * `e2e/support/start.ts`). The specs depend on each other in file order: the first creates the
 * administrator, so they run one at a time.
 */
export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: { baseURL: BASE_URL, trace: 'retain-on-failure', locale: 'en-US' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'pnpm exec tsx e2e/support/start.ts',
    url: `${BASE_URL}/api/health`,
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: 'pipe',
  },
})
