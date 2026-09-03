// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { EventType, MatrixEvent, MsgType, type MatrixClient } from 'matrix-js-sdk'
import {
  adoptFreshAndroidMatrixSession,
  decryptEventWithNativeMatrix,
  installNativeMatrixTransport,
  isRetryableAndroidVerifierError,
  nativeMatrixLogin,
  nativeMatrixReady,
} from '../../src/platform/nativeMatrix'

describe('Android native Matrix bridge', () => {
  afterEach(() => {
    delete window.__TAURI_INTERNALS__
    vi.restoreAllMocks()
  })

  const enableAndroid = (invoke: ReturnType<typeof vi.fn>) => {
    Object.defineProperty(navigator, 'userAgent', {
      configurable: true,
      value: 'Mozilla/5.0 (Linux; Android 16) AppleWebKit/537.36',
    })
    window.__TAURI_INTERNALS__ = { invoke: invoke as never }
  }

  it('only retries the known Android false-revocation migration failure', () => {
    expect(isRetryableAndroidVerifierError('InvalidCertificate(Revoked)')).toBe(true)
    expect(
      isRetryableAndroidVerifierError(
        'client creation failed: InvalidCertificate ( Revoked ) while discovering homeserver',
      ),
    ).toBe(true)
    expect(isRetryableAndroidVerifierError('InvalidCertificate(Expired)')).toBe(false)
    expect(isRetryableAndroidVerifierError('M_UNKNOWN_TOKEN')).toBe(false)
  })

  it('only enables observer mode for a transactionally ready account', async () => {
    const invoke = vi.fn().mockResolvedValue({
      available: true,
      owner: 'matrix-rust-sdk',
      accounts: [
        { userId: '@ready:example.org', state: 'ready' },
        { userId: '@partial:example.org', state: 'validating' },
      ],
    })
    enableAndroid(invoke)

    await expect(nativeMatrixReady('@ready:example.org')).resolves.toBe(true)
    await expect(nativeMatrixReady('@partial:example.org')).resolves.toBe(false)
  })

  it('hands a freshly registered Android device to Rust without creating another device', async () => {
    const invoke = vi.fn().mockResolvedValue({
      ok: true,
      state: 'ready',
      userId: '@new:example.org',
      deviceId: 'NEWDEVICE',
    })
    enableAndroid(invoke)

    await adoptFreshAndroidMatrixSession({
      baseUrl: 'https://example.org',
      accessToken: 'access',
      refreshToken: 'refresh',
      userId: '@new:example.org',
      deviceId: 'NEWDEVICE',
    })

    expect(invoke).toHaveBeenCalledWith('plugin:remote-push|native_matrix', {
      action: 'adoptFreshSession',
      payload: JSON.stringify({
        homeserver: 'https://example.org',
        accessToken: 'access',
        refreshToken: 'refresh',
        userId: '@new:example.org',
        deviceId: 'NEWDEVICE',
      }),
    })
  })

  it('preserves native login failure details returned as a Tauri rejection string', async () => {
    const invoke = vi
      .fn()
      .mockRejectedValue('Native Matrix login failed during password login: forbidden')
    enableAndroid(invoke)

    await expect(
      nativeMatrixLogin('https://example.org', '@me:example.org', 'wrong-password'),
    ).rejects.toThrow('Native Matrix login failed during password login: forbidden')
  })

  it('applies Rust-decrypted clear content to the existing timeline event', async () => {
    const invoke = vi.fn().mockResolvedValue({
      ok: true,
      userId: '@me:example.org',
      roomId: '!room:example.org',
      eventId: '$event',
      senderId: '@alice:example.org',
      senderName: 'Alice',
      roomName: 'Room',
      body: 'hello',
      rawEvent: JSON.stringify({
        type: EventType.RoomMessage,
        content: { msgtype: 'm.text', body: 'hello' },
      }),
    })
    enableAndroid(invoke)
    const event = new MatrixEvent({
      event_id: '$event',
      room_id: '!room:example.org',
      sender: '@alice:example.org',
      origin_server_ts: Date.now(),
      type: EventType.RoomMessageEncrypted,
      content: { algorithm: 'm.megolm.v1.aes-sha2', ciphertext: 'encrypted' },
      unsigned: {},
    })

    await expect(decryptEventWithNativeMatrix(event)).resolves.toBe(true)
    expect(event.getType()).toBe(EventType.RoomMessage)
    expect(event.getContent()).toMatchObject({ msgtype: 'm.text', body: 'hello' })
  })

  it('routes normal and threaded sends through Rust instead of JS encryption', async () => {
    const calls: Array<{ action: string; payload: Record<string, unknown> }> = []
    const invoke = vi
      .fn()
      .mockImplementation(async (_command: string, args?: Record<string, unknown>) => {
        const action = String(args?.action)
        const payload = JSON.parse(String(args?.payload)) as Record<string, unknown>
        calls.push({ action, payload })
        return { ok: true }
      })
    enableAndroid(invoke)
    const client = {
      sendEvent: vi.fn(),
      sendStateEvent: vi.fn(),
      redactEvent: vi.fn(),
      sendTyping: vi.fn(),
      setRoomReadMarkers: vi.fn(),
      logout: vi.fn(),
    } as unknown as MatrixClient
    installNativeMatrixTransport(client, '@me:example.org')

    await client.sendEvent('!room:example.org', EventType.RoomMessage, {
      msgtype: MsgType.Text,
      body: 'normal',
    })
    await client.sendEvent('!room:example.org', '$thread', EventType.RoomMessage, {
      msgtype: MsgType.Text,
      body: 'threaded',
    })

    expect(calls).toEqual([
      {
        action: 'sendRaw',
        payload: {
          userId: '@me:example.org',
          roomId: '!room:example.org',
          eventType: EventType.RoomMessage,
          content: { msgtype: 'm.text', body: 'normal' },
        },
      },
      {
        action: 'sendRaw',
        payload: {
          userId: '@me:example.org',
          roomId: '!room:example.org',
          eventType: EventType.RoomMessage,
          content: {
            msgtype: 'm.text',
            body: 'threaded',
            'm.relates_to': {
              rel_type: 'm.thread',
              event_id: '$thread',
              is_falling_back: true,
              'm.in_reply_to': { event_id: '$thread' },
            },
          },
        },
      },
    ])
  })
})
