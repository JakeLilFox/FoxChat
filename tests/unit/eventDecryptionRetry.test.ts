// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest'
import type { MatrixClient, MatrixEvent } from 'matrix-js-sdk'
import { MatrixClientService } from '../../src/matrix/MatrixClientService'
import { fakeEvent, fakeRoom } from './support/fakeMatrix'

describe('event decryption retry', () => {
  it('refreshes key backup on the event-owning account before retrying decryption', async () => {
    let failed = true
    const event = fakeEvent({
      id: '$missing-session',
      roomId: '!encrypted:example.org',
      sender: '@sender:example.org',
    })
    const checkKeyBackupAndEnable = vi.fn(async () => undefined)
    const attemptDecryption = vi.fn(async () => {
      failed = false
    })
    Object.assign(event, {
      isDecryptionFailure: () => failed,
      attemptDecryption,
    })
    const room = fakeRoom({ roomId: '!encrypted:example.org', events: [event] })
    const cryptoBackend = {}
    const client = {
      cryptoBackend,
      getRoom: (roomId: string) => (roomId === room.roomId ? room : undefined),
      getRooms: () => [room],
      getUserId: () => '@me:example.org',
      getCrypto: () => ({ checkKeyBackupAndEnable }),
    } as unknown as MatrixClient
    const service = new MatrixClientService()
    ;(service as unknown as { client: MatrixClient }).client = client

    await expect(service.retryEventDecryption(event as MatrixEvent)).resolves.toBe(true)

    expect(checkKeyBackupAndEnable).toHaveBeenCalledOnce()
    expect(attemptDecryption).toHaveBeenCalledWith(cryptoBackend, { isRetry: true })
    expect(checkKeyBackupAndEnable.mock.invocationCallOrder[0]).toBeLessThan(
      attemptDecryption.mock.invocationCallOrder[0],
    )
  })
})
