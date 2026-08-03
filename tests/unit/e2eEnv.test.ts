import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  liveMatrixConfig,
  matrixE2EAccountPool,
  recommendedMatrixWorkerCount,
} from '../../tests/e2e/support/env'

const keys = [
  'MATRIX_E2E_ENABLED',
  'MATRIX_E2E_ALLOW_ROOM_MUTATION',
  'MATRIX_E2E_ALLOW_DEVICE_RESET',
  'MATRIX_E2E_WORKERS',
  'TEST_PARALLEL_INDEX',
  'TEST_WORKER_INDEX',
  ...Array.from({ length: 12 }, (_, offset) => offset + 1).flatMap((number) =>
    ['HOMESERVER', 'USER', 'PASSWORD', 'RECOVERY_KEY'].map(
      (suffix) => `MATRIX_E2E_ACCOUNT_${number}_${suffix}`,
    ),
  ),
]

const original = new Map<string, string | undefined>()

describe('live Matrix environment safety', () => {
  beforeEach(() => {
    for (const key of keys) {
      original.set(key, process.env[key])
      delete process.env[key]
    }
    process.env.MATRIX_E2E_ENABLED = 'true'
    process.env.MATRIX_E2E_ALLOW_ROOM_MUTATION = 'true'
    for (const number of [1, 2, 3, 4]) {
      process.env[`MATRIX_E2E_ACCOUNT_${number}_HOMESERVER`] = 'https://matrix.org'
      process.env[`MATRIX_E2E_ACCOUNT_${number}_USER`] = `@foxchat-e2e-${number}:matrix.org`
      process.env[`MATRIX_E2E_ACCOUNT_${number}_PASSWORD`] = 'test-password'
    }
  })

  afterEach(() => {
    for (const key of keys) {
      const value = original.get(key)
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    original.clear()
  })

  it('refuses device deletion without the explicit reset switch', () => {
    expect(liveMatrixConfig()).toMatchObject({
      enabled: false,
      reason: 'MATRIX_E2E_ALLOW_DEVICE_RESET is not true',
    })
  })

  it('enables the live journey only after every safety switch', () => {
    process.env.MATRIX_E2E_ALLOW_DEVICE_RESET = 'true'

    expect(liveMatrixConfig()).toMatchObject({
      enabled: true,
    })
  })

  it('assigns a distinct four-account block to each Playwright worker', () => {
    process.env.MATRIX_E2E_ALLOW_DEVICE_RESET = 'true'
    for (const number of [5, 6, 7, 8]) {
      process.env[`MATRIX_E2E_ACCOUNT_${number}_HOMESERVER`] = 'https://matrix.org'
      process.env[`MATRIX_E2E_ACCOUNT_${number}_USER`] = `@foxchat-e2e-${number}:matrix.org`
      process.env[`MATRIX_E2E_ACCOUNT_${number}_PASSWORD`] = 'test-password'
    }

    process.env.TEST_PARALLEL_INDEX = '1'

    expect(matrixE2EAccountPool()).toMatchObject({
      configuredAccounts: 8,
      workerCapacity: 2,
      accountNumbers: [5, 6, 7, 8],
    })
    expect(liveMatrixConfig()).toMatchObject({
      enabled: true,
      accountNumbers: [5, 6, 7, 8],
      account1: { userId: '@foxchat-e2e-5:matrix.org' },
      account2: { userId: '@foxchat-e2e-6:matrix.org' },
      account3: { userId: '@foxchat-e2e-7:matrix.org' },
      account4: { userId: '@foxchat-e2e-8:matrix.org' },
    })
  })

  it('ignores an incomplete trailing group and wraps replacement workers safely', () => {
    process.env.MATRIX_E2E_ALLOW_DEVICE_RESET = 'true'
    for (const number of [5, 6]) {
      process.env[`MATRIX_E2E_ACCOUNT_${number}_HOMESERVER`] = 'https://matrix.org'
      process.env[`MATRIX_E2E_ACCOUNT_${number}_USER`] = `@foxchat-e2e-${number}:matrix.org`
      process.env[`MATRIX_E2E_ACCOUNT_${number}_PASSWORD`] = 'test-password'
    }
    process.env.TEST_PARALLEL_INDEX = '1'

    expect(matrixE2EAccountPool()).toMatchObject({
      configuredAccounts: 6,
      uniqueAccounts: 6,
      workerCapacity: 1,
      accountNumbers: [1, 2, 3, 4],
    })
  })

  it('deduplicates Matrix users before forming worker groups', () => {
    process.env.MATRIX_E2E_ALLOW_DEVICE_RESET = 'true'
    process.env.MATRIX_E2E_ACCOUNT_4_USER = process.env.MATRIX_E2E_ACCOUNT_3_USER
    process.env.MATRIX_E2E_ACCOUNT_5_HOMESERVER = 'https://matrix.org'
    process.env.MATRIX_E2E_ACCOUNT_5_USER = '@foxchat-e2e-5:matrix.org'
    process.env.MATRIX_E2E_ACCOUNT_5_PASSWORD = 'test-password'

    expect(matrixE2EAccountPool()).toMatchObject({
      configuredAccounts: 5,
      uniqueAccounts: 4,
      duplicateAccountNumbers: [4],
      workerCapacity: 1,
      accountNumbers: [1, 2, 3, 5],
    })
    expect(liveMatrixConfig()).toMatchObject({
      enabled: true,
      accountNumbers: [1, 2, 3, 5],
    })
  })

  it('uses the stable zero-based parallel index across replacement workers', () => {
    for (const number of [5, 6, 7, 8]) {
      process.env[`MATRIX_E2E_ACCOUNT_${number}_HOMESERVER`] = 'https://matrix.org'
      process.env[`MATRIX_E2E_ACCOUNT_${number}_USER`] = `@foxchat-e2e-${number}:matrix.org`
      process.env[`MATRIX_E2E_ACCOUNT_${number}_PASSWORD`] = 'test-password'
    }

    process.env.TEST_PARALLEL_INDEX = '0'
    process.env.TEST_WORKER_INDEX = '17'
    expect(matrixE2EAccountPool().accountNumbers).toEqual([1, 2, 3, 4])

    process.env.TEST_PARALLEL_INDEX = '1'
    process.env.TEST_WORKER_INDEX = '42'
    expect(matrixE2EAccountPool().accountNumbers).toEqual([5, 6, 7, 8])
  })

  it('defaults live Matrix concurrency to one and caps explicit opt-in by account and CPU budgets', () => {
    expect(recommendedMatrixWorkerCount(31, 32)).toBe(1)
    expect(recommendedMatrixWorkerCount(31, 32, 4)).toBe(4)
    expect(recommendedMatrixWorkerCount(31, 56, 8)).toBe(8)
    expect(recommendedMatrixWorkerCount(7, 56, 8)).toBe(7)
    expect(recommendedMatrixWorkerCount(31, 8, 8)).toBe(4)
    expect(recommendedMatrixWorkerCount(31, 4, 4)).toBe(2)
    expect(recommendedMatrixWorkerCount(2, 32, 4)).toBe(2)
    expect(recommendedMatrixWorkerCount(31, 1, 4)).toBe(1)
  })
})
