import { defineConfig, devices } from '@playwright/test'
import { config as loadEnv } from 'dotenv'
import { existsSync } from 'node:fs'
import { availableParallelism } from 'node:os'
import { resolve } from 'node:path'
import { matrixE2EAccountPool, recommendedMatrixWorkerCount } from './tests/e2e/support/env'

const envFile = resolve('test.env')
if (existsSync(envFile)) loadEnv({ path: envFile, override: false, quiet: true })

const baseURL = process.env.E2E_BASE_URL || 'http://127.0.0.1:4173'
const devServerPort = new URL(baseURL).port || '4173'
const timeout = Number(process.env.E2E_TIMEOUT_MS) || 90_000
const matrixPool = matrixE2EAccountPool()
const cpuParallelism = availableParallelism()
const requestedMatrixWorkers = Number(process.env.MATRIX_E2E_WORKERS) || 1
const matrixWorkers = recommendedMatrixWorkerCount(
  matrixPool.workerCapacity,
  cpuParallelism,
  requestedMatrixWorkers,
)
if (process.env.MATRIX_E2E_ENABLED?.toLowerCase() === 'true') {
  console.log(
    `[matrix-e2e] Detected ${matrixPool.uniqueAccounts}/${matrixPool.configuredAccounts} distinct complete accounts (${matrixPool.workerCapacity} four-account groups); using ${matrixWorkers} worker(s) for ${cpuParallelism} available CPU(s).`,
  )
  if (matrixPool.duplicateAccountNumbers.length) {
    console.warn(
      `[matrix-e2e] Ignoring duplicate account slot(s): ${matrixPool.duplicateAccountNumbers.join(', ')}`,
    )
  }
}

export default defineConfig({
  testDir: './tests/e2e',
  outputDir: 'test-results',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: Math.max(4, matrixWorkers),
  timeout,
  expect: { timeout: Math.min(timeout, 20_000) },
  reporter: process.env.CI
    ? [['list'], ['html', { open: 'never' }]]
    : [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL,
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
  },
  webServer:
    process.env.E2E_SKIP_WEBSERVER === 'true'
      ? undefined
      : {
          command: `npm run dev -- --host 127.0.0.1 --port ${devServerPort}`,
          url: baseURL,
          reuseExistingServer: !process.env.CI,
          timeout: 120_000,
        },
  projects: [
    {
      name: 'desktop',
      testIgnore: /live-matrix.*\.spec\.ts/,
      workers: 4,
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
      },
    },
    {
      name: 'mobile',
      testMatch: /public-ui\.spec\.ts/,
      workers: 4,
      use: {
        ...devices['Pixel 7'],
      },
    },
    {
      name: 'matrix-live',
      testMatch: /live-matrix.*\.spec\.ts/,
      workers: matrixWorkers,
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
        trace: 'off',
        video: 'off',
        screenshot: 'off',
      },
    },
  ],
})
