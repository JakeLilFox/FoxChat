import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { liveMatrixConfig } from '../../tests/e2e/support/env'

const keys = [
  'MATRIX_E2E_ENABLED',
  'MATRIX_E2E_ALLOW_ROOM_MUTATION',
  'MATRIX_E2E_ALLOW_DEVICE_RESET',
  'MATRIX_E2E_ACCOUNT_1_HOMESERVER',
  'MATRIX_E2E_ACCOUNT_1_USER',
  'MATRIX_E2E_ACCOUNT_1_PASSWORD',
  'MATRIX_E2E_ACCOUNT_2_HOMESERVER',
  'MATRIX_E2E_ACCOUNT_2_USER',
  'MATRIX_E2E_ACCOUNT_2_PASSWORD',
  'MATRIX_E2E_ACCOUNT_3_HOMESERVER',
  'MATRIX_E2E_ACCOUNT_3_USER',
  'MATRIX_E2E_ACCOUNT_3_PASSWORD',
] as const

const original = new Map<string, string | undefined>()

describe('live Matrix environment safety', () => {
  beforeEach(() => {
    for (const key of keys) {
      original.set(key, process.env[key])
      delete process.env[key]
    }
    process.env.MATRIX_E2E_ENABLED = 'true'
    process.env.MATRIX_E2E_ALLOW_ROOM_MUTATION = 'true'
    for (const number of [1, 2, 3]) {
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

  it('enables the three-account journey only after every safety switch', () => {
    process.env.MATRIX_E2E_ALLOW_DEVICE_RESET = 'true'

    expect(liveMatrixConfig()).toMatchObject({
      enabled: true,
    })
  })
})
