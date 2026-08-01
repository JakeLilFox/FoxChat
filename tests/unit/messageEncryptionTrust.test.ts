// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest'
import type { MatrixClient, MatrixEvent } from 'matrix-js-sdk'
import { EventShieldColour, EventShieldReason } from 'matrix-js-sdk/lib/crypto-api'
import { messageEncryptionTrustPresentation } from '../../src/lib/messageEncryptionTrust'
import { MatrixClientService } from '../../src/matrix/MatrixClientService'

const encryptedEvent = () =>
  ({
    getRoomId: () => undefined,
    getId: () => undefined,
    getSender: () => '@alice:example.org',
    getSenderKey: () => 'curve-key',
    isDecryptionFailure: () => false,
  }) as unknown as MatrixEvent

const serviceWithTrust = (crossSigningVerified: boolean) => {
  const getDeviceVerificationStatus = vi.fn(async () => ({
    crossSigningVerified,
    signedByOwner: true,
  }))
  const client = {
    getCrypto: () => ({
      getEncryptionInfoForEvent: async () => ({
        shieldColour: EventShieldColour.NONE,
        shieldReason: null,
      }),
      getUserDeviceInfo: async () =>
        new Map([
          [
            '@alice:example.org',
            new Map([
              [
                'ALICEPHONE',
                {
                  deviceId: 'ALICEPHONE',
                  displayName: "Alice's phone",
                  keys: new Map([['curve25519:ALICEPHONE', 'curve-key']]),
                },
              ],
            ]),
          ],
        ]),
      getDeviceVerificationStatus,
    }),
  } as unknown as MatrixClient
  const service = new MatrixClientService()
  ;(service as unknown as { client: MatrixClient }).client = client
  return { service, getDeviceVerificationStatus }
}

describe('message encryption trust', () => {
  it('distinguishes cross-signed devices from devices merely signed by an unverified owner', async () => {
    const trusted = serviceWithTrust(true)
    const untrusted = serviceWithTrust(false)

    await expect(trusted.service.messageEncryptionTrust(encryptedEvent())).resolves.toMatchObject({
      kind: 'verified',
      deviceId: 'ALICEPHONE',
    })
    await expect(untrusted.service.messageEncryptionTrust(encryptedEvent())).resolves.toMatchObject(
      {
        kind: 'unverified',
        signedByOwner: true,
      },
    )
  })

  it('uses readable colors and tooltip text for each trust level', () => {
    expect(
      messageEncryptionTrustPresentation({
        kind: 'verified',
        deviceId: 'ALICEPHONE',
        deviceName: "Alice's phone",
      }),
    ).toEqual({
      color: '#35c978',
      tooltip: "Encrypted · verified device: Alice's phone (ALICEPHONE)",
    })
    expect(
      messageEncryptionTrustPresentation({
        kind: 'warning',
        warningLevel: 'high',
        reason: EventShieldReason.VERIFICATION_VIOLATION,
      }),
    ).toEqual({
      color: '#ff4d4f',
      tooltip: "Encrypted · warning: the sender's previously verified identity changed",
    })
  })
})
