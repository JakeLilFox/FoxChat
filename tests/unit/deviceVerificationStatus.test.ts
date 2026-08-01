// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'
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
})
