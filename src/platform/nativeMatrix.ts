import { EventType, MatrixEventEvent, type MatrixClient, type MatrixEvent } from 'matrix-js-sdk'

type TauriInvoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>

export type NativeMatrixAccountStatus = {
  userId: string
  state: 'legacy' | 'staged' | 'adopting' | 'validating' | 'ready' | 'error'
  deviceId?: string
  error?: string | null
  migrationVersion?: number
  retryAvailable?: boolean
  startedAt?: number
  completedAt?: number
  runtimeActive?: boolean
  syncState?: 'idle' | 'running' | 'terminated' | 'error' | 'offline' | null
  watchedRooms?: number
}

export type NativeMatrixStatus = {
  available: boolean
  owner: 'matrix-rust-sdk'
  accounts: NativeMatrixAccountStatus[]
}

export type NativeDecryptedEvent = {
  ok: true
  userId: string
  roomId: string
  eventId: string
  senderId: string
  senderName: string
  roomName: string
  body: string
  rawEvent: string
}

declare global {
  interface Window {
    __TAURI_INTERNALS__?: { invoke: TauriInvoke }
  }
}

export function isAndroidNativeMatrix() {
  return !!window.__TAURI_INTERNALS__?.invoke && /Android/i.test(navigator.userAgent)
}

export function isRetryableAndroidVerifierError(error: string | null | undefined) {
  return (
    !!error &&
    (/InvalidCertificate\s*\(\s*Revoked\s*\)/i.test(error) || /EventFilteredOut/i.test(error))
  )
}

export function isAndroidMigrationRetryAvailable(
  account: Pick<NativeMatrixAccountStatus, 'state' | 'error' | 'retryAvailable'>,
) {
  if (account.state !== 'error') return false
  // Older Android bridges do not expose retryAvailable. Keep the narrow error classifier as a
  // compatibility fallback; new bridges version-gate retries in durable native storage.
  return account.retryAvailable ?? isRetryableAndroidVerifierError(account.error)
}

async function command<T>(action: string, payload: Record<string, unknown> = {}) {
  const invoke = window.__TAURI_INTERNALS__?.invoke
  if (!invoke) throw new Error('Native Matrix is only available in the Android app')
  try {
    return await invoke<T>('plugin:remote-push|native_matrix', {
      action,
      payload: JSON.stringify(payload),
    })
  } catch (error) {
    if (error instanceof Error) throw error
    if (typeof error === 'string' && error.trim()) throw new Error(error.trim())
    if (error && typeof error === 'object' && 'message' in error) {
      const message = String((error as { message?: unknown }).message ?? '').trim()
      if (message) throw new Error(message)
    }
    throw new Error(`Native Matrix ${action} failed`)
  }
}

export async function nativeMatrixStatus(): Promise<NativeMatrixStatus | undefined> {
  if (!isAndroidNativeMatrix()) return undefined
  return command<NativeMatrixStatus>('status')
}

export async function nativeMatrixReady(userId: string) {
  const status = await nativeMatrixStatus()
  return status?.accounts.some((account) => account.userId === userId && account.state === 'ready')
}

export function nativeMatrixLogin(homeserver: string, username: string, password: string) {
  return command<{
    baseUrl: string
    accessToken: string
    refreshToken?: string
    userId: string
    deviceId: string
  }>('login', { homeserver, username, password })
}

export async function adoptExistingAndroidMatrixDevice(
  client: MatrixClient,
  secretsBundle: unknown,
  backupInfo: unknown,
  validation: { roomId: string; eventId: string },
) {
  const userId = client.getUserId()
  const deviceId = client.getDeviceId()
  const accessToken = client.getAccessToken()
  if (!userId || !deviceId || !accessToken) throw new Error('The Matrix session is incomplete')
  return command<{ ok: true; state: 'ready'; userId: string; deviceId: string }>(
    'adoptExistingDevice',
    {
      userId,
      deviceId,
      homeserver: client.getHomeserverUrl(),
      accessToken,
      refreshToken: client.getRefreshToken() ?? undefined,
      secretsBundle: JSON.stringify(secretsBundle),
      backupInfo: JSON.stringify(backupInfo),
      validationRoomId: validation.roomId,
      validationEventId: validation.eventId,
    },
  )
}

export function adoptFreshAndroidMatrixSession(session: {
  baseUrl: string
  accessToken: string
  refreshToken?: string
  userId: string
  deviceId: string
}) {
  return command<{ ok: true; state: 'ready'; userId: string; deviceId: string }>(
    'adoptFreshSession',
    {
      homeserver: session.baseUrl,
      accessToken: session.accessToken,
      refreshToken: session.refreshToken,
      userId: session.userId,
      deviceId: session.deviceId,
    },
  )
}

export async function decryptEventWithNativeMatrix(event: MatrixEvent) {
  if (event.getWireType() !== EventType.RoomMessageEncrypted) return false
  const roomId = event.getRoomId()
  const eventId = event.getId()
  if (!roomId || !eventId) return false
  const result = await command<NativeDecryptedEvent>('decryptEvent', { roomId, eventId })
  const raw = JSON.parse(result.rawEvent) as {
    type?: string
    content?: Record<string, unknown>
    state_key?: string
    unsigned?: Record<string, unknown>
  }
  if (!raw.type || !raw.content)
    throw new Error(`Native Matrix returned no clear event for ${eventId}`)
  const mutable = event as unknown as {
    setClearData(value: {
      clearEvent: {
        room_id?: string
        type: string
        state_key?: string
        content: Record<string, unknown>
        unsigned?: Record<string, unknown>
      }
    }): void
  }
  mutable.setClearData({
    clearEvent: {
      room_id: roomId,
      type: raw.type,
      state_key: raw.state_key,
      content: raw.content,
      unsigned: raw.unsigned,
    },
  })
  event.emit(MatrixEventEvent.Decrypted, event)
  return true
}

export function nativeSendRoomEvent(
  userId: string,
  roomId: string,
  eventType: string,
  content: Record<string, unknown>,
) {
  return command<{ ok: true }>('sendRaw', { userId, roomId, eventType, content })
}

export function nativeSendStateEvent(
  userId: string,
  roomId: string,
  eventType: string,
  content: Record<string, unknown>,
  stateKey = '',
) {
  return command<{ ok: true; eventId: string }>('sendStateRaw', {
    userId,
    roomId,
    eventType,
    stateKey,
    content,
  })
}

export function nativeRedactEvent(
  userId: string,
  roomId: string,
  eventId: string,
  reason?: string,
) {
  return command<{ ok: true }>('redact', { userId, roomId, eventId, reason })
}

export function nativeSetTyping(userId: string, roomId: string, typing: boolean) {
  return command<{ ok: true }>('setTyping', { userId, roomId, typing })
}

export function nativeMarkRead(userId: string, roomId: string) {
  return command<{ ok: true }>('markRead', { userId, roomId })
}

export function nativeLogout(userId: string) {
  return command<{ ok: true }>('logout', { userId })
}

export function nativeRecover(userId: string, recoveryKey: string) {
  return command<{ ok: true; background: true }>('recover', { userId, recoveryKey })
}

export function nativeWatchRoom(userId: string, roomId: string) {
  return command<{ ok: true; alreadyWatching?: boolean }>('watchRoom', { userId, roomId })
}

export function installNativeMatrixTransport(client: MatrixClient, userId: string) {
  client.sendEvent = (async (roomId: string, ...args: unknown[]) => {
    const hasThreadArgument = typeof args[1] === 'string'
    const offset = hasThreadArgument ? 1 : 0
    const eventType = args[offset] as string
    const originalContent = args[offset + 1] as Record<string, unknown>
    const threadId = hasThreadArgument ? String(args[0]) : undefined
    const content = threadId
      ? {
          ...originalContent,
          'm.relates_to': originalContent['m.relates_to'] ?? {
            rel_type: 'm.thread',
            event_id: threadId,
            is_falling_back: true,
            'm.in_reply_to': { event_id: threadId },
          },
        }
      : originalContent
    await nativeSendRoomEvent(userId, roomId, eventType, content)
    return { event_id: `$native-pending-${crypto.randomUUID()}` }
  }) as typeof client.sendEvent

  client.sendStateEvent = (async (
    roomId: string,
    eventType: string,
    content: Record<string, unknown>,
    stateKey = '',
  ) => {
    const result = await nativeSendStateEvent(userId, roomId, eventType, content, stateKey)
    return { event_id: result.eventId }
  }) as typeof client.sendStateEvent

  client.redactEvent = (async (roomId: string, ...args: unknown[]) => {
    const hasThreadArgument = args[0] === null
    const eventId = String(args[hasThreadArgument ? 1 : 0])
    const options = args[hasThreadArgument ? 3 : 2] as { reason?: string } | undefined
    await nativeRedactEvent(userId, roomId, eventId, options?.reason)
    return { event_id: `$native-redaction-${crypto.randomUUID()}` }
  }) as typeof client.redactEvent

  client.sendTyping = (async (roomId: string, typing: boolean) => {
    await nativeSetTyping(userId, roomId, typing)
    return {}
  }) as typeof client.sendTyping

  client.setRoomReadMarkers = (async (roomId: string) => {
    await nativeMarkRead(userId, roomId)
    return {}
  }) as typeof client.setRoomReadMarkers

  client.logout = (async () => {
    await nativeLogout(userId)
    return {}
  }) as typeof client.logout
}
