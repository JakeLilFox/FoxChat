// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { EventType, MatrixEvent, MsgType, type MatrixClient } from 'matrix-js-sdk'
import {
  applyNativeVerificationSnapshot,
  adoptFreshAndroidMatrixSession,
  decryptEventWithNativeMatrix,
  installNativeMatrixTransport,
  isAndroidMigrationRetryAvailable,
  isRetryableAndroidVerifierError,
  nativeMatrixLogin,
  nativeDeviceSessions,
  nativeMatrixReady,
  nativeRequestVerification,
  nativeSecurityStatus,
  nativeSetupRecovery,
  nativeWatchRoom,
  type NativeDecryptedEvent,
} from '../../src/platform/nativeMatrix'
import { VerificationPhase } from 'matrix-js-sdk/lib/crypto-api'

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

  it('retries only known Android migration verifier defects', () => {
    expect(isRetryableAndroidVerifierError('InvalidCertificate(Revoked)')).toBe(true)
    expect(
      isRetryableAndroidVerifierError(
        'client creation failed: InvalidCertificate ( Revoked ) while discovering homeserver',
      ),
    ).toBe(true)
    expect(
      isRetryableAndroidVerifierError(
        'Native Matrix could not decrypt the cut-over event: NotificationStatus$EventFilteredOut',
      ),
    ).toBe(true)
    expect(isRetryableAndroidVerifierError('InvalidCertificate(Expired)')).toBe(false)
    expect(isRetryableAndroidVerifierError('M_UNKNOWN_TOKEN')).toBe(false)
  })

  it('honors the native transaction version gate before retrying a migration', () => {
    const oldFailure = {
      state: 'error' as const,
      error: 'NotificationStatus$EventFilteredOut',
    }
    expect(isAndroidMigrationRetryAvailable(oldFailure)).toBe(true)
    expect(isAndroidMigrationRetryAvailable({ ...oldFailure, retryAvailable: true })).toBe(true)
    expect(isAndroidMigrationRetryAvailable({ ...oldFailure, retryAvailable: false })).toBe(false)
    expect(
      isAndroidMigrationRetryAvailable({
        state: 'ready',
        error: 'NotificationStatus$EventFilteredOut',
        retryAvailable: true,
      }),
    ).toBe(false)
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

  it('returns the latest native room replay with the watch acknowledgement', async () => {
    const replay = {
      ok: true as const,
      alreadyWatching: true,
      initial: true as const,
      events: [{ eventId: '$latest', rawEvent: '{"type":"m.room.message"}' }],
    }
    const invoke = vi.fn().mockResolvedValue(replay)
    enableAndroid(invoke)

    await expect(nativeWatchRoom('@me:example.org', '!room:example.org')).resolves.toEqual(replay)
    expect(invoke).toHaveBeenCalledWith('plugin:remote-push|native_matrix', {
      action: 'watchRoom',
      payload: JSON.stringify({ userId: '@me:example.org', roomId: '!room:example.org' }),
    })
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

  it('keeps the complete SAS verification lifecycle in the native Rust runner', async () => {
    const base = {
      active: true,
      requestId: 'native-request',
      userId: '@me:example.org',
      initiatedByMe: true,
      otherUserId: '@me:example.org',
    }
    const invoke = vi.fn().mockImplementation(async (_command, args) => {
      switch (args.action) {
        case 'verificationRequest':
          return { ...base, phase: 'requested' }
        case 'verificationStartSas':
          return { ...base, phase: 'started' }
        case 'verificationApprove':
          return { ...base, phase: 'done' }
        default:
          throw new Error(`Unexpected action ${args.action}`)
      }
    })
    enableAndroid(invoke)

    const request = await nativeRequestVerification('@me:example.org')
    expect(request?.phase).toBe(VerificationPhase.Requested)
    const verifier = await request!.startVerification('m.sas.v1')
    expect(request?.phase).toBe(VerificationPhase.Started)

    applyNativeVerificationSnapshot({
      ...base,
      phase: 'started',
      emojis: [['🐶', 'Dog']],
    })
    const sas = verifier.getShowSasCallbacks()
    expect(sas?.sas.emoji).toEqual([['🐶', 'Dog']])
    await sas?.confirm()
    await expect(verifier.verify()).resolves.toBeUndefined()
    expect(request?.phase).toBe(VerificationPhase.Done)

    expect(invoke.mock.calls.map(([, args]) => args.action)).toEqual([
      'verificationRequest',
      'verificationStartSas',
      'verificationApprove',
    ])
  })

  it('times out a native verification bridge that never answers', async () => {
    vi.useFakeTimers()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const invoke = vi.fn().mockReturnValue(new Promise(() => undefined))
    enableAndroid(invoke)

    const request = nativeRequestVerification('@me:example.org')
    const rejection = expect(request).rejects.toThrow(
      'Native Matrix verification did not respond within 50 seconds',
    )
    await vi.advanceTimersByTimeAsync(50_000)

    await rejection
    expect(invoke.mock.calls.map(([, args]) => args.action)).toEqual([
      'verificationRequest',
      'logClientError',
    ])
    expect(JSON.parse(invoke.mock.calls[1][1].payload)).toMatchObject({
      context: 'native-matrix:verification-request-timeout',
      summary: 'Native Matrix verification did not respond within 50 seconds',
    })
    vi.useRealTimers()
  })

  it('routes recovery setup and security inspection to native Matrix', async () => {
    const invoke = vi
      .fn()
      .mockResolvedValueOnce({ recoveryKey: 'EsT1 recovery', version: 'native' })
      .mockResolvedValueOnce({ crossSigningReady: true })
    enableAndroid(invoke)

    await expect(nativeSetupRecovery('@me:example.org', 'secret')).resolves.toMatchObject({
      recoveryKey: 'EsT1 recovery',
    })
    await expect(nativeSecurityStatus('@me:example.org')).resolves.toMatchObject({
      crossSigningReady: true,
    })
    expect(invoke.mock.calls.map(([, args]) => args.action)).toEqual([
      'setupRecovery',
      'securityStatus',
    ])
  })

  it('loads the Android device inventory from the native Matrix owner', async () => {
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
        {
          deviceId: 'DESKTOP',
          displayName: 'FoxChat Desktop',
          current: false,
          verified: false,
          crossSigned: false,
          signedByOwner: false,
          locallyVerified: false,
        },
      ],
    })
    enableAndroid(invoke)

    await expect(nativeDeviceSessions('@me:example.org')).resolves.toHaveLength(2)
    expect(invoke).toHaveBeenCalledWith('plugin:remote-push|native_matrix', {
      action: 'deviceSessions',
      payload: JSON.stringify({ userId: '@me:example.org' }),
    })
  })

  it('does not let a room-history decryption burst block verification', async () => {
    const decryptResolvers: Array<(value: NativeDecryptedEvent) => void> = []
    const invoke = vi.fn().mockImplementation(async (_command, args) => {
      const action = args.action as string
      if (action === 'verificationRequest') {
        return {
          active: true,
          requestId: 'request',
          userId: '@me:example.org',
          initiatedByMe: true,
          otherUserId: '@me:example.org',
          phase: 'requested',
        }
      }
      if (action !== 'decryptEvent') throw new Error(`Unexpected action ${action}`)
      return new Promise<NativeDecryptedEvent>((resolve) => decryptResolvers.push(resolve))
    })
    enableAndroid(invoke)
    const events = Array.from(
      { length: 4 },
      (_, index) =>
        new MatrixEvent({
          event_id: `$event-${index}`,
          room_id: '!room:example.org',
          sender: '@alice:example.org',
          origin_server_ts: Date.now(),
          type: EventType.RoomMessageEncrypted,
          content: { algorithm: 'm.megolm.v1.aes-sha2', ciphertext: 'encrypted' },
        }),
    )

    const decryptions = events.map((event) => decryptEventWithNativeMatrix(event))
    await vi.waitFor(() => expect(decryptResolvers).toHaveLength(2))
    await expect(nativeRequestVerification('@me:example.org')).resolves.toBeDefined()
    expect(invoke.mock.calls.some(([, args]) => args.action === 'verificationRequest')).toBe(true)

    for (let index = 0; index < events.length; index += 1) {
      await vi.waitFor(() => expect(decryptResolvers.length).toBeGreaterThan(index))
      decryptResolvers[index]({
        ok: true,
        userId: '@me:example.org',
        roomId: '!room:example.org',
        eventId: `$event-${index}`,
        senderId: '@alice:example.org',
        senderName: 'Alice',
        roomName: 'Room',
        body: 'hello',
        rawEvent: JSON.stringify({
          type: EventType.RoomMessage,
          content: { msgtype: MsgType.Text, body: 'hello' },
        }),
      })
      await Promise.resolve()
    }
    await expect(Promise.all(decryptions)).resolves.toEqual([true, true, true, true])
  })

  it('moves an interactively requested old event ahead of queued background decryptions', async () => {
    const requested: string[] = []
    const resolvers = new Map<string, (value: NativeDecryptedEvent) => void>()
    const invoke = vi.fn().mockImplementation(async (_command, args) => {
      if (args.action !== 'decryptEvent') throw new Error(`Unexpected action ${args.action}`)
      const payload = JSON.parse(String(args.payload)) as { roomId: string; eventId: string }
      requested.push(payload.eventId)
      return new Promise<NativeDecryptedEvent>((resolve) => resolvers.set(payload.eventId, resolve))
    })
    enableAndroid(invoke)
    const event = (eventId: string) =>
      new MatrixEvent({
        event_id: eventId,
        room_id: '!room:example.org',
        sender: '@alice:example.org',
        origin_server_ts: Date.now(),
        type: EventType.RoomMessageEncrypted,
        content: { algorithm: 'm.megolm.v1.aes-sha2', ciphertext: 'encrypted' },
      })
    const complete = (eventId: string) =>
      resolvers.get(eventId)?.({
        ok: true,
        userId: '@me:example.org',
        roomId: '!room:example.org',
        eventId,
        senderId: '@alice:example.org',
        senderName: 'Alice',
        roomName: 'Room',
        body: eventId,
        rawEvent: JSON.stringify({
          type: EventType.RoomMessage,
          content: { msgtype: 'm.text', body: eventId },
        }),
      })

    const decryptions = [
      decryptEventWithNativeMatrix(event('$active-1')),
      decryptEventWithNativeMatrix(event('$active-2')),
      decryptEventWithNativeMatrix(event('$background')),
      decryptEventWithNativeMatrix(event('$pinned'), { priority: true }),
    ]
    await vi.waitFor(() => expect(requested).toEqual(['$active-1', '$active-2']))

    complete('$active-1')
    await vi.waitFor(() => expect(requested[2]).toBe('$pinned'))
    complete('$active-2')
    await vi.waitFor(() => expect(requested[3]).toBe('$background'))
    complete('$pinned')
    complete('$background')

    await expect(Promise.all(decryptions)).resolves.toEqual([true, true, true, true])
  })
})
