// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { EventType, MatrixEvent, type MatrixClient, type Room } from 'matrix-js-sdk'
import { MatrixClientService } from '../../src/matrix/MatrixClientService'

describe('Android pinned event loading', () => {
  afterEach(() => {
    delete window.__TAURI_INTERNALS__
    vi.restoreAllMocks()
  })

  it('asks Rust to decrypt an encrypted pinned event already present in the room', async () => {
    Object.defineProperty(navigator, 'userAgent', {
      configurable: true,
      value: 'Mozilla/5.0 (Linux; Android 16) AppleWebKit/537.36',
    })
    const invoke = vi.fn().mockResolvedValue({
      ok: true,
      userId: '@me:example.org',
      roomId: '!room:example.org',
      eventId: '$old-pinned',
      senderId: '@alice:example.org',
      senderName: 'Alice',
      roomName: 'Room',
      body: 'Old pinned message',
      rawEvent: JSON.stringify({
        event_id: '$old-pinned',
        sender: '@alice:example.org',
        type: EventType.RoomMessage,
        content: { msgtype: 'm.text', body: 'Old pinned message' },
      }),
    })
    window.__TAURI_INTERNALS__ = { invoke: invoke as never }

    const pinned = new MatrixEvent({
      event_id: '$old-pinned',
      room_id: '!room:example.org',
      sender: '@alice:example.org',
      origin_server_ts: 1,
      type: EventType.RoomMessageEncrypted,
      content: { algorithm: 'm.megolm.v1.aes-sha2', ciphertext: 'encrypted' },
    })
    const room = { findEventById: vi.fn().mockReturnValue(pinned) } as unknown as Room
    const decryptEventIfNeeded = vi.fn()
    const client = {
      getRoom: vi.fn().mockReturnValue(room),
      getSafeUserId: vi.fn().mockReturnValue('@me:example.org'),
      fetchRoomEvent: vi.fn(),
      decryptEventIfNeeded,
    } as unknown as MatrixClient
    const service = new MatrixClientService()
    vi.spyOn(service, 'clientForRoom').mockReturnValue(client)

    await expect(service.loadReplyEvent('!room:example.org', '$old-pinned')).resolves.toBe(pinned)
    expect(pinned.getType()).toBe(EventType.RoomMessage)
    expect(pinned.getContent().body).toBe('Old pinned message')
    expect(client.fetchRoomEvent).not.toHaveBeenCalled()
    expect(decryptEventIfNeeded).not.toHaveBeenCalled()
    expect(invoke).toHaveBeenCalledWith('plugin:remote-push|native_matrix', {
      action: 'decryptEvent',
      payload: JSON.stringify({ roomId: '!room:example.org', eventId: '$old-pinned' }),
    })
  })
})
