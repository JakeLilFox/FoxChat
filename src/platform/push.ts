import { EventType, RoomType, type MatrixClient, type MatrixEvent } from 'matrix-js-sdk'
import { timelineAppearanceSettings } from '../lib/constants'

type TauriInvoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>

declare global {
  interface Window {
    __TAURI_INTERNALS__?: { invoke: TauriInvoke }
  }
}

const APP_ID = 'foxchat.jakefox.de'
const GATEWAY_URL = 'https://push.jakefox.de'.replace(/\/$/, '')
const CLEAR_TOKEN_KEY = 'foxchat.push.clearToken'
let currentPushkey: string | undefined
const registrationInFlight = new WeakMap<MatrixClient, Promise<void>>()
const registrationRetries = new WeakMap<MatrixClient, number>()
const registrationTimers = new WeakMap<MatrixClient, number>()
const cryptoSyncTimers = new WeakMap<MatrixClient, number>()
const cryptoSyncInFlight = new WeakMap<MatrixClient, Promise<void>>()
const cryptoSyncQueued = new WeakSet<MatrixClient>()
const lastCryptoSync = new WeakMap<MatrixClient, number>()
const cryptoSyncRetries = new WeakMap<MatrixClient, number>()
const syncedRoomSessions = new WeakMap<MatrixClient, Set<string>>()
const nativeCryptoValidated = new WeakSet<MatrixClient>()
const CRYPTO_SYNC_INTERVAL_MS = 5 * 60_000
const NATIVE_CRYPTO_SETUP_TIMEOUT_MS = 150_000

type NativeCryptoStatus = {
  accounts: Array<{
    userId: string
    setupState?: string
    setupError?: string | null
  }>
}

export type NativeCryptoTestResult = {
  ok: boolean
  roomId: string
  eventId: string
  senderId: string
  body: string
}

const delay = (milliseconds: number) =>
  new Promise((resolve) => window.setTimeout(resolve, milliseconds))

export function scheduleNativeCryptoSync(client: MatrixClient, delay = 2_000, force = false) {
  if (!isAndroidNative()) return
  if (
    !force &&
    delay > 0 &&
    Date.now() - (lastCryptoSync.get(client) ?? 0) < CRYPTO_SYNC_INTERVAL_MS
  )
    return
  const previous = cryptoSyncTimers.get(client)
  if (previous !== undefined) window.clearTimeout(previous)
  cryptoSyncTimers.set(
    client,
    window.setTimeout(() => {
      cryptoSyncTimers.delete(client)
      void runNativeCryptoSync(client)
    }, delay),
  )
}

async function runNativeCryptoSync(client: MatrixClient) {
  const active = cryptoSyncInFlight.get(client)
  if (active) {
    cryptoSyncQueued.add(client)
    return active
  }
  const sync = (async () => {
    try {
      await syncNativeCryptoNow(client)
    } catch (error) {
      console.warn('[push] Could not sync native notification crypto', error)
      const attempt = (cryptoSyncRetries.get(client) ?? 0) + 1
      cryptoSyncRetries.set(client, attempt)
      if (attempt <= 3)
        scheduleNativeCryptoSync(client, Math.min(30_000, 5_000 * 2 ** (attempt - 1)))
      return
    }
    if (nativeCryptoValidated.has(client)) return
    try {
      const result = await testNativeCryptoWithLoadedEvent(client)
      if (result?.ok) {
        nativeCryptoValidated.add(client)
        console.info('[push] Native notification decryption validated automatically', {
          userId: client.getUserId(),
          roomId: result.roomId,
          eventId: result.eventId,
        })
      }
    } catch (error) {
      // Retry validation during a later crypto sync.
      console.warn('[push] Automatic native notification decryption validation failed', error)
    }
  })()
  cryptoSyncInFlight.set(client, sync)
  try {
    await sync
  } finally {
    if (cryptoSyncInFlight.get(client) === sync) cryptoSyncInFlight.delete(client)
    if (cryptoSyncQueued.delete(client)) scheduleNativeCryptoSync(client, 0, true)
  }
}

export function scheduleNativeCryptoSyncForEvent(client: MatrixClient, event: MatrixEvent) {
  if (event.getWireType() !== EventType.RoomMessageEncrypted) return
  const content = event.getWireContent() as { session_id?: string }
  const roomId = event.getRoomId()
  const sessionId = content.session_id
  if (!roomId || !sessionId) return
  const sessionKey = `${roomId}\u0000${sessionId}`
  if (syncedRoomSessions.get(client)?.has(sessionKey)) return
  scheduleNativeCryptoSync(client, 1_000, true)
}

function isAndroidNative() {
  return !!window.__TAURI_INTERNALS__?.invoke && /Android/i.test(navigator.userAgent)
}

export async function syncNativeCryptoNow(client: MatrixClient) {
  const invoke = window.__TAURI_INTERNALS__?.invoke
  const cryptoApi = client.getCrypto()
  const userId = client.getUserId()
  const deviceId = client.getDeviceId()
  const accessToken = client.getAccessToken()
  if (!invoke || !cryptoApi || !userId || !deviceId || !accessToken) return
  const roomKeys = await cryptoApi.exportRoomKeysAsJson()
  const backupVersion = await cryptoApi.getActiveSessionBackupVersion()
  const backupPrivateKey = backupVersion ? await cryptoApi.getSessionBackupPrivateKey() : null
  const backupRecoveryKey = backupPrivateKey
    ? btoa(Array.from(backupPrivateKey, (byte) => String.fromCharCode(byte)).join(''))
    : undefined
  const exportedSessions = new Set<string>()
  try {
    for (const key of JSON.parse(roomKeys) as Array<{ room_id?: string; session_id?: string }>) {
      if (key.room_id && key.session_id)
        exportedSessions.add(`${key.room_id}\u0000${key.session_id}`)
    }
  } catch {}
  const allRooms = client.getRooms()
  const joinedRooms = allRooms.filter((room) => room.getMyMembership() === 'join')
  const rooms = JSON.stringify(
    joinedRooms.map((room) => {
      const avatarMxc = room.currentState
        .getStateEvents('m.room.avatar', '')
        ?.getContent<{ url?: string }>().url
      const parentSpace =
        room.getType() === RoomType.Space
          ? undefined
          : allRooms.find(
              (candidate) =>
                candidate.getType() === RoomType.Space &&
                !!candidate.currentState.getStateEvents(EventType.SpaceChild, room.roomId),
            )
      const spaceAvatarMxc = parentSpace?.currentState
        .getStateEvents('m.room.avatar', '')
        ?.getContent<{ url?: string }>().url
      const notificationAvatarMxc = avatarMxc?.trim() || spaceAvatarMxc?.trim()
      return {
        roomId: room.roomId,
        name: parentSpace ? `${parentSpace.name} > ${room.name}` : room.name,
        avatarUrl: notificationAvatarMxc
          ? client.mxcUrlToHttp(notificationAvatarMxc, 96, 96, 'crop', false, true, true)
          : undefined,
      }
    }),
  )
  await invoke<void>('plugin:remote-push|sync_native_crypto', {
    userId,
    deviceId,
    homeserver: client.getHomeserverUrl(),
    accessToken,
    refreshToken: client.getRefreshToken() ?? undefined,
    roomKeys,
    rooms,
    backupVersion: backupRecoveryKey ? backupVersion : undefined,
    backupRecoveryKey,
    pushClearToken: clearToken(),
    pushGatewayUrl: GATEWAY_URL,
    notificationPreferences: JSON.stringify(timelineAppearanceSettings()),
  })
  const setupDeadline = Date.now() + NATIVE_CRYPTO_SETUP_TIMEOUT_MS
  while (true) {
    const status = await invoke<NativeCryptoStatus>('plugin:remote-push|native_crypto_status')
    const account = status.accounts.find((item) => item.userId === userId)
    if (account?.setupState === 'error' || account?.setupError) {
      throw new Error(`${userId}: ${account.setupError || 'Native crypto setup failed'}`)
    }
    if (account?.setupState === 'ready') break
    if (Date.now() >= setupDeadline) {
      throw new Error(`${userId}: Timed out while Android was importing room keys`)
    }
    await delay(500)
  }
  lastCryptoSync.set(client, Date.now())
  syncedRoomSessions.set(client, exportedSessions)
  cryptoSyncRetries.set(client, 0)
}

export async function testNativeCryptoWithLoadedEvent(client: MatrixClient, force = false) {
  const invoke = window.__TAURI_INTERNALS__?.invoke
  if (!invoke || (!force && nativeCryptoValidated.has(client))) return
  const candidate = client
    .getRooms()
    .flatMap((room) =>
      [...room.getLiveTimeline().getEvents()].reverse().map((event) => ({ room, event })),
    )
    .find(
      ({ event }) =>
        event.getWireType() === EventType.RoomMessageEncrypted &&
        !event.isDecryptionFailure() &&
        !!event.getId(),
    )
  if (!candidate) return
  const result = await invoke<NativeCryptoTestResult>('plugin:remote-push|test_native_crypto', {
    roomId: candidate.room.roomId,
    eventId: candidate.event.getId(),
  })
  if (!result?.ok) throw new Error('Native crypto returned no test result')
  nativeCryptoValidated.add(client)
  return result
}

function clearToken() {
  let value = localStorage.getItem(CLEAR_TOKEN_KEY)
  if (!value) {
    value = crypto.randomUUID()
    localStorage.setItem(CLEAR_TOKEN_KEY, value)
  }
  return value
}

export async function clearMatrixPushRoom(roomId: string) {
  const invoke = window.__TAURI_INTERNALS__?.invoke
  if (invoke)
    await invoke<void>('plugin:remote-push|clear_room_notification', { roomId }).catch(
      () => undefined,
    )
  if (currentPushkey)
    await fetch(`${GATEWAY_URL}/_foxchat/push/v1/read`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pushkey: currentPushkey, room_id: roomId, clear_token: clearToken() }),
      keepalive: true,
    }).catch(() => undefined)
}

export async function registerMatrixPush(client: MatrixClient) {
  const activeRegistration = registrationInFlight.get(client)
  if (activeRegistration) return activeRegistration
  const registration = performMatrixPushRegistration(client)
  registrationInFlight.set(client, registration)
  try {
    await registration
  } finally {
    if (registrationInFlight.get(client) === registration) registrationInFlight.delete(client)
  }
}

async function performMatrixPushRegistration(client: MatrixClient) {
  const gatewayUrl = GATEWAY_URL
  const invoke = window.__TAURI_INTERNALS__?.invoke
  if (!gatewayUrl) throw new Error('The FoxChat push gateway URL is not configured')
  if (!invoke)
    throw new Error('Native push registration is only available in the installed Android app')
  const existingTimer = registrationTimers.get(client)
  if (existingTimer !== undefined) window.clearTimeout(existingTimer)
  registrationTimers.delete(client)

  try {
    const notificationPermission = await invoke<boolean>(
      'plugin:notification|is_permission_granted',
    ).catch(() => false)
    const notificationResult = notificationPermission
      ? 'granted'
      : await invoke<string>('plugin:notification|request_permission')
    if (notificationResult !== 'granted')
      console.warn(
        '[push] Android notification display permission is not granted; registering the Matrix pusher anyway',
        { notificationResult },
      )
    const permission = await invoke<unknown>('plugin:remote-push|request_permission')
    console.info('[push] Android notification and remote-push permissions granted', {
      notificationResult,
      remotePushResult: permission,
    })
    const pushkey = await invoke<string>('plugin:remote-push|get_token')
    if (!pushkey) throw new Error('Firebase returned an empty registration token')
    currentPushkey = pushkey
    const deviceId = client.getDeviceId() || undefined
    const targetUrl = `${gatewayUrl}/_matrix/push/v1/notify`
    await invoke<void>('plugin:notification|create_channel', {
      id: 'messages',
      name: 'New messages',
      importance: 4,
      vibration: true,
    }).catch(() => undefined)
    await invoke<void>('plugin:notification|create_channel', {
      id: 'messages_silent',
      name: 'Additional unread messages',
      importance: 3,
      vibration: false,
    }).catch(() => undefined)
    const before = (await client.getPushers()).pushers
    const stale = before.filter(
      (pusher) =>
        pusher.app_id === APP_ID &&
        pusher.kind === 'http' &&
        pusher.pushkey !== pushkey &&
        !!deviceId &&
        pusher.profile_tag === deviceId,
    )
    const wrongEndpoint = before.filter(
      (pusher) =>
        pusher.app_id === APP_ID &&
        pusher.kind === 'http' &&
        pusher.pushkey === pushkey &&
        pusher.data?.url !== targetUrl,
    )
    for (const pusher of [...stale, ...wrongEndpoint])
      await client.removePusher(pusher.pushkey, pusher.app_id)
    if (stale.length || wrongEndpoint.length)
      console.info('[push] Removed stale Matrix pushers', {
        staleTokens: stale.length,
        wrongEndpoints: wrongEndpoint.length,
        deviceId,
      })
    await client.setPusher({
      app_id: APP_ID,
      pushkey,
      kind: 'http',
      app_display_name: 'FoxChat',
      device_display_name: 'FoxChat Android',
      lang: navigator.language || 'en',
      profile_tag: deviceId,
      data: {
        url: targetUrl,
        format: 'event_id_only',
        client_name: 'FoxChat android',
        data_message: 'android',
        clear_token: clearToken(),
      } as never,
      append: true,
    })
    const registered = (await client.getPushers()).pushers.some(
      (pusher) =>
        pusher.kind === 'http' &&
        pusher.app_id === APP_ID &&
        pusher.pushkey === pushkey &&
        pusher.data?.url === targetUrl &&
        pusher.data?.format === 'event_id_only',
    )
    if (!registered) throw new Error('Homeserver did not retain the Matrix HTTP pusher')
    registrationRetries.set(client, 0)
    scheduleNativeCryptoSync(client, 0)
    console.info('[push] Matrix FCM pusher registered and verified', {
      gatewayUrl,
      appId: APP_ID,
      deviceId: client.getDeviceId(),
      tokenSuffix: pushkey.slice(-8),
    })
  } catch (error) {
    console.error('[push] Could not register Matrix FCM pusher', error)
    const attempt = (registrationRetries.get(client) || 0) + 1
    registrationRetries.set(client, attempt)
    const delay = Math.min(60_000, 5_000 * 2 ** Math.min(attempt - 1, 4))
    registrationTimers.set(
      client,
      window.setTimeout(() => void registerMatrixPush(client).catch(() => undefined), delay),
    )
    console.info('[push] Matrix push registration retry scheduled', { attempt, delayMs: delay })
    throw error instanceof Error ? error : new Error(String(error))
  }
}
