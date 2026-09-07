// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MatrixClient } from 'matrix-js-sdk'
import { MatrixClientService } from '../../src/matrix/MatrixClientService'

const originalUserAgent = navigator.userAgent

describe('device verification status', () => {
  afterEach(() => {
    delete window.__TAURI_INTERNALS__
    Object.defineProperty(navigator, 'userAgent', {
      configurable: true,
      value: originalUserAgent,
    })
    vi.restoreAllMocks()
  })
  it('does not present local self-trust as cross-device verification', async () => {
    const status = {
      isVerified: () => true,
      crossSigningVerified: false,
      signedByOwner: false,
      localVerified: true,
    }
    const client = {
      getSafeUserId: () => '@me:example.org',
      getDeviceId: () => 'DESKTOP',
      getDevices: async () => ({
        devices: [{ device_id: 'DESKTOP', display_name: 'FoxChat desktop' }],
      }),
      getCrypto: () => ({
        getUserDeviceInfo: async () => new Map([['@me:example.org', new Map([['DESKTOP', {}]])]]),
        getDeviceVerificationStatus: async () => status,
        isCrossSigningReady: async () => false,
      }),
    } as unknown as MatrixClient
    const service = new MatrixClientService()
    ;(service as unknown as { client: MatrixClient }).client = client

    const [device] = await service.getDeviceSessions()

    expect(status.isVerified()).toBe(true)
    expect(device).toMatchObject({
      current: true,
      verified: false,
      crossSigned: false,
      signedByOwner: false,
      locallyVerified: true,
    })
  })

  it('repairs a locally trusted current device when its self-signing key is available', async () => {
    const status = {
      crossSigningVerified: false,
      signedByOwner: false,
      localVerified: true,
    }
    const crossSignDevice = vi.fn(async () => {
      status.crossSigningVerified = true
      status.signedByOwner = true
    })
    const getUserDeviceInfo = vi.fn(
      async () => new Map([['@me:example.org', new Map([['DESKTOP', {}]])]]),
    )
    const client = {
      getSafeUserId: () => '@me:example.org',
      getDeviceId: () => 'DESKTOP',
      getDevices: async () => ({
        devices: [{ device_id: 'DESKTOP', display_name: 'FoxChat desktop' }],
      }),
      getCrypto: () => ({
        getUserDeviceInfo,
        getDeviceVerificationStatus: async () => status,
        isCrossSigningReady: async () => true,
        crossSignDevice,
      }),
    } as unknown as MatrixClient
    const service = new MatrixClientService()
    ;(service as unknown as { client: MatrixClient }).client = client

    const [device] = await service.getDeviceSessions()

    expect(crossSignDevice).toHaveBeenCalledWith('DESKTOP')
    expect(getUserDeviceInfo).toHaveBeenCalledTimes(2)
    expect(device).toMatchObject({
      current: true,
      verified: true,
      crossSigned: true,
      signedByOwner: true,
      locallyVerified: true,
    })
  })

  it('never asks the Android WebView observer for the device list', async () => {
    Object.defineProperty(navigator, 'userAgent', {
      configurable: true,
      value: 'Mozilla/5.0 (Linux; Android 16) AppleWebKit/537.36',
    })
    const invoke = vi.fn().mockResolvedValue({
      devices: [
        {
          deviceId: 'ANDROID',
          displayName: 'FoxChat Android',
          current: true,
          verified: false,
          crossSigned: false,
          signedByOwner: false,
          locallyVerified: false,
        },
      ],
    })
    window.__TAURI_INTERNALS__ = { invoke: invoke as never }
    const getDevices = vi.fn(() => {
      throw new Error('The observer client must not own Android device management')
    })
    const service = new MatrixClientService()
    ;(service as unknown as { client: MatrixClient }).client = {
      getSafeUserId: () => '@me:example.org',
      getDevices,
    } as unknown as MatrixClient

    await expect(service.getDeviceSessions()).resolves.toMatchObject([
      { deviceId: 'ANDROID', current: true },
    ])
    expect(getDevices).not.toHaveBeenCalled()
    expect(invoke).toHaveBeenCalledWith('plugin:remote-push|native_matrix', {
      action: 'deviceSessions',
      payload: JSON.stringify({ userId: '@me:example.org' }),
    })
  })
})
