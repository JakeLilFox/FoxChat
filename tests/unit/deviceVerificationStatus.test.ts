// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest'
import type { MatrixClient } from 'matrix-js-sdk'
import { MatrixClientService } from '../../src/matrix/MatrixClientService'

describe('device verification status', () => {
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
})
