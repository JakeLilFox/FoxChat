// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { MatrixClientService, type MatrixSession } from '../../src/matrix/MatrixClientService'

const originalUserAgent = navigator.userAgent

const session = (userId: string, deviceId: string): MatrixSession => ({
  baseUrl: 'https://matrix.example.org',
  accessToken: `token-${deviceId}`,
  refreshToken: `refresh-${deviceId}`,
  userId,
  deviceId,
})

describe('Android native Matrix migration retry', () => {
  afterEach(() => {
    delete window.__TAURI_INTERNALS__
    Object.defineProperty(navigator, 'userAgent', {
      configurable: true,
      value: originalUserAgent,
    })
    localStorage.clear()
    sessionStorage.clear()
    vi.restoreAllMocks()
  })

  it('activates the preserved failed account before reloading', () => {
    Object.defineProperty(navigator, 'userAgent', {
      configurable: true,
      value: 'Mozilla/5.0 (Linux; Android 16) AppleWebKit/537.36',
    })
    const invoke = vi.fn().mockResolvedValue(undefined)
    window.__TAURI_INTERNALS__ = { invoke: invoke as never }
    const first = session('@same:example.org', 'FIRST')
    const failed = session('@same:example.org', 'FAILED')
    localStorage.setItem('foxchat.matrix.accounts', JSON.stringify([first, failed]))
    localStorage.setItem(
      'foxchat.matrix.activeAccount',
      `${first.baseUrl}|${first.userId}|${first.deviceId}`,
    )
    const reload = vi.fn()

    new MatrixClientService().retryNativeMigration(failed.userId, failed.deviceId, reload)

    const failedAccountId = `${failed.baseUrl}|${failed.userId}|${failed.deviceId}`
    expect(localStorage.getItem('foxchat.matrix.activeAccount')).toBe(failedAccountId)
    expect(JSON.parse(localStorage.getItem('foxchat.matrix.session') ?? 'null')).toEqual(failed)
    expect(JSON.parse(sessionStorage.getItem('foxchat.matrix.session') ?? 'null')).toEqual(failed)
    expect(reload).toHaveBeenCalledOnce()
  })

  it('does not reload when the preserved WebView session is unavailable', () => {
    Object.defineProperty(navigator, 'userAgent', {
      configurable: true,
      value: 'Mozilla/5.0 (Linux; Android 16) AppleWebKit/537.36',
    })
    window.__TAURI_INTERNALS__ = { invoke: vi.fn().mockResolvedValue(undefined) as never }
    const reload = vi.fn()

    expect(() =>
      new MatrixClientService().retryNativeMigration('@missing:example.org', 'MISSING', reload),
    ).toThrow('@missing:example.org: The preserved WebView session is unavailable')
    expect(reload).not.toHaveBeenCalled()
  })

  it('remains unavailable outside the Android app', () => {
    const reload = vi.fn()

    expect(() =>
      new MatrixClientService().retryNativeMigration('@user:example.org', 'DEVICE', reload),
    ).toThrow('Native Matrix migration is Android-only')
    expect(reload).not.toHaveBeenCalled()
  })
})
