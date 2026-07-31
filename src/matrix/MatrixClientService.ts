import {
  ClientEvent,
  ContentHelpers,
  createClient,
  DeviceVerification,
  Direction,
  EventStatus,
  EventType,
  IndexedDBCryptoStore,
  IndexedDBStore,
  type ISearchResults,
  M_POLL_END,
  M_POLL_RESPONSE,
  M_POLL_START,
  MatrixClient,
  MatrixEvent,
  MatrixEventEvent,
  MsgType,
  NotificationCountType,
  PushRuleActionName,
  PushRuleKind,
  Preset,
  RelationType,
  Room,
  RoomEvent,
  RoomMemberEvent,
  RoomStateEvent,
  RoomType,
  TweakName,
  Visibility,
} from 'matrix-js-sdk'
import {
  CryptoEvent,
  VerificationPhase,
  VerificationRequestEvent,
  type VerificationRequest,
} from 'matrix-js-sdk/lib/crypto-api'
import { deriveRecoveryKeyFromPassphrase } from 'matrix-js-sdk/lib/crypto-api/key-passphrase.js'
import { decodeRecoveryKey, encodeRecoveryKey } from 'matrix-js-sdk/lib/crypto-api/recovery-key.js'
import type { ImageInfo } from 'matrix-js-sdk/lib/@types/media'
import { ReceiptType } from 'matrix-js-sdk/lib/@types/read_receipts'
import { GroupCallIntent, GroupCallType, type GroupCall } from 'matrix-js-sdk/lib/webrtc/groupCall'
import { SetPresence } from 'matrix-js-sdk/lib/sync'
import {
  clearMatrixPushRoom,
  registerMatrixPush,
  scheduleNativeCryptoSync,
  scheduleNativeCryptoSyncForEvent,
} from '../platform/push'
import { timelineAppearanceSettings, VOICE_CHANNEL_ROOM_TYPE } from '../lib/constants'
import { isHiddenTimelineActivity, isVisibleMessageEvent } from '../lib/eventHelpers'
import { isServerEventId } from '../lib/matrixIdentifiers'
import { applyPermissionLevels } from '../lib/powerLevelPaths'
import { DEVICE_DELETE_ACTION } from '../lib/accountManagement'
import { GALLERY_EVENT_FIELD } from '../lib/gallery'
import {
  REGISTRATION_DUMMY_STAGE,
  registrationChallengeFromUia,
  type RegistrationChallenge,
} from '../lib/registration'
import {
  IMAGE_PACK_STATE_TARGET_BYTES,
  findRoomImagePacks,
  jsonByteLength,
  roomImagePackTypes,
  roomImagePacksFromStateEvents,
  splitImagePackContent,
  type RoomImagePackLocation,
  type RoomImagePackStateEvent,
} from '../lib/emojiData'

declare global {
  interface Window {
    __TAURI_INTERNALS__?: { invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> }
  }
}

export type MatrixSession = {
  baseUrl: string
  accessToken: string
  refreshToken?: string
  accessTokenExpiresAt?: number
  userId: string
  deviceId: string
}

export type MatrixRegistrationDetails = {
  homeserver: string
  username: string
  password: string
  displayName?: string
}

export type MatrixRegistrationResult =
  | { status: 'challenge'; challenge: RegistrationChallenge }
  | { status: 'complete'; session: MatrixSession; profileWarning?: string }

export type MatrixDeviceSession = {
  deviceId: string
  displayName: string
  lastSeenIp?: string
  lastSeenTs?: number
  userAgent?: string
  current: boolean
  verified: boolean
  crossSigned: boolean
  signedByOwner: boolean
  locallyVerified: boolean
}

export type MatrixSecurityStatus = {
  crossSigningReady: boolean
  publicCrossSigningKeys: boolean
  privateKeysInSecretStorage: boolean
  privateKeysCachedLocally: boolean
  keyBackupVersion: string | null
  keyBackupActive: boolean
  hasBackupKey: boolean
  hasSecretStorageKey: boolean
  secretStorageKeyCached: boolean
  secretStorageReady: boolean
  dehydrationSupported: boolean
}

export type MatrixPublicSignature = {
  signer: string
  keyId: string
  signature: string
}

export type MatrixRoomDeviceSecurity = {
  deviceId: string
  displayName: string
  algorithms: string[]
  fingerprint?: string
  identityKey?: string
  dehydrated: boolean
  blocked: boolean
  verified: boolean
  crossSigningVerified: boolean
  signedByOwner: boolean
  locallyVerified: boolean
  tofu: boolean
  signatures: MatrixPublicSignature[]
}

export type MatrixRoomMemberSecurity = {
  userId: string
  displayName: string
  avatarUrl?: string
  identity: {
    known: boolean
    verified: boolean
    crossSigningVerified: boolean
    previouslyVerified: boolean
    needsApproval: boolean
  }
  crossSigningKeys: Array<{
    type: string
    usage: string[]
    keyId: string
    key: string
    signatures: MatrixPublicSignature[]
  }>
  devices: MatrixRoomDeviceSecurity[]
}

export type RoomNotificationMode = 'all' | 'mentions' | 'none'
export type PresenceMode = 'automatic' | 'online' | 'away' | 'offline'
export type PresenceState = 'online' | 'unavailable' | 'offline'

export type SyncObserver = {
  onRoom?: (room: Room) => void
  onEvent?: (event: MatrixEvent, room?: Room) => void
  onSync?: (state: string) => void
  onVerificationRequest?: (request: VerificationRequest) => void
  onImagePacksChanged?: (roomId: string, client: MatrixClient) => void
}

const SESSION_KEY = 'foxchat.matrix.session'
const ACCOUNTS_KEY = 'foxchat.matrix.accounts'
const ACTIVE_ACCOUNT_KEY = 'foxchat.matrix.activeAccount'
const SESSION_REVOCATION_TIMEOUT_MS = 15_000
const HOMESERVER_KEY = 'foxchat.matrix.lastHomeserver'
const NATIVE_ACCOUNTS_VERSION = 1
const ROOM_ACCOUNTS_KEY = 'foxchat.matrix.roomAccounts'
const COMBINED_ACCOUNTS_KEY = 'foxchat.matrix.combinedAccounts'
const AUTO_READ_ALL_ACCOUNTS_KEY = 'foxchat.matrix.autoReadAllAccounts'
export const AUTO_READ_ALL_ACCOUNTS_CHANGED_EVENT = 'foxchat-auto-read-all-accounts-changed'
const PRESENCE_MODES_KEY = 'foxchat.matrix.presenceModes'
const LOCAL_ROOM_NAMES_KEY = 'foxchat.matrix.localRoomNames'
const REACTION_PARENT_CACHE_KEY = 'foxchat.matrix.reactionParents'
const IMAGE_PACK_ORDER_EVENT = 'chat.foxchat.image_pack_order'
export const IMAGE_PACK_LIST_TTL_MS = 60 * 60 * 1000
const REACTION_PARENT_CACHE_LIMIT = 2_000
const PRESENCE_IDLE_MS = 5 * 60 * 1000
const normalizedPowerLevel = (value: unknown) =>
  value === null
    ? Number.MAX_SAFE_INTEGER
    : typeof value === 'number' && Number.isFinite(value)
      ? value
      : 0
const normalizeHomeserverInput = (value: string) => {
  const normalized = value.replace(/\/$/, '')
  if (/^https?:\/\//i.test(normalized)) return normalized
  if (normalized.startsWith('//')) return `https:${normalized}`
  return `https://${normalized}`
}
const isInfiniteRoomCreator = (room: Room, userId: string) => {
  const create = room.currentState.getStateEvents(EventType.RoomCreate, '')
  const version = String(create?.getContent().room_version ?? room.getVersion())
  if (!/^\d+$/.test(version) || Number(version) < 12) return false
  const additional = create?.getContent().additional_creators
  return (
    create?.getSender() === userId || (Array.isArray(additional) && additional.includes(userId))
  )
}
const effectivePowerLevel = (room: Room, userId: string) =>
  isInfiniteRoomCreator(room, userId)
    ? Number.MAX_SAFE_INTEGER
    : normalizedPowerLevel(room.getMember(userId)?.powerLevel)
const discoverHomeserverBaseUrl = async (homeserver: string) => {
  const wellKnownUrl = new URL('/.well-known/matrix/client', normalizeHomeserverInput(homeserver))
  try {
    const response = await fetch(wellKnownUrl)
    if (response.ok) {
      const wellKnown = (await response.json()) as { 'm.homeserver'?: { base_url?: unknown } }
      const baseUrl =
        typeof wellKnown['m.homeserver']?.base_url === 'string'
          ? wellKnown['m.homeserver']!.base_url.trim()
          : ''
      if (baseUrl) {
        try {
          const discovered = new URL(baseUrl, wellKnownUrl)
          if (discovered.protocol === 'https:' || discovered.protocol === 'http:')
            return discovered.toString().replace(/\/$/, '')
          return normalizeHomeserverInput(baseUrl)
        } catch {
          return normalizeHomeserverInput(baseUrl)
        }
      }
    }
  } catch {}
  return normalizeHomeserverInput(homeserver)
}

export class MatrixClientService {
  private client?: MatrixClient
  private observers = new Set<SyncObserver>()
  private watchedEvents = new WeakSet<MatrixEvent>()
  private decryptionRetryAttempts = new WeakMap<MatrixEvent, number>()
  private decryptionRetryTimers = new WeakMap<MatrixEvent, number>()
  private decryptionRetriesInFlight = new WeakSet<MatrixEvent>()
  private secretStorageKeys = new Map<string, Uint8Array>()
  private cryptoSyncRunning?: Promise<void>
  private cryptoRetryTimer?: number
  private cryptoRetryInFlight?: Promise<unknown>
  private lastReadReceipts = new WeakMap<
    MatrixClient,
    Map<string, { eventId: string; timestamp: number }>
  >()
  private replyEventCache = new Map<string, Promise<MatrixEvent | undefined>>()
  private reactionLoads = new Map<string, Promise<void>>()
  private sendQueues = new Map<string, Promise<void>>()
  private encryptionMembersPrepared = new WeakMap<MatrixClient, Set<string>>()
  private secondaryClients = new Map<string, MatrixClientService>()
  private roomOwners = new WeakMap<Room, MatrixClient>()
  private eventOwners = new WeakMap<MatrixEvent, MatrixClient>()
  private roomReadOwners = new Map<string, MatrixClient>()
  private startInFlight?: Promise<MatrixClient>
  private presenceTrackingCleanup?: () => void
  private presenceIdleTimer?: number
  private lastPresenceActivity = Date.now()
  private appliedPresenceStates = new WeakMap<MatrixClient, PresenceState>()
  private savedAccountsSource?: string
  private savedAccountsCache: MatrixSession[] = []
  private presenceQueues = new WeakMap<MatrixClient, Promise<void>>()
  private verificationRequests = new Set<VerificationRequest>()
  private trackedVerificationRequests = new WeakSet<VerificationRequest>()
  private imagePackLists = new WeakMap<
    MatrixClient,
    Map<string, { loadedAt: number; packs: RoomImagePackLocation[] }>
  >()
  private imagePackListLoads = new WeakMap<
    MatrixClient,
    Map<string, Promise<RoomImagePackLocation[]>>
  >()
  private resumeSyncRetryUntil = 0
  private readonly secondary: boolean
  private readonly ephemeral: boolean

  constructor(secondary = false, ephemeral = false) {
    this.secondary = secondary
    this.ephemeral = ephemeral
  }

  get matrixClient() {
    return this.client
  }

  private retryBackedOffSyncAfterResume(client: MatrixClient) {
    if (Date.now() > this.resumeSyncRetryUntil) return false
    const state = String(client.getSyncState()).toUpperCase()
    if (state !== 'RECONNECTING' && state !== 'ERROR') return false
    const retried = client.retryImmediately()
    if (retried) this.resumeSyncRetryUntil = 0
    return retried
  }

  retrySyncAfterResume(retryWindowMs = 15_000) {
    this.resumeSyncRetryUntil = Date.now() + retryWindowMs
    let retried = this.client && this.retryBackedOffSyncAfterResume(this.client) ? 1 : 0
    for (const service of this.secondaryClients.values())
      retried += service.retrySyncAfterResume(retryWindowMs)
    return retried
  }

  private waitForInitialSync(client: MatrixClient, timeoutMs = 45000) {
    const ready = () =>
      ['PREPARED', 'SYNCING'].includes(String(client.getSyncState()).toUpperCase())
    if (ready()) return Promise.resolve()
    return new Promise<void>((resolve) => {
      let settled = false
      const finish = () => {
        if (settled) return
        settled = true
        window.clearTimeout(timeout)
        client.off(ClientEvent.Sync, onSync)
        resolve()
      }
      const onSync = (state: unknown) => {
        const value = String(state).toUpperCase()
        if (value === 'PREPARED' || value === 'SYNCING' || value === 'ERROR' || value === 'STOPPED')
          finish()
      }
      const timeout = window.setTimeout(finish, timeoutMs)
      client.on(ClientEvent.Sync, onSync)
    })
  }

  private accountId(session: MatrixSession) {
    return `${session.baseUrl}|${session.userId}|${session.deviceId}`
  }
  private sameMatrixAccount(first: MatrixSession, second: MatrixSession) {
    return (
      normalizeHomeserverInput(first.baseUrl).toLowerCase() ===
        normalizeHomeserverInput(second.baseUrl).toLowerCase() && first.userId === second.userId
    )
  }

  savedAccounts(): MatrixSession[] {
    const source = localStorage.getItem(ACCOUNTS_KEY) ?? '[]'
    if (source === this.savedAccountsSource) return this.savedAccountsCache
    this.savedAccountsSource = source
    try {
      const accounts = JSON.parse(source) as MatrixSession[]
      this.savedAccountsCache = accounts.filter(
        (session) => session.baseUrl && session.accessToken && session.userId && session.deviceId,
      )
      return this.savedAccountsCache
    } catch {
      this.savedAccountsCache = []
      return this.savedAccountsCache
    }
  }

  activeAccountId() {
    return localStorage.getItem(ACTIVE_ACCOUNT_KEY)
  }
  savedAccountId(session: MatrixSession) {
    return this.accountId(session)
  }
  combinedAccountsEnabled() {
    return localStorage.getItem(COMBINED_ACCOUNTS_KEY) !== 'false'
  }
  setCombinedAccountsEnabled(enabled: boolean) {
    localStorage.setItem(COMBINED_ACCOUNTS_KEY, String(enabled))
    this.backupAccounts()
  }
  autoReadAllAccountsEnabled() {
    return localStorage.getItem(AUTO_READ_ALL_ACCOUNTS_KEY) !== 'false'
  }
  setAutoReadAllAccountsEnabled(enabled: boolean) {
    localStorage.setItem(AUTO_READ_ALL_ACCOUNTS_KEY, String(enabled))
    this.backupAccounts()
    window.dispatchEvent(
      new CustomEvent(AUTO_READ_ALL_ACCOUNTS_CHANGED_EVENT, {
        detail: enabled,
      }),
    )
  }
  private presenceModes(): Record<string, PresenceMode> {
    try {
      const stored = JSON.parse(localStorage.getItem(PRESENCE_MODES_KEY) ?? '{}') as Record<
        string,
        PresenceMode
      >
      return Object.fromEntries(
        Object.entries(stored).filter((entry): entry is [string, PresenceMode] =>
          ['automatic', 'online', 'away', 'offline'].includes(entry[1]),
        ),
      )
    } catch {
      return {}
    }
  }

  private localRoomNames(): Record<string, string> {
    try {
      const stored = JSON.parse(localStorage.getItem(LOCAL_ROOM_NAMES_KEY) ?? '{}') as Record<
        string,
        unknown
      >
      return Object.fromEntries(
        Object.entries(stored)
          .filter(
            (entry): entry is [string, string] => typeof entry[1] === 'string' && !!entry[1].trim(),
          )
          .map(([roomId, name]) => [roomId, name.trim()]),
      )
    } catch {
      return {}
    }
  }

  localRoomName(roomId: string) {
    return this.localRoomNames()[roomId]
  }

  setLocalRoomName(roomId: string, name?: string) {
    const names = this.localRoomNames()
    const normalized = name?.trim()
    if (normalized) names[roomId] = normalized
    else delete names[roomId]
    localStorage.setItem(LOCAL_ROOM_NAMES_KEY, JSON.stringify(names))
    for (const account of this.availableAccounts()) {
      const room = account.client.getRoom(roomId)
      if (!room) continue
      room.recalculate()
      this.applyLocalRoomName(room)
      this.observers.forEach((observer) => observer.onRoom?.(room))
      scheduleNativeCryptoSync(account.client, 0)
    }
    this.backupAccounts()
    window.dispatchEvent(
      new CustomEvent('foxchat-local-room-name-changed', {
        detail: { roomId, name: normalized },
      }),
    )
  }

  private applyLocalRoomName(room: Room) {
    const localName = this.localRoomName(room.roomId)
    if (localName) {
      room.name = localName
      return
    }
    const matrixName = room.currentState
      .getStateEvents(EventType.RoomName, '')
      ?.getContent<{ name?: unknown }>().name
    if (typeof matrixName === 'string' && matrixName.trim()) {
      room.name = matrixName.trim()
      return
    }
    const directMember = this.directRoomMember(room)
    if (directMember) room.name = directMember.name || directMember.userId
  }

  directRoomMember(room: Room) {
    if (room.getType() === RoomType.Space) return undefined
    const ownUserIds = new Set(this.availableAccounts().map((account) => account.userId))
    ownUserIds.add(room.myUserId)
    const otherMembers = new Map(
      room
        .getMembers()
        .filter(
          (member) =>
            (member.membership === 'join' || member.membership === 'invite') &&
            !ownUserIds.has(member.userId),
        )
        .map((member) => [member.userId, member]),
    )
    return otherMembers.size === 1 ? otherMembers.values().next().value : undefined
  }

  private backupAccounts() {
    const invoke = window.__TAURI_INTERNALS__?.invoke
    if (!invoke) return
    const data = JSON.stringify({
      version: NATIVE_ACCOUNTS_VERSION,
      accounts: this.savedAccounts(),
      activeAccountId: this.activeAccountId(),
      lastHomeserver: localStorage.getItem(HOMESERVER_KEY),
      roomAccounts: this.roomAccountSelections(),
      combinedAccounts: this.combinedAccountsEnabled(),
      autoReadAllAccounts: this.autoReadAllAccountsEnabled(),
      presenceModes: this.presenceModes(),
      localRoomNames: this.localRoomNames(),
    })
    void invoke('save_matrix_accounts', { data }).catch((error) =>
      console.error('[accounts] Could not save native account backup', error),
    )
  }

  async hydrateNativeAccounts() {
    if (this.savedAccounts().length || localStorage.getItem(SESSION_KEY)) {
      this.backupAccounts()
      return
    }
    const invoke = window.__TAURI_INTERNALS__?.invoke
    if (!invoke) return
    try {
      const raw = await invoke<string | null>('load_matrix_accounts')
      if (!raw) return
      const backup = JSON.parse(raw) as {
        accounts?: MatrixSession[]
        activeAccountId?: string
        lastHomeserver?: string
        roomAccounts?: Record<string, string>
        combinedAccounts?: boolean
        autoReadAllAccounts?: boolean
        presenceModes?: Record<string, PresenceMode>
        localRoomNames?: Record<string, string>
      }
      const accounts = (backup.accounts ?? []).filter(
        (session) => session.baseUrl && session.accessToken && session.userId && session.deviceId,
      )
      if (!accounts.length) return
      localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(accounts))
      if (backup.activeAccountId) localStorage.setItem(ACTIVE_ACCOUNT_KEY, backup.activeAccountId)
      if (backup.lastHomeserver) localStorage.setItem(HOMESERVER_KEY, backup.lastHomeserver)
      if (backup.roomAccounts)
        localStorage.setItem(ROOM_ACCOUNTS_KEY, JSON.stringify(backup.roomAccounts))
      if (typeof backup.combinedAccounts === 'boolean')
        localStorage.setItem(COMBINED_ACCOUNTS_KEY, String(backup.combinedAccounts))
      if (typeof backup.autoReadAllAccounts === 'boolean')
        localStorage.setItem(AUTO_READ_ALL_ACCOUNTS_KEY, String(backup.autoReadAllAccounts))
      if (backup.presenceModes)
        localStorage.setItem(PRESENCE_MODES_KEY, JSON.stringify(backup.presenceModes))
      if (backup.localRoomNames)
        localStorage.setItem(LOCAL_ROOM_NAMES_KEY, JSON.stringify(backup.localRoomNames))
      console.info('[accounts] Restored saved accounts from native app data')
    } catch (error) {
      console.error('[accounts] Could not restore native account backup', error)
    }
  }

  private async authenticate(baseUrl: string, username: string, password: string) {
    baseUrl = await discoverHomeserverBaseUrl(baseUrl)
    const authClient = createClient({ baseUrl })
    const login = (requestRefreshToken: boolean) =>
      authClient.login('m.login.password', {
        identifier: { type: 'm.id.user', user: username },
        password,
        initial_device_display_name: 'FoxChat',
        refresh_token: requestRefreshToken,
      })
    let response = await login(true)
    if (response.refresh_token) {
      try {
        const refresh = await fetch(`${baseUrl}/_matrix/client/v3/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refresh_token: response.refresh_token }),
        })
        if (refresh.ok) {
          const tokens = (await refresh.json()) as {
            access_token: string
            refresh_token?: string
            expires_in_ms?: number
          }
          response = {
            ...response,
            access_token: tokens.access_token,
            refresh_token: tokens.refresh_token ?? response.refresh_token,
            expires_in_ms: tokens.expires_in_ms,
          }
        } else if (refresh.status >= 400 && refresh.status < 500) {
          // Some homeservers advertise unusable refresh tokens.
          await this.revokeSession({
            baseUrl,
            accessToken: response.access_token,
            refreshToken: response.refresh_token,
            accessTokenExpiresAt: response.expires_in_ms
              ? Date.now() + response.expires_in_ms
              : undefined,
            userId: response.user_id,
            deviceId: response.device_id,
          }).catch(() => undefined)
          response = await login(false)
        }
      } catch {
        // The SDK can retry after a failed refresh probe.
      }
    }
    const session: MatrixSession = {
      baseUrl,
      accessToken: response.access_token,
      refreshToken: response.refresh_token,
      accessTokenExpiresAt: response.expires_in_ms
        ? Date.now() + response.expires_in_ms
        : undefined,
      userId: response.user_id,
      deviceId: response.device_id,
    }
    return session
  }

  private async revokeSession(session: MatrixSession) {
    const client = createClient({
      baseUrl: session.baseUrl,
      accessToken: session.accessToken,
      userId: session.userId,
      deviceId: session.deviceId,
    })
    let timeout: number | undefined
    try {
      await Promise.race([
        client.logout(true),
        new Promise<never>((_, reject) => {
          timeout = window.setTimeout(
            () => reject(new Error('Timed out while revoking the Matrix session')),
            SESSION_REVOCATION_TIMEOUT_MS,
          )
        }),
      ])
    } finally {
      if (timeout !== undefined) window.clearTimeout(timeout)
      client.stopClient()
    }
  }

  async login(baseUrl: string, username: string, password: string) {
    const session = await this.authenticate(baseUrl, username, password)
    try {
      await this.start(session)
      this.persistSession(session)
      try {
        localStorage.setItem(HOMESERVER_KEY, session.baseUrl)
      } catch {
        /* optional convenience value */
      }
    } catch (error) {
      await this.stop().catch(() => undefined)
      await this.revokeSession(session).catch(() => undefined)
      throw error
    }
    return session
  }

  async registerAccount(
    details: MatrixRegistrationDetails,
    auth?: Record<string, unknown>,
  ): Promise<MatrixRegistrationResult> {
    const baseUrl = await discoverHomeserverBaseUrl(details.homeserver)
    const enteredUsername = details.username.trim()
    const username = enteredUsername.startsWith('@')
      ? enteredUsername.slice(1).split(':')[0]
      : enteredUsername
    let nextAuth = auth

    for (let attempt = 0; attempt < 10; attempt += 1) {
      const response = await fetch(`${baseUrl}/_matrix/client/v3/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username,
          password: details.password,
          initial_device_display_name: 'FoxChat',
          refresh_token: true,
          ...(nextAuth ? { auth: nextAuth } : {}),
        }),
      })
      const data = (await response.json().catch(() => ({}))) as Record<string, unknown>

      if (response.status === 401) {
        const challenge = registrationChallengeFromUia(baseUrl, data)
        if (!challenge) {
          throw new Error(
            typeof data.error === 'string'
              ? data.error
              : 'This homeserver returned an invalid registration challenge.',
          )
        }
        if (challenge.stage === REGISTRATION_DUMMY_STAGE) {
          nextAuth = { type: challenge.stage, session: challenge.session }
          continue
        }
        return { status: 'challenge', challenge }
      }

      if (!response.ok) {
        const message = typeof data.error === 'string' ? data.error : `HTTP ${response.status}`
        const code = typeof data.errcode === 'string' ? `${data.errcode}: ` : ''
        throw new Error(`${code}${message}`)
      }

      const userId = typeof data.user_id === 'string' ? data.user_id : ''
      const accessToken = typeof data.access_token === 'string' ? data.access_token : ''
      const deviceId = typeof data.device_id === 'string' ? data.device_id : ''
      let session: MatrixSession
      if (userId && accessToken && deviceId) {
        session = {
          baseUrl,
          accessToken,
          refreshToken: typeof data.refresh_token === 'string' ? data.refresh_token : undefined,
          accessTokenExpiresAt:
            typeof data.expires_in_ms === 'number' ? Date.now() + data.expires_in_ms : undefined,
          userId,
          deviceId,
        }
      } else {
        session = await this.authenticate(baseUrl, username, details.password)
      }

      try {
        await this.start(session)
        let profileWarning: string | undefined
        const displayName = details.displayName?.trim()
        if (displayName) {
          try {
            await this.client!.setDisplayName(displayName)
          } catch (error) {
            profileWarning =
              error instanceof Error ? error.message : 'The display name could not be saved.'
          }
        }
        this.persistSession(session)
        try {
          localStorage.setItem(HOMESERVER_KEY, session.baseUrl)
        } catch {
          /* optional convenience value */
        }
        return { status: 'complete', session, profileWarning }
      } catch (error) {
        await this.stop().catch(() => undefined)
        await this.revokeSession(session).catch(() => undefined)
        throw error
      }
    }

    throw new Error('The homeserver requested too many registration steps.')
  }

  async loginAdditionalAccount(baseUrl: string, username: string, password: string) {
    const session = await this.authenticate(baseUrl, username, password)
    const replacedSessions = this.savedAccounts().filter((saved) =>
      this.sameMatrixAccount(saved, session),
    )
    const candidate = new MatrixClientService(true, true)
    try {
      await candidate.start(session)
      const syncState = String(candidate.matrixClient?.getSyncState()).toUpperCase()
      if (!['PREPARED', 'SYNCING'].includes(syncState)) {
        throw new Error('The account authenticated, but its initial Matrix sync did not complete')
      }
      await candidate.stop()
      this.persistSession(session)
      try {
        localStorage.setItem(HOMESERVER_KEY, session.baseUrl)
      } catch {
        /* optional convenience value */
      }
    } catch (error) {
      await candidate.stop().catch(() => undefined)
      await this.revokeSession(session).catch(() => undefined)
      throw error
    }
    await Promise.allSettled(
      replacedSessions
        .filter((saved) => this.accountId(saved) !== this.accountId(session))
        .map((saved) => this.revokeSession(saved)),
    )
    return session
  }

  restoreSession(): MatrixSession | undefined {
    try {
      const accounts = this.savedAccounts()
      const activeId = this.activeAccountId()
      const active = accounts.find((session) => this.accountId(session) === activeId) ?? accounts[0]
      if (active) return active
      const raw = localStorage.getItem(SESSION_KEY) ?? sessionStorage.getItem(SESSION_KEY)
      if (!raw) return undefined
      const session = JSON.parse(raw) as MatrixSession
      if (!session.baseUrl || !session.accessToken || !session.userId || !session.deviceId)
        return undefined
      this.persistSession(session)
      return session
    } catch {
      return undefined
    }
  }

  lastHomeserver() {
    return localStorage.getItem(HOMESERVER_KEY) ?? 'https://matrix.org'
  }

  private persistSession(session: MatrixSession) {
    const serialized = JSON.stringify(session)
    const previous = {
      accounts: localStorage.getItem(ACCOUNTS_KEY),
      roomAccounts: localStorage.getItem(ROOM_ACCOUNTS_KEY),
      localSession: localStorage.getItem(SESSION_KEY),
      tabSession: sessionStorage.getItem(SESSION_KEY),
      activeAccount: localStorage.getItem(ACTIVE_ACCOUNT_KEY),
      presenceModes: localStorage.getItem(PRESENCE_MODES_KEY),
    }
    const restore = (storage: Storage, key: string, value: string | null) => {
      if (value === null) storage.removeItem(key)
      else storage.setItem(key, value)
    }
    const id = this.accountId(session)
    const replacedIds = new Set(
      this.savedAccounts()
        .filter((saved) => this.sameMatrixAccount(saved, session))
        .map((saved) => this.accountId(saved)),
    )
    const accounts = this.savedAccounts().filter(
      (saved) => this.accountId(saved) !== id && !this.sameMatrixAccount(saved, session),
    )
    try {
      localStorage.setItem(ACCOUNTS_KEY, JSON.stringify([...accounts, session]))
      if (replacedIds.size) {
        const selections = Object.fromEntries(
          Object.entries(this.roomAccountSelections()).map(([roomId, accountId]) => [
            roomId,
            replacedIds.has(accountId) ? id : accountId,
          ]),
        )
        localStorage.setItem(ROOM_ACCOUNTS_KEY, JSON.stringify(selections))
        const modes = this.presenceModes()
        const replacementMode =
          modes[id] ??
          [...replacedIds]
            .map((accountId) => modes[accountId])
            .find((mode): mode is PresenceMode => !!mode)
        for (const accountId of replacedIds) delete modes[accountId]
        if (replacementMode) modes[id] = replacementMode
        localStorage.setItem(PRESENCE_MODES_KEY, JSON.stringify(modes))
      }
      if (!this.secondary) {
        localStorage.setItem(SESSION_KEY, serialized)
        sessionStorage.setItem(SESSION_KEY, serialized)
        localStorage.setItem(ACTIVE_ACCOUNT_KEY, id)
      }
    } catch (error) {
      try {
        restore(localStorage, ACCOUNTS_KEY, previous.accounts)
        restore(localStorage, ROOM_ACCOUNTS_KEY, previous.roomAccounts)
        restore(localStorage, SESSION_KEY, previous.localSession)
        restore(sessionStorage, SESSION_KEY, previous.tabSession)
        restore(localStorage, ACTIVE_ACCOUNT_KEY, previous.activeAccount)
        restore(localStorage, PRESENCE_MODES_KEY, previous.presenceModes)
      } catch {
        /* retain the original storage error */
      }
      throw error
    }
    this.backupAccounts()
  }

  selectAccount(accountId: string) {
    const session = this.savedAccounts().find((saved) => this.accountId(saved) === accountId)
    if (!session) throw new Error('Saved account not found')
    this.persistSession(session)
  }

  async logoutAccount(accountId: string) {
    const session = this.savedAccounts().find((saved) => this.accountId(saved) === accountId)
    if (!session) throw new Error('Saved account not found')
    if (accountId === this.activeAccountId()) {
      await this.logout()
      return
    }

    const secondary = this.secondaryClients.get(accountId)
    try {
      if (secondary?.matrixClient) await secondary.matrixClient.logout(true)
      else await this.revokeSession(session)
    } finally {
      await secondary?.stop().catch(() => undefined)
      this.secondaryClients.delete(accountId)
      this.removeSavedAccount(accountId)
      this.backupAccounts()
    }
  }

  async stop() {
    if (!this.secondary) this.stopPresenceTracking()
    for (const service of this.secondaryClients.values()) await service.stop()
    this.secondaryClients.clear()
    this.roomReadOwners.clear()
    if (this.cryptoRetryTimer !== undefined) window.clearTimeout(this.cryptoRetryTimer)
    this.cryptoRetryTimer = undefined
    // A pending decryption-retry batch may already be mid-flight against the crypto store
    // (scheduleAllRoomDecryptionRetry is fire-and-forget). Let it finish before stopping the
    // client and reloading - abandoning it mid-write is what can leave the crypto store's
    // IndexedDB connection in a state the next page load has to wait out. A Matrix decryption
    // attempt can itself stall indefinitely, though, so never let background history recovery
    // prevent account sign-out forever.
    if (this.cryptoRetryInFlight) {
      const inFlight = this.cryptoRetryInFlight
      let timeout: number | undefined
      const completed = await Promise.race([
        inFlight.then(() => true),
        new Promise<false>((resolve) => {
          timeout = window.setTimeout(() => resolve(false), 10_000)
        }),
      ])
      if (timeout !== undefined) window.clearTimeout(timeout)
      if (!completed) {
        console.warn('[crypto] Timed out waiting for background decryption before stopping')
      }
    }
    this.client?.stopClient()
    this.client = undefined
    this.secretStorageKeys.clear()
    this.cryptoSyncRunning = undefined
  }

  async start(session = this.restoreSession()) {
    if (this.startInFlight) return this.startInFlight
    if (this.client) return this.client
    this.startInFlight = this.startClient(session)
    try {
      return await this.startInFlight
    } catch (error) {
      const failedClient = this.client as MatrixClient | undefined
      failedClient?.stopClient()
      this.client = undefined
      throw error
    } finally {
      this.startInFlight = undefined
    }
  }

  private async startClient(session?: MatrixSession) {
    if (!session) throw new Error('No Matrix session is available')
    await this.applyNativeSessionTokens(session)

    const storeIdentity = `${session.userId}-${session.deviceId}`
    const store = new IndexedDBStore({
      indexedDB,
      localStorage,
      dbName: `foxchat-sync-${storeIdentity}`,
    })
    const cryptoStore = new IndexedDBCryptoStore(
      indexedDB,
      `foxchat-legacy-crypto-${storeIdentity}`,
    )
    const client = createClient({
      baseUrl: session.baseUrl,
      accessToken: session.accessToken,
      refreshToken: session.refreshToken,
      tokenRefreshFunction: async (refreshToken) => {
        const response = await fetch(`${session.baseUrl}/_matrix/client/v3/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refresh_token: refreshToken }),
        })
        if (!response.ok) {
          const details = (await response.text()).slice(0, 300)
          throw new Error(
            `Matrix session refresh failed (${response.status})${details ? `: ${details}` : ''}`,
          )
        }
        const tokens = (await response.json()) as {
          access_token: string
          refresh_token?: string
          expires_in_ms?: number
        }
        session.accessToken = tokens.access_token
        session.refreshToken = tokens.refresh_token ?? refreshToken
        session.accessTokenExpiresAt = tokens.expires_in_ms
          ? Date.now() + tokens.expires_in_ms
          : undefined
        if (!this.ephemeral) this.persistSession(session)
        return {
          accessToken: session.accessToken,
          refreshToken: session.refreshToken,
          expiry: session.accessTokenExpiresAt ? new Date(session.accessTokenExpiresAt) : undefined,
        }
      },
      userId: session.userId,
      deviceId: session.deviceId,
      store,
      cryptoStore,
      timelineSupport: true,
      verificationMethods: ['m.sas.v1'],
      cryptoCallbacks: {
        getSecretStorageKey: async ({ keys }) => {
          for (const keyId of Object.keys(keys)) {
            const key = this.secretStorageKeys.get(keyId)
            if (key) return [keyId, new Uint8Array(key)]
          }
          return null
        },
        cacheSecretStorageKey: (keyId, _keyInfo, key) => this.secretStorageKeys.set(keyId, key),
      },
    })
    this.client = client

    await store.startup()

    await client.initRustCrypto({ cryptoDatabasePrefix: `foxchat-crypto-${storeIdentity}` })
    const crypto = client.getCrypto()!
    client.on(CryptoEvent.VerificationRequestReceived, (request) =>
      this.publishVerificationRequest(request),
    )
    client.on(CryptoEvent.KeyBackupDecryptionKeyCached, () => {
      void crypto.checkKeyBackupAndEnable()
      this.scheduleAllRoomDecryptionRetry(true)
    })
    client.on(CryptoEvent.KeysChanged, () => {
      this.observers.forEach((x) => x.onSync?.('CRYPTO_KEYS_CHANGED'))
      scheduleNativeCryptoSync(client, 0)
      this.scheduleAllRoomDecryptionRetry()
    })
    client.on(CryptoEvent.DevicesUpdated, () => {
      this.observers.forEach((x) => x.onSync?.('CRYPTO_DEVICES_UPDATED'))
    })
    client.on(CryptoEvent.UserTrustStatusChanged, (userId) => {
      this.observers.forEach((x) => x.onSync?.(`CRYPTO_USER_TRUST_STATUS_CHANGED:${userId}`))
    })
    client.on(ClientEvent.Sync, (state) => {
      this.observers.forEach((x) => x.onSync?.(String(state)))
      this.retryBackedOffSyncAfterResume(client)
      if (String(state) === 'PREPARED') void this.enableAutomaticKeySync()
    })
    client.on(ClientEvent.Room, (room) => {
      this.trackRoomOwner(client, room)
      this.observers.forEach((observer) => observer.onRoom?.(room))
    })
    const watchDecryption = (event: MatrixEvent, room?: Room) => {
      this.trackEventOwner(client, event, room)
      if (this.watchedEvents.has(event)) return
      this.watchedEvents.add(event)
      event.on(MatrixEventEvent.Decrypted, (decrypted, error) => {
        this.trackEventOwner(client, decrypted, room)
        this.observers.forEach((x) => x.onEvent?.(decrypted, room))
        if (!error) scheduleNativeCryptoSyncForEvent(client, decrypted)
        if (error && room && !this.decryptionRetriesInFlight.has(decrypted))
          this.scheduleDecryptionRetry(decrypted, room)
      })
    }
    client.on(RoomEvent.Timeline, (event, room) => {
      this.trackEventOwner(client, event, room)
      watchDecryption(event, room)
      if (room && event.isDecryptionFailure()) this.scheduleDecryptionRetry(event, room)
      this.observers.forEach((x) => x.onEvent?.(event, room))
    })
    const publishRedaction = (event: MatrixEvent, room: Room) => {
      this.trackEventOwner(client, event, room)
      this.observers.forEach((observer) => observer.onEvent?.(event, room))
    }
    client.on(RoomEvent.Redaction, publishRedaction)
    client.on(RoomEvent.RedactionCancelled, publishRedaction)
    client.on(RoomEvent.Receipt, (event, room) => {
      this.trackEventOwner(client, event, room)
      this.observers.forEach((x) => x.onEvent?.(event, room))
    })
    client.on(RoomEvent.Name, (room) => {
      this.trackRoomOwner(client, room)
      this.observers.forEach((x) => x.onRoom?.(room))
    })
    client.on(RoomEvent.MyMembership, (room) => {
      this.trackRoomOwner(client, room)
      this.observers.forEach((x) => x.onRoom?.(room))
    })
    client.on(RoomEvent.Tags, (_event, room) => {
      this.trackRoomOwner(client, room)
      this.observers.forEach((x) => x.onRoom?.(room))
    })
    client.on(RoomStateEvent.Events, (event) => {
      if (roomImagePackTypes.includes(event.getType() as (typeof roomImagePackTypes)[number])) {
        const roomId = event.getRoomId()
        if (roomId) {
          this.invalidateRoomImagePacks(roomId, client)
          this.observers.forEach((observer) => observer.onImagePacksChanged?.(roomId, client))
        }
        const room = roomId ? client.getRoom(roomId) : undefined
        if (room) {
          this.trackEventOwner(client, event, room)
          this.observers.forEach((observer) => observer.onRoom?.(room))
        }
        return
      }
      if (
        ['m.room.avatar', 'm.room.name', 'm.room.canonical_alias', EventType.SpaceChild].includes(
          event.getType(),
        )
      ) {
        scheduleNativeCryptoSync(client, 0)
      }
      if (event.getType() !== EventType.RoomPinnedEvents) return
      const room = client.getRoom(event.getRoomId())
      if (room) {
        this.trackEventOwner(client, event, room)
        this.observers.forEach((x) => x.onRoom?.(room))
      }
    })
    client.on(RoomStateEvent.Members, (event, _state, member) => {
      const roomId = event.getRoomId() ?? member.roomId
      this.encryptionMembersPrepared.get(client)?.delete(roomId)
      const room = client.getRoom(roomId)
      if (room) {
        this.trackRoomOwner(client, room)
        this.observers.forEach((observer) => observer.onRoom?.(room))
      }
    })
    client.on(RoomMemberEvent.Typing, (_event, member) => {
      const room = client.getRoom(member.roomId)
      if (room) {
        this.trackRoomOwner(client, room)
        this.observers.forEach((x) => x.onRoom?.(room))
      }
    })
    const initialPresence = this.ephemeral
      ? SetPresence.Offline
      : this.effectivePresenceState(this.accountId(session)) === 'online'
        ? SetPresence.Online
        : this.effectivePresenceState(this.accountId(session)) === 'unavailable'
          ? SetPresence.Unavailable
          : SetPresence.Offline
    await client.setSyncPresence(initialPresence)
    const initialSync = this.waitForInitialSync(client)
    await client.startClient({ initialSyncLimit: 30, lazyLoadMembers: true })
    await initialSync
    for (const room of client.getRooms()) this.trackRoomOwner(client, room)
    if (!this.ephemeral) void registerMatrixPush(client).catch(() => undefined)
    if (!this.secondary && this.combinedAccountsEnabled()) await this.startSecondaryAccounts()
    if (!this.secondary && !this.ephemeral) this.startPresenceTracking()
    return client
  }

  private async applyNativeSessionTokens(session: MatrixSession) {
    const invoke = window.__TAURI_INTERNALS__?.invoke
    if (!invoke || !/Android/i.test(navigator.userAgent)) return
    try {
      const native = await invoke<{
        accessToken?: string
        refreshToken?: string
        accessTokenExpiresAt?: number
        refreshedAt?: number
      }>('plugin:remote-push|native_session_tokens', { userId: session.userId })
      if (!native.refreshedAt || !native.accessToken) return
      session.accessToken = native.accessToken
      session.refreshToken = native.refreshToken ?? session.refreshToken
      session.accessTokenExpiresAt = native.accessTokenExpiresAt || undefined
      if (!this.ephemeral) this.persistSession(session)
      console.info('[push] Applied Matrix credentials refreshed by the Android background job', {
        userId: session.userId,
        refreshedAt: native.refreshedAt,
      })
    } catch (error) {
      console.warn('[push] Could not apply Android background Matrix credentials', error)
    }
  }

  private async startSecondaryAccounts() {
    const active = this.restoreSession()
    const activeId = active ? this.accountId(active) : this.activeAccountId()
    const results = await Promise.allSettled(
      this.savedAccounts()
        .filter((session) => this.accountId(session) !== activeId)
        .map(async (session) => {
          const id = this.accountId(session)
          const service = new MatrixClientService(true)
          this.secondaryClients.set(id, service)
          service.subscribe({
            onRoom: (room) => {
              const owner = service.matrixClient
              if (owner) this.trackRoomOwner(owner, room)
              this.observers.forEach((observer) => observer.onRoom?.(room))
            },
            onImagePacksChanged: (roomId, owner) => {
              this.invalidateRoomImagePacks(roomId, owner)
              this.observers.forEach((observer) => observer.onImagePacksChanged?.(roomId, owner))
            },
            onEvent: (event, room) => {
              const owner = service.matrixClient
              if (owner) this.trackEventOwner(owner, event, room)
              this.observers.forEach((observer) => observer.onEvent?.(event, room))
            },
            onVerificationRequest: (request) => this.publishVerificationRequest(request),
            onSync: (state) =>
              this.observers.forEach((observer) => observer.onSync?.(`SECONDARY:${state}`)),
          })
          try {
            await service.start(session)
          } catch (error) {
            this.secondaryClients.delete(id)
            await service.stop().catch(() => undefined)
            throw error
          }
        }),
    )
    for (const result of results)
      if (result.status === 'rejected')
        console.error('[accounts] Could not start a saved account', result.reason)
  }

  subscribe(observer: SyncObserver) {
    this.observers.add(observer)
    if (observer.onVerificationRequest) {
      for (const request of this.verificationRequests) {
        if (
          request.phase !== VerificationPhase.Done &&
          request.phase !== VerificationPhase.Cancelled
        )
          observer.onVerificationRequest(request)
      }
    }
    return () => {
      this.observers.delete(observer)
    }
  }

  private publishVerificationRequest(request: VerificationRequest) {
    if (request.phase === VerificationPhase.Done || request.phase === VerificationPhase.Cancelled)
      return
    this.verificationRequests.add(request)
    if (!this.trackedVerificationRequests.has(request)) {
      this.trackedVerificationRequests.add(request)
      const requestChanged = () => {
        if (
          request.phase === VerificationPhase.Done ||
          request.phase === VerificationPhase.Cancelled
        ) {
          this.verificationRequests.delete(request)
          request.off(VerificationRequestEvent.Change, requestChanged)
          return
        }
        if (request.pending)
          this.observers.forEach((observer) => observer.onVerificationRequest?.(request))
      }
      request.on(VerificationRequestEvent.Change, requestChanged)
    }
    this.observers.forEach((observer) => observer.onVerificationRequest?.(request))
  }

  private roomAccountSelections(): Record<string, string> {
    try {
      return JSON.parse(localStorage.getItem(ROOM_ACCOUNTS_KEY) ?? '{}') as Record<string, string>
    } catch {
      return {}
    }
  }

  roomAccounts(roomId: string) {
    const result: Array<{ id: string; userId: string; client: MatrixClient }> = []
    const active = this.restoreSession()
    if (active && this.client?.getRoom(roomId)?.getMyMembership() === 'join')
      result.push({ id: this.accountId(active), userId: active.userId, client: this.client })
    for (const [id, service] of this.secondaryClients) {
      const client = service.matrixClient
      if (client?.getRoom(roomId)?.getMyMembership() === 'join')
        result.push({ id, userId: client.getSafeUserId(), client })
    }
    return result
  }

  availableAccounts() {
    const result: Array<{ id: string; userId: string; client: MatrixClient }> = []
    const active = this.restoreSession()
    if (active && this.client)
      result.push({ id: this.accountId(active), userId: active.userId, client: this.client })
    for (const [id, service] of this.secondaryClients)
      if (service.matrixClient)
        result.push({
          id,
          userId: service.matrixClient.getSafeUserId(),
          client: service.matrixClient,
        })
    return result
  }

  presenceMode(accountId?: string): PresenceMode {
    return accountId ? (this.presenceModes()[accountId] ?? 'automatic') : 'automatic'
  }

  effectivePresenceState(accountId?: string): PresenceState {
    const mode = this.presenceMode(accountId)
    if (mode === 'online') return 'online'
    if (mode === 'away') return 'unavailable'
    if (mode === 'offline') return 'offline'
    if (document.visibilityState !== 'visible' || !document.hasFocus()) return 'unavailable'
    return Date.now() - this.lastPresenceActivity >= PRESENCE_IDLE_MS ? 'unavailable' : 'online'
  }

  setPresenceMode(accountId: string, mode: PresenceMode) {
    if (!this.availableAccounts().some((account) => account.id === accountId)) {
      throw new Error('Account is not available')
    }
    const modes = this.presenceModes()
    if (mode === 'automatic') delete modes[accountId]
    else modes[accountId] = mode
    localStorage.setItem(PRESENCE_MODES_KEY, JSON.stringify(modes))
    this.backupAccounts()
    window.dispatchEvent(
      new CustomEvent('foxchat-presence-mode-changed', {
        detail: { accountId, mode },
      }),
    )
    const account = this.availableAccounts().find((candidate) => candidate.id === accountId)
    if (account) this.queuePresenceUpdate(account.id, account.client)
  }

  userPresence(userId?: string) {
    if (!userId) return undefined
    const accounts = this.availableAccounts()
    const ownAccounts = accounts.filter((account) => account.userId === userId)
    if (ownAccounts.length > 0) {
      const activeAccountId = this.activeAccountId()
      const ownAccount =
        ownAccounts.find((account) => account.id === activeAccountId) ?? ownAccounts[0]
      return this.effectivePresenceState(ownAccount.id)
    }
    return accounts
      .map((account) => account.client.getUser(userId))
      .filter((user): user is NonNullable<typeof user> => !!user)
      .sort((first, second) => second.lastPresenceTs - first.lastPresenceTs)[0]?.presence
  }

  private queuePresenceUpdate(accountId: string, client: MatrixClient) {
    const previous = this.presenceQueues.get(client) ?? Promise.resolve()
    const next = previous
      .catch(() => undefined)
      .then(async () => {
        const state = this.effectivePresenceState(accountId)
        if (this.appliedPresenceStates.get(client) === state) return
        const syncPresence =
          state === 'online'
            ? SetPresence.Online
            : state === 'unavailable'
              ? SetPresence.Unavailable
              : SetPresence.Offline
        await client.setSyncPresence(syncPresence)
        this.appliedPresenceStates.set(client, state)
        const statusMsg = client.getUser(client.getSafeUserId())?.presenceStatusMsg
        try {
          await client.setPresence({
            presence: state,
            ...(statusMsg ? { status_msg: statusMsg } : {}),
          })
        } catch (error) {
          console.warn(
            '[presence] Immediate presence update failed; sync presence remains active',
            {
              userId: client.getUserId(),
              state,
              error,
            },
          )
        }
      })
    this.presenceQueues.set(client, next)
    void next.catch((error) =>
      console.warn('[presence] Could not update presence', {
        userId: client.getUserId(),
        error,
      }),
    )
  }

  private applyPresenceToAllAccounts() {
    for (const account of this.availableAccounts()) {
      this.queuePresenceUpdate(account.id, account.client)
    }
    window.dispatchEvent(new CustomEvent('foxchat-presence-state-changed'))
  }

  private schedulePresenceIdleCheck() {
    if (this.presenceIdleTimer !== undefined) window.clearTimeout(this.presenceIdleTimer)
    const remaining = Math.max(0, PRESENCE_IDLE_MS - (Date.now() - this.lastPresenceActivity))
    this.presenceIdleTimer = window.setTimeout(() => {
      this.presenceIdleTimer = undefined
      this.applyPresenceToAllAccounts()
    }, remaining + 50)
  }

  private startPresenceTracking() {
    if (this.presenceTrackingCleanup) {
      this.applyPresenceToAllAccounts()
      return
    }
    this.lastPresenceActivity = Date.now()
    const activityEvents = ['pointermove', 'pointerdown', 'keydown', 'touchstart', 'scroll']
    const activity = () => {
      if (document.visibilityState !== 'visible' || !document.hasFocus()) return
      const now = Date.now()
      const wasIdle = now - this.lastPresenceActivity >= PRESENCE_IDLE_MS
      if (!wasIdle && now - this.lastPresenceActivity < 5_000) return
      this.lastPresenceActivity = now
      this.schedulePresenceIdleCheck()
      if (wasIdle) this.applyPresenceToAllAccounts()
    }
    const focused = () => {
      this.lastPresenceActivity = Date.now()
      this.schedulePresenceIdleCheck()
      this.applyPresenceToAllAccounts()
    }
    const unfocused = () => this.applyPresenceToAllAccounts()
    const visibilityChanged = () => {
      if (document.visibilityState === 'visible' && document.hasFocus()) focused()
      else unfocused()
    }
    for (const event of activityEvents) window.addEventListener(event, activity, { passive: true })
    window.addEventListener('focus', focused)
    window.addEventListener('blur', unfocused)
    window.addEventListener('pagehide', unfocused)
    document.addEventListener('visibilitychange', visibilityChanged)
    this.presenceTrackingCleanup = () => {
      for (const event of activityEvents) window.removeEventListener(event, activity)
      window.removeEventListener('focus', focused)
      window.removeEventListener('blur', unfocused)
      window.removeEventListener('pagehide', unfocused)
      document.removeEventListener('visibilitychange', visibilityChanged)
    }
    this.schedulePresenceIdleCheck()
    this.applyPresenceToAllAccounts()
  }

  private stopPresenceTracking() {
    this.presenceTrackingCleanup?.()
    this.presenceTrackingCleanup = undefined
    if (this.presenceIdleTimer !== undefined) window.clearTimeout(this.presenceIdleTimer)
    this.presenceIdleTimer = undefined
    this.appliedPresenceStates = new WeakMap()
    this.presenceQueues = new WeakMap()
  }

  activeAccountClient() {
    const activeId = this.activeAccountId()
    return (
      this.availableAccounts().find((account) => account.id === activeId)?.client ?? this.client
    )
  }

  roomInvites() {
    return this.availableAccounts().flatMap((account) =>
      account.client
        .getRooms()
        .filter((room) => room.getMyMembership() === 'invite')
        .map((room) => {
          const inviteEvent = room.getMember(account.userId)?.events.member
          const inviterId = inviteEvent?.getSender()
          return {
            accountId: account.id,
            accountUserId: account.userId,
            room,
            inviterId,
            inviterName: inviterId ? room.getMember(inviterId)?.name || inviterId : undefined,
          }
        }),
    )
  }

  private accountClient(accountId?: string) {
    if (!accountId) return this.client
    return this.availableAccounts().find((account) => account.id === accountId)?.client
  }

  private clientForRoomAccount(roomId: string, accountId?: string) {
    if (!accountId) return this.clientForRoom(roomId)
    return this.roomAccounts(roomId).find((account) => account.id === accountId)?.client
  }

  selectedRoomAccountId(roomId: string) {
    const choices = this.roomAccounts(roomId)
    const selected = this.roomAccountSelections()[roomId]
    const selectedChoice = choices.find((choice) => choice.id === selected)
    const sendable = choices.find((choice) => {
      const room = choice.client.getRoom(roomId)
      return room?.maySendMessage() === true
    })
    const effective =
      selectedChoice && (!sendable || selectedChoice.client.getRoom(roomId)?.maySendMessage())
        ? selectedChoice
        : (sendable ?? selectedChoice ?? choices[0])
    if (effective && effective.id !== selected) {
      localStorage.setItem(
        ROOM_ACCOUNTS_KEY,
        JSON.stringify({
          ...this.roomAccountSelections(),
          [roomId]: effective.id,
        }),
      )
      this.backupAccounts()
    }
    return effective?.id
  }

  selectRoomAccount(roomId: string, accountId: string, allowPendingJoin = false) {
    const accountAvailable = this.availableAccounts().some((account) => account.id === accountId)
    const accountJoined = this.roomAccounts(roomId).some((choice) => choice.id === accountId)
    if (!accountJoined && !(allowPendingJoin && accountAvailable)) {
      throw new Error('Account is not joined to this room')
    }
    localStorage.setItem(
      ROOM_ACCOUNTS_KEY,
      JSON.stringify({ ...this.roomAccountSelections(), [roomId]: accountId }),
    )
    this.backupAccounts()
    const room = this.room(roomId)
    if (room) this.observers.forEach((observer) => observer.onRoom?.(room))
  }

  clientForRoom(roomId: string) {
    const selected = this.selectedRoomAccountId(roomId)
    return (
      this.roomAccounts(roomId).find((choice) => choice.id === selected)?.client ??
      this.availableAccounts().find((account) => !!account.client.getRoom(roomId))?.client ??
      this.client
    )
  }

  private trackRoomOwner(client: MatrixClient, room: Room) {
    this.applyLocalRoomName(room)
    this.roomOwners.set(room, client)
    for (const event of room.getLiveTimeline().getEvents()) {
      this.eventOwners.set(event, client)
      // IndexedDB restores relation events into the timeline, but its in-memory
      // aggregation can still be empty until those events appear in /sync again.
      room.relations.aggregateChildEvent(event)
    }
  }

  private trackEventOwner(client: MatrixClient, event: MatrixEvent, room?: Room) {
    this.eventOwners.set(event, client)
    if (room) this.roomOwners.set(room, client)
    if (event.getType() === EventType.Reaction) {
      const parentEventId = event.getRelation()?.event_id
      const roomId = event.getRoomId() ?? room?.roomId
      if (roomId && parentEventId) this.rememberReactionParent(roomId, parentEventId)
    }
  }

  clientForRoomInstance(room: Room) {
    const tracked = this.roomOwners.get(room)
    if (tracked) return tracked
    const owner = this.availableAccounts().find(
      (account) => account.client.getRoom(room.roomId) === room,
    )?.client
    if (owner) {
      this.trackRoomOwner(owner, room)
      return owner
    }
    return this.clientForRoom(room.roomId)
  }

  roomIdentity(room: Room) {
    const owner = this.clientForRoomInstance(room)
    const accountId = this.availableAccounts().find((account) => account.client === owner)?.id
    const ownerId =
      accountId ??
      `${owner?.getHomeserverUrl() ?? ''}|${owner?.getUserId() ?? ''}|${owner?.getDeviceId() ?? ''}`
    return `${ownerId}\0${room.roomId}`
  }

  clientForMedia(uri?: string) {
    if (!uri) return this.client
    for (const room of this.rooms()) {
      if (
        room.getMxcAvatarUrl() === uri ||
        room.getJoinedMembers().some((member) => member.getMxcAvatarUrl() === uri)
      )
        return this.clientForRoom(room.roomId)
    }
    return this.client
  }

  private roomReadabilityScore(room: Room) {
    const membershipScore =
      room.getMyMembership() === 'join'
        ? 1_000_000
        : room.getMyMembership() === 'invite'
          ? 500_000
          : 0
    const events = room.getLiveTimeline().getEvents().slice(-100)
    return events.reduce((score, event) => {
      if (event.isDecryptionFailure()) return score - 100
      if (event.isBeingDecrypted()) return score - 10
      if (event.isEncrypted()) return score + 20
      return score + (isVisibleMessageEvent(event) ? 2 : 1)
    }, membershipScore + events.length)
  }

  private roomForReading(roomId: string, joinedOnly = false) {
    const candidates = this.availableAccounts()
      .map((account) => ({
        client: account.client,
        room: account.client.getRoom(roomId),
      }))
      .filter(
        (candidate): candidate is { client: MatrixClient; room: Room } =>
          !!candidate.room && (!joinedOnly || candidate.room.getMyMembership() === 'join'),
      )
    if (!candidates.length) return undefined
    const scores = candidates.map((candidate) => ({
      ...candidate,
      score: this.roomReadabilityScore(candidate.room),
    }))
    const bestScore = Math.max(...scores.map((candidate) => candidate.score))
    const previousOwner = this.roomReadOwners.get(roomId)
    const previousCandidate = scores.find((candidate) => candidate.client === previousOwner)
    const STICKY_SCORE_MARGIN = 15
    const selected =
      previousCandidate && previousCandidate.score >= bestScore - STICKY_SCORE_MARGIN
        ? previousCandidate
        : (scores.find((candidate) => candidate.score === bestScore) ?? scores[0])
    this.roomReadOwners.set(roomId, selected.client)
    this.trackRoomOwner(selected.client, selected.room)
    return selected.room
  }

  private eventReadabilityScore(event: MatrixEvent) {
    if (event.isDecryptionFailure()) return -100
    if (event.isBeingDecrypted()) return -10
    if (event.getType() === EventType.RoomMessageEncrypted) return -5
    return event.isEncrypted() ? 20 : 10
  }

  private eventCopies(event: MatrixEvent) {
    const roomId = event.getRoomId()
    const eventId = event.getId()
    if (!roomId || !eventId) return [event]
    const copies = [event]
    for (const account of this.availableAccounts()) {
      const candidate = account.client.getRoom(roomId)?.findEventById(eventId)
      if (candidate && !copies.includes(candidate)) copies.push(candidate)
    }
    return copies
  }

  eventForReading(event: MatrixEvent) {
    let selected = event
    let selectedScore = this.eventReadabilityScore(event)
    for (const candidate of this.eventCopies(event)) {
      const score = this.eventReadabilityScore(candidate)
      if (score <= selectedScore) continue
      selected = candidate
      selectedScore = score
    }
    return selected
  }

  combinedRoomEvents(room: Room, fallback: MatrixEvent[]) {
    const keyed = new Map<string, MatrixEvent>()
    const unkeyed: MatrixEvent[] = []
    const copies = this.availableAccounts()
      .map((account) => account.client.getRoom(room.roomId))
      .filter((candidate): candidate is Room => !!candidate)
    const sources = [
      fallback,
      ...copies.map((candidate) => candidate.getLiveTimeline().getEvents()),
    ]
    for (const events of sources) {
      for (const event of events) {
        const eventId = event.getId()
        const transactionId = event.getTxnId()
        const key = eventId
          ? `event:${eventId}`
          : transactionId
            ? `txn:${event.getSender() ?? ''}:${transactionId}`
            : undefined
        if (!key) {
          if (!unkeyed.includes(event)) unkeyed.push(event)
          continue
        }
        const existing = keyed.get(key)
        if (!existing || this.eventReadabilityScore(event) > this.eventReadabilityScore(existing)) {
          keyed.set(key, event)
        }
      }
    }
    return [...keyed.values(), ...unkeyed].sort((first, second) => first.getTs() - second.getTs())
  }

  room(roomId: string) {
    return this.roomForReading(roomId)
  }

  joinedRoom(roomId: string) {
    return this.roomForReading(roomId, true)
  }

  rooms() {
    const ids = new Set<string>()
    for (const { client } of this.availableAccounts())
      for (const room of client.getRooms())
        if (room.getMyMembership() === 'join') ids.add(room.roomId)
    return [...ids].map((id) => this.joinedRoom(id)).filter((room): room is Room => !!room)
  }

  spaceChildIds() {
    const ids = new Set<string>()
    for (const { client } of this.availableAccounts())
      for (const space of client.getRooms().filter((room) => room.getType() === RoomType.Space)) {
        for (const event of space.currentState.getStateEvents(EventType.SpaceChild)) {
          if (Array.isArray(event.getContent().via) && event.getStateKey())
            ids.add(event.getStateKey()!)
        }
      }
    return ids
  }

  clientForEvent(event: MatrixEvent) {
    const tracked = this.eventOwners.get(event)
    if (tracked) return tracked
    const roomId = event.getRoomId()
    const eventId = event.getId()
    if (!roomId) return this.client
    const clients = [
      this.client,
      ...[...this.secondaryClients.values()].map((service) => service.matrixClient),
    ].filter((client): client is MatrixClient => !!client)
    if (eventId) {
      const owner = clients.find(
        (client) => client.getRoom(roomId)?.findEventById(eventId) === event,
      )
      if (owner) {
        this.trackEventOwner(owner, event, owner.getRoom(roomId) ?? undefined)
        return owner
      }
    }
    return this.clientForRoom(roomId)
  }

  private clientForEventAuthor(event: MatrixEvent) {
    const roomId = event.getRoomId()
    const sender = event.getSender()
    if (!roomId || !sender) return undefined
    return this.roomAccounts(roomId).find((account) => account.userId === sender)?.client
  }

  private async attemptFailedEventDecryption(event: MatrixEvent) {
    if (!event.isDecryptionFailure()) return
    const backend = (
      this.clientForEvent(event) as unknown as
        | {
            cryptoBackend?: Parameters<MatrixEvent['attemptDecryption']>[0]
          }
        | undefined
    )?.cryptoBackend
    if (!backend) return
    // decryptEventIfNeeded skips events with synthetic failure content.
    await event.attemptDecryption(backend, { isRetry: true })
  }

  async retryEventDecryption(event: MatrixEvent) {
    const roomId = event.getRoomId()
    if (!roomId) return false
    const copies = this.eventCopies(event)
    const clients = new Set(
      copies
        .map((copy) => this.clientForEvent(copy))
        .filter((client): client is MatrixClient => !!client),
    )
    await Promise.allSettled(
      [...clients].map((client) => client.getCrypto()?.checkKeyBackupAndEnable()),
    )
    await Promise.allSettled(
      copies.map(async (copy) => {
        const room = this.clientForEvent(copy)?.getRoom(roomId)
        if (!room || !copy.isDecryptionFailure()) return
        const previousTimer = this.decryptionRetryTimers.get(copy)
        if (previousTimer !== undefined) window.clearTimeout(previousTimer)
        this.decryptionRetryAttempts.delete(copy)
        this.decryptionRetriesInFlight.add(copy)
        try {
          await this.attemptFailedEventDecryption(copy)
        } finally {
          this.decryptionRetriesInFlight.delete(copy)
        }
        if (copy.isDecryptionFailure()) this.scheduleDecryptionRetry(copy, room)
      }),
    )
    return copies.some((copy) => !copy.isDecryptionFailure())
  }

  private scheduleDecryptionRetry(event: MatrixEvent, room: Room, immediate = false) {
    if (!this.client || !event.isDecryptionFailure()) return
    const reason = String(event.decryptionFailureReason ?? '')
    if (
      ![
        'MEGOLM_UNKNOWN_INBOUND_SESSION_ID',
        'OLM_UNKNOWN_MESSAGE_INDEX',
        'HISTORICAL_MESSAGE_WORKING_BACKUP',
      ].includes(reason)
    )
      return
    const previousTimer = this.decryptionRetryTimers.get(event)
    if (previousTimer !== undefined) window.clearTimeout(previousTimer)
    const attempt = this.decryptionRetryAttempts.get(event) ?? 0
    const delays = [1000, 3000, 10000, 30000, 60000]
    if (attempt >= delays.length) return
    const timer = window.setTimeout(
      async () => {
        this.decryptionRetryTimers.delete(event)
        if (!this.client || !event.isDecryptionFailure()) return
        this.decryptionRetryAttempts.set(event, attempt + 1)
        this.decryptionRetriesInFlight.add(event)
        try {
          await this.attemptFailedEventDecryption(event)
        } catch {
          /* the next retry is scheduled below */
        } finally {
          this.decryptionRetriesInFlight.delete(event)
        }
        if (event.isDecryptionFailure()) this.scheduleDecryptionRetry(event, room)
        else {
          this.decryptionRetryAttempts.delete(event)
          this.observers.forEach((observer) => observer.onEvent?.(event, room))
        }
      },
      immediate ? 0 : delays[attempt],
    )
    this.decryptionRetryTimers.set(event, timer)
  }

  private scheduleAllRoomDecryptionRetry(resetAttempts = false) {
    if (this.cryptoRetryTimer !== undefined) return
    this.cryptoRetryTimer = window.setTimeout(
      () => {
        this.cryptoRetryTimer = undefined
        this.cryptoRetryInFlight = Promise.allSettled(
          this.rooms().map((room) => this.retryRoomDecryption(room, resetAttempts)),
        ).finally(() => {
          this.cryptoRetryInFlight = undefined
        })
      },
      resetAttempts ? 250 : 5000,
    )
  }

  async retryRoomDecryption(room: Room, resetAttempts = false) {
    if (!this.client) return
    const failed = room
      .getLiveTimeline()
      .getEvents()
      .filter((event) => event.isDecryptionFailure())
    await Promise.allSettled(
      failed.map(async (event) => {
        const pendingTimer = this.decryptionRetryTimers.get(event)
        if (resetAttempts) {
          if (pendingTimer !== undefined) window.clearTimeout(pendingTimer)
          this.decryptionRetryTimers.delete(event)
          this.decryptionRetryAttempts.delete(event)
        } else if (
          pendingTimer !== undefined ||
          (this.decryptionRetryAttempts.get(event) ?? 0) >= 5
        )
          return
        if (this.decryptionRetriesInFlight.has(event)) return
        this.decryptionRetriesInFlight.add(event)
        try {
          await this.attemptFailedEventDecryption(event)
        } finally {
          this.decryptionRetriesInFlight.delete(event)
        }
        if (event.isDecryptionFailure()) this.scheduleDecryptionRetry(event, room)
      }),
    )
  }

  async restoreKeyBackupWithPassphrase(passphrase: string) {
    const crypto = this.client?.getCrypto()
    if (!crypto) throw new Error('Encryption is not initialized')
    const result = await crypto.restoreKeyBackupWithPassphrase(passphrase)
    await Promise.all(this.rooms().map((room) => this.retryRoomDecryption(room, true)))
    return result
  }

  async restoreKeyBackupWithRecoveryKey(recoveryKey: string) {
    const crypto = this.client?.getCrypto()
    if (!crypto) throw new Error('Encryption is not initialized')
    const backup = await crypto.getKeyBackupInfo()
    if (!backup?.version) throw new Error('No server-side key backup was found')
    const key = decodeRecoveryKey(recoveryKey.trim())
    await crypto.storeSessionBackupPrivateKey(key, backup.version)
    const result = await crypto.restoreKeyBackup()
    await Promise.all(this.rooms().map((room) => this.retryRoomDecryption(room, true)))
    return result
  }

  async unlockSecretStorage(recoveryKey: string) {
    if (!this.client) throw new Error('Encryption is not initialized')
    const key = decodeRecoveryKey(recoveryKey.trim())
    const defaultKey = await this.client.secretStorage.getKey()
    if (!defaultKey) throw new Error('Secret storage is not configured for this account')
    if (!(await this.client.secretStorage.checkKey(key, defaultKey[1])))
      throw new Error('The recovery key is not valid')
    return this.finishSecretStorageUnlock(defaultKey[0], key)
  }

  async unlockSecretStorageWithPassphrase(passphrase: string) {
    if (!this.client) throw new Error('Encryption is not initialized')
    const defaultKey = await this.client.secretStorage.getKey()
    if (!defaultKey) return this.restoreKeyBackupWithPassphrase(passphrase)
    const passphraseInfo = defaultKey[1].passphrase
    if (!passphraseInfo) return this.restoreKeyBackupWithPassphrase(passphrase)
    if (passphraseInfo.algorithm !== 'm.pbkdf2') {
      throw new Error('This recovery passphrase uses an unsupported algorithm')
    }
    const key = await deriveRecoveryKeyFromPassphrase(
      passphrase,
      passphraseInfo.salt,
      passphraseInfo.iterations,
      passphraseInfo.bits,
    )
    if (!(await this.client.secretStorage.checkKey(key, defaultKey[1])))
      throw new Error('The recovery passphrase is not valid')
    return this.finishSecretStorageUnlock(defaultKey[0], key)
  }

  private async finishSecretStorageUnlock(keyId: string, key: Uint8Array) {
    const crypto = this.client?.getCrypto()
    if (!crypto) throw new Error('Encryption is not initialized')
    this.secretStorageKeys.set(keyId, key)
    const bounded = <T>(promise: Promise<T>, label: string, timeoutMs = 60_000) =>
      Promise.race([
        promise,
        new Promise<never>((_, reject) =>
          window.setTimeout(() => reject(new Error(`${label} timed out`)), timeoutMs),
        ),
      ])
    await bounded(
      crypto.loadSessionBackupPrivateKeyFromSecretStorage(),
      'Loading the key-backup secret',
    )
    await bounded(crypto.checkKeyBackupAndEnable(), 'Opening the existing key backup')
    await bounded(this.enableAutomaticKeySync(), 'Starting automatic key synchronization')
    await bounded(crypto.bootstrapCrossSigning({}), 'Loading cross-signing keys')
    window.dispatchEvent(
      new CustomEvent('foxchat-recovery-progress', {
        detail: 'recovery-enabled',
      }),
    )
    // The Rust SDK restores room keys on demand after the backup key is loaded.
    this.scheduleAllRoomDecryptionRetry(true)
    return { total: 0, imported: 0, background: true }
  }

  async setupEncryption(accountPassword?: string) {
    const crypto = this.client?.getCrypto()
    if (!crypto || !this.client) throw new Error('Encryption is not initialized')
    let recoveryKey: string | undefined
    await crypto.bootstrapSecretStorage({
      createSecretStorageKey: async () => {
        const generated = await crypto.createRecoveryKeyFromPassphrase()
        recoveryKey = generated.encodedPrivateKey
        return generated
      },
      setupNewKeyBackup: !(await crypto.getKeyBackupInfo()),
    })
    await crypto.bootstrapCrossSigning({
      authUploadDeviceSigningKeys: (makeRequest) =>
        makeRequest(
          accountPassword
            ? {
                type: 'm.login.password',
                identifier: { type: 'm.id.user', user: this.client!.getSafeUserId() },
                password: accountPassword,
              }
            : null,
        ),
    })
    await crypto.bootstrapSecretStorage({})
    await crypto.checkKeyBackupAndEnable()
    await this.enableAutomaticKeySync()
    return recoveryKey
  }

  async setupKeyBackup(passphrase?: string) {
    const crypto = this.client?.getCrypto()
    if (!crypto || !this.client) throw new Error('Encryption is not initialized')

    const existingBackup = await crypto.getKeyBackupInfo()
    if (existingBackup?.version) {
      throw new Error('An encrypted key backup already exists for this account')
    }

    const secretStorageKey = await this.client.secretStorage.getKey()
    const cachedSecretStorageKey = secretStorageKey
      ? this.secretStorageKeys.get(secretStorageKey[0])
      : undefined
    if (secretStorageKey && !cachedSecretStorageKey) {
      throw new Error(
        'Restore with your recovery key first to unlock secure storage on this device',
      )
    }

    let recoveryKey = cachedSecretStorageKey ? encodeRecoveryKey(cachedSecretStorageKey) : undefined
    await crypto.bootstrapSecretStorage({
      createSecretStorageKey: async () => {
        const generated = await crypto.createRecoveryKeyFromPassphrase(passphrase || undefined)
        recoveryKey = generated.encodedPrivateKey
        return generated
      },
      setupNewKeyBackup: true,
    })
    await crypto.checkKeyBackupAndEnable()
    await this.enableAutomaticKeySync()

    const backup = await crypto.getKeyBackupInfo()
    if (!backup?.version) throw new Error('The homeserver did not create a key backup')
    if (!recoveryKey) throw new Error('The recovery key is not available on this device')
    return { recoveryKey, version: backup.version }
  }

  async enableAutomaticKeySync() {
    if (this.cryptoSyncRunning) return this.cryptoSyncRunning
    const crypto = this.client?.getCrypto()
    if (!crypto) return
    this.cryptoSyncRunning = (async () => {
      await crypto.checkKeyBackupAndEnable().catch(() => undefined)
    })().finally(() => {
      this.cryptoSyncRunning = undefined
    })
    return this.cryptoSyncRunning
  }

  async requestOwnDeviceVerification() {
    const crypto = this.client?.getCrypto()
    if (!crypto) throw new Error('Encryption is not initialized')
    return crypto.requestOwnUserVerification()
  }

  roomVerificationUser(room: Room) {
    const client = this.clientForRoomInstance(room)
    const ownUserId = client?.getUserId()
    if (!client || !ownUserId) return undefined
    const directRooms =
      client.getAccountData(EventType.Direct)?.getContent<Record<string, string[]>>() ?? {}
    return Object.entries(directRooms).find(
      ([userId, roomIds]) =>
        userId !== ownUserId && Array.isArray(roomIds) && roomIds.includes(room.roomId),
    )?.[0]
  }

  async requestRoomVerification(room: Room) {
    const client = this.clientForRoomInstance(room)
    if (!client) throw new Error('The account for this room is not available')
    const userId = this.roomVerificationUser(room)
    if (!userId) {
      throw new Error('User verification can only be started from a direct chat')
    }
    const crypto = client.getCrypto()
    if (!crypto) throw new Error('Encryption is not initialized')
    const request = await crypto.requestVerificationDM(userId, room.roomId)
    this.publishVerificationRequest(request)
    return request
  }

  openRoomVerification(room: Room) {
    const client = this.clientForRoomInstance(room)
    const request = client
      ?.getCrypto()
      ?.findVerificationRequestDMInProgress(room.roomId, this.roomVerificationUser(room))
    if (!request?.pending) {
      throw new Error('This verification request is no longer active')
    }
    this.publishVerificationRequest(request)
    return request
  }

  async getDeviceSessions(): Promise<MatrixDeviceSession[]> {
    if (!this.client) throw new Error('Client is not started')
    const userId = this.client.getSafeUserId()
    const [serverDevices, cryptoDevices] = await Promise.all([
      this.client.getDevices(),
      this.client.getCrypto()?.getUserDeviceInfo([userId], true),
    ])
    const cryptographic = cryptoDevices?.get(userId)
    return Promise.all(
      serverDevices.devices.map(async (device) => {
        const status = cryptographic?.has(device.device_id)
          ? await this.client!.getCrypto()?.getDeviceVerificationStatus(userId, device.device_id)
          : null
        return {
          deviceId: device.device_id,
          displayName: device.display_name || 'Unnamed device',
          lastSeenIp: device.last_seen_ip,
          lastSeenTs: device.last_seen_ts,
          userAgent:
            device['org.matrix.msc3852.last_seen_user_agent'] ?? device.last_seen_user_agent,
          current: device.device_id === this.client!.getDeviceId(),
          verified: status?.isVerified() ?? false,
          crossSigned: status?.crossSigningVerified ?? false,
          signedByOwner: status?.signedByOwner ?? false,
          locallyVerified: status?.localVerified ?? false,
        }
      }),
    )
  }

  async getSecurityStatus(): Promise<MatrixSecurityStatus> {
    const crypto = this.client?.getCrypto()
    if (!crypto || !this.client) throw new Error('Encryption is not initialized')
    const [
      ready,
      crossSigning,
      backupInfo,
      activeBackupVersion,
      backupKey,
      secretStorageKey,
      secretStorageReady,
      dehydrationSupported,
    ] = await Promise.all([
      crypto.isCrossSigningReady(),
      crypto.getCrossSigningStatus(),
      crypto.getKeyBackupInfo(),
      crypto.getActiveSessionBackupVersion(),
      crypto.getSessionBackupPrivateKey(),
      this.client.secretStorage.getKey(),
      crypto.isSecretStorageReady(),
      crypto.isDehydrationSupported().catch(() => false),
    ])
    const keyBackupVersion = backupInfo?.version ?? null
    return {
      crossSigningReady: ready,
      publicCrossSigningKeys: crossSigning.publicKeysOnDevice,
      privateKeysInSecretStorage: crossSigning.privateKeysInSecretStorage,
      privateKeysCachedLocally: Object.values(crossSigning.privateKeysCachedLocally).every(Boolean),
      keyBackupVersion,
      keyBackupActive: !!keyBackupVersion && activeBackupVersion === keyBackupVersion,
      hasBackupKey: !!backupKey,
      hasSecretStorageKey: !!secretStorageKey,
      secretStorageKeyCached: !!secretStorageKey && this.secretStorageKeys.has(secretStorageKey[0]),
      secretStorageReady,
      dehydrationSupported,
    }
  }

  async getRoomMemberSecurity(room: Room): Promise<{
    viewingAs: string
    members: MatrixRoomMemberSecurity[]
  }> {
    const client = this.clientForRoomInstance(room)
    const crypto = client?.getCrypto()
    if (!client || !crypto) throw new Error('Encryption is not initialized')
    await room.loadMembersIfNeeded()
    const roomMembers = room.getJoinedMembers()
    const userIds = roomMembers.map((member) => member.userId)
    const devicesByUser = await crypto.getUserDeviceInfo(userIds, true)
    const members = await Promise.all(
      roomMembers.map(async (member) => {
        const [identity, crossSigningKeys] = await Promise.all([
          crypto.getUserVerificationStatus(member.userId).catch(() => undefined),
          crypto.getUserCrossSigningKeys(member.userId).catch(() => null),
        ])
        const devices = await Promise.all(
          [...(devicesByUser.get(member.userId)?.values() ?? [])].map(async (device) => {
            const status = await crypto
              .getDeviceVerificationStatus(member.userId, device.deviceId)
              .catch(() => null)
            return {
              deviceId: device.deviceId,
              displayName: device.displayName || 'Unnamed device',
              algorithms: device.algorithms,
              fingerprint: device.getFingerprint(),
              identityKey: device.getIdentityKey(),
              dehydrated: device.dehydrated,
              blocked: device.verified === DeviceVerification.Blocked,
              verified: status?.isVerified() ?? false,
              crossSigningVerified: status?.crossSigningVerified ?? false,
              signedByOwner: status?.signedByOwner ?? false,
              locallyVerified: status?.localVerified ?? false,
              tofu: status?.tofu ?? false,
              signatures: [...device.signatures].flatMap(([signer, signatures]) =>
                [...signatures].map(([keyId, signature]) => ({
                  signer,
                  keyId,
                  signature,
                })),
              ),
            }
          }),
        )
        const publicCrossSigningKeys = Object.entries(crossSigningKeys ?? {}).map(
          ([type, keyInfo]) => {
            const [keyId, key] = Object.entries(keyInfo.keys)[0] ?? ['', '']
            return {
              type,
              usage: keyInfo.usage,
              keyId,
              key,
              signatures: Object.entries(keyInfo.signatures ?? {}).flatMap(([signer, signatures]) =>
                Object.entries(signatures).map(([signatureKeyId, signature]) => ({
                  signer,
                  keyId: signatureKeyId,
                  signature,
                })),
              ),
            }
          },
        )
        return {
          userId: member.userId,
          displayName: member.name || member.userId,
          avatarUrl: member.getMxcAvatarUrl(),
          identity: {
            known: identity?.known ?? false,
            verified: identity?.isVerified() ?? false,
            crossSigningVerified: identity?.isCrossSigningVerified() ?? false,
            previouslyVerified: identity?.wasCrossSigningVerified() ?? false,
            needsApproval: identity?.needsUserApproval ?? false,
          },
          crossSigningKeys: publicCrossSigningKeys,
          devices: devices.sort(
            (first, second) =>
              first.displayName.localeCompare(second.displayName) ||
              first.deviceId.localeCompare(second.deviceId),
          ),
        }
      }),
    )
    return {
      viewingAs: client.getSafeUserId(),
      members: members.sort(
        (first, second) =>
          first.displayName.localeCompare(second.displayName) ||
          first.userId.localeCompare(second.userId),
      ),
    }
  }

  async renameDevice(deviceId: string, displayName: string) {
    if (!this.client) throw new Error('Client is not started')
    await this.client.setDeviceDetails(deviceId, { display_name: displayName })
  }

  async deviceDeletionAccountManagementUri() {
    if (!this.client) return undefined
    try {
      const metadata = await this.client.getAuthMetadata()
      return metadata.account_management_uri &&
        metadata.account_management_actions_supported?.includes(DEVICE_DELETE_ACTION)
        ? metadata.account_management_uri
        : undefined
    } catch {
      // Legacy homeservers use the UIA fallback below.
      return undefined
    }
  }

  async deleteDevice(deviceId: string, password?: string, session?: string) {
    if (!this.client) throw new Error('Client is not started')
    const auth = password
      ? {
          type: 'm.login.password',
          identifier: { type: 'm.id.user', user: this.client.getSafeUserId() },
          password,
          session,
        }
      : undefined
    await this.client.deleteDevice(deviceId, auth)
  }

  async getProfile() {
    if (!this.client) throw new Error('Client is not started')
    return this.client.getProfileInfo(this.client.getSafeUserId())
  }

  async setDisplayName(displayName: string) {
    if (!this.client) throw new Error('Client is not started')
    await this.client.setDisplayName(displayName)
  }

  async setChatBackground(file?: File) {
    if (!this.client) throw new Error('Matrix client is not ready')
    if (!file) {
      await this.client.setAccountData('chat.foxchat.appearance' as never, {} as never)
      return undefined
    }
    if (!file.type.startsWith('image/')) throw new Error('Choose an image file')
    const upload = await this.client.uploadContent(file, { name: file.name, type: file.type })
    const background = {
      url: upload.content_uri,
      name: file.name,
      info: { mimetype: file.type, size: file.size },
    }
    await this.client.setAccountData(
      'chat.foxchat.appearance' as never,
      { chat_background: background } as never,
    )
    return background
  }

  private async prepareEncryptionMembers(client: MatrixClient, roomId: string) {
    const room = client.getRoom(roomId)
    if (!room?.hasEncryptionStateEvent()) return
    let prepared = this.encryptionMembersPrepared.get(client)
    if (!prepared) {
      prepared = new Set()
      this.encryptionMembersPrepared.set(client, prepared)
    }
    if (prepared.has(roomId)) return
    // Refresh lazy-loaded members before sharing an existing Megolm session.
    await room.clearLoadedMembersIfNeeded()
    await room.loadMembersIfNeeded()
    prepared.add(roomId)
  }

  private queueSend<T>(roomId: string, task: () => Promise<T>, client?: MatrixClient): Promise<T> {
    const previous = this.sendQueues.get(roomId) ?? Promise.resolve()
    const execute = async () => {
      if (client) await this.prepareEncryptionMembers(client, roomId)
      return task()
    }
    const result = previous.then(execute, execute)
    this.sendQueues.set(
      roomId,
      result.then(
        () => undefined,
        () => undefined,
      ),
    )
    return result
  }

  async sendText(roomId: string, body: string, accountId?: string) {
    const client = this.clientForRoomAccount(roomId, accountId)
    if (!client) throw new Error('Client is not started')
    return this.queueSend(
      roomId,
      () => client.sendEvent(roomId, EventType.RoomMessage, { msgtype: MsgType.Text, body }),
      client,
    )
  }

  async sendLocation(roomId: string, lat: number, lon: number, accountId?: string) {
    const client = this.clientForRoomAccount(roomId, accountId)
    if (!client) throw new Error('Client is not started')
    const content = ContentHelpers.makeLocationContent(undefined, `geo:${lat},${lon}`, Date.now())
    return this.queueSend(
      roomId,
      () => client.sendEvent(roomId, EventType.RoomMessage, content as never),
      client,
    )
  }

  async reportEvent(roomId: string, eventId: string, reason: string) {
    const client = this.clientForRoom(roomId)
    if (!client) throw new Error('Client is not started')
    await client.reportEvent(roomId, eventId, -100, reason)
  }

  async sendPoll(
    roomId: string,
    accountId: string,
    question: string,
    answers: string[],
    options: { disclosed?: boolean; maxSelections?: number } = {},
  ) {
    const client = this.clientForRoomAccount(roomId, accountId)
    if (!client) throw new Error('Account is not available')
    return this.queueSend(
      roomId,
      () =>
        client.sendEvent(roomId, M_POLL_START.name, {
          [M_POLL_START.name]: {
            question: { 'm.text': question },
            kind: options.disclosed ? 'm.poll.disclosed' : 'm.poll.undisclosed',
            max_selections:
              options.maxSelections && options.maxSelections > 1 ? options.maxSelections : 1,
            answers: answers.map((text, index) => ({ id: `a${index}`, 'm.text': text })),
          },
        } as never),
      client,
    )
  }

  async votePoll(roomId: string, pollEventId: string, answerIds: string[]) {
    const client = this.clientForRoom(roomId)
    if (!client) throw new Error('Client is not started')
    return client.sendEvent(
      roomId,
      M_POLL_RESPONSE.name as never,
      {
        [M_POLL_RESPONSE.name]: { answers: answerIds },
        'm.relates_to': { rel_type: RelationType.Reference, event_id: pollEventId },
      } as never,
    )
  }

  async endPoll(roomId: string, pollEventId: string) {
    const client = this.clientForRoom(roomId)
    if (!client) throw new Error('Client is not started')
    return client.sendEvent(
      roomId,
      M_POLL_END.name as never,
      {
        [M_POLL_END.name]: {},
        'm.relates_to': { rel_type: RelationType.Reference, event_id: pollEventId },
      } as never,
    )
  }

  loadReplyEvent(roomId: string, eventId: string) {
    const client = this.clientForRoom(roomId)
    const room = client?.getRoom(roomId)
    const existing = room?.findEventById(eventId)
    if (existing) return Promise.resolve(existing)
    if (!client) return Promise.resolve(undefined)
    const key = `${client.getSafeUserId()}\u0000${roomId}\u0000${eventId}`
    const cached = this.replyEventCache.get(key)
    if (cached) return cached
    const request = client
      .fetchRoomEvent(roomId, eventId)
      .then(async (raw) => {
        const mapper = client.getEventMapper()
        const fetched = mapper({ ...raw, room_id: roomId } as Parameters<typeof mapper>[0])
        await client.decryptEventIfNeeded(fetched).catch(() => undefined)
        return fetched
      })
      .catch((error) => {
        this.replyEventCache.delete(key)
        console.warn('[replies] Could not preload replied-to event', { roomId, eventId, error })
        return undefined
      })
    this.replyEventCache.set(key, request)
    return request
  }

  roomThreads(room: Room) {
    return room.getThreads()
  }

  async sendThreadReply(roomId: string, accountId: string, threadRootId: string, body: string) {
    const client = this.clientForRoomAccount(roomId, accountId)
    if (!client) throw new Error('Account is not available')
    return this.queueSend(
      roomId,
      () => client.sendMessage(roomId, threadRootId, { msgtype: MsgType.Text, body }),
      client,
    )
  }

  async sendInlineEmote(
    roomId: string,
    body: string,
    url: string,
    reply?: MatrixEvent,
    accountId?: string,
  ) {
    const client = this.clientForRoomAccount(roomId, accountId)
    if (!client) throw new Error('Client is not started')
    const replyId = reply?.getId()
    const escapeHtml = (value: string) =>
      value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
    return client.sendEvent(roomId, EventType.RoomMessage, {
      msgtype: MsgType.Text,
      body,
      format: 'org.matrix.custom.html',
      formatted_body: `<img data-mx-emoticon src="${escapeHtml(url)}" alt="${escapeHtml(body)}" title="${escapeHtml(body)}" height="32">`,
      ...(replyId ? { 'm.relates_to': { 'm.in_reply_to': { event_id: replyId } } } : {}),
    })
  }

  async sendTextWithEmotes(
    roomId: string,
    body: string,
    emotes: Array<{ token: string; url: string; body: string }>,
    reply?: MatrixEvent,
    accountId?: string,
  ) {
    const client = this.clientForRoomAccount(roomId, accountId)
    if (!client) throw new Error('Client is not started')
    const escapeHtml = (value: string) =>
      value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
    const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const byToken = new Map(emotes.map((emote) => [emote.token, emote]))
    const tokens = [...byToken.keys()].sort((a, b) => b.length - a.length)
    const pattern = new RegExp(tokens.map(escapeRegExp).join('|'), 'g')
    let cursor = 0
    let formattedBody = ''
    for (const match of body.matchAll(pattern)) {
      const index = match.index ?? cursor
      const emote = byToken.get(match[0])!
      formattedBody += escapeHtml(body.slice(cursor, index)).replace(/\n/g, '<br>')
      formattedBody += `<img data-mx-emoticon src="${escapeHtml(emote.url)}" alt="${escapeHtml(emote.token)}" title="${escapeHtml(emote.body)}" height="32">`
      cursor = index + match[0].length
    }
    formattedBody += escapeHtml(body.slice(cursor)).replace(/\n/g, '<br>')
    const replyId = reply?.getId()
    return this.queueSend(
      roomId,
      () =>
        client.sendEvent(roomId, EventType.RoomMessage, {
          msgtype: MsgType.Text,
          body,
          format: 'org.matrix.custom.html',
          formatted_body: formattedBody,
          ...(replyId ? { 'm.relates_to': { 'm.in_reply_to': { event_id: replyId } } } : {}),
        }),
      client,
    )
  }

  private reactionParentKey(roomId: string, eventId: string) {
    return `${roomId}\n${eventId}`
  }

  private reactionParentKeys() {
    try {
      const parsed = JSON.parse(localStorage.getItem(REACTION_PARENT_CACHE_KEY) ?? '[]')
      return new Set(
        Array.isArray(parsed)
          ? parsed.filter((value): value is string => typeof value === 'string')
          : [],
      )
    } catch {
      return new Set<string>()
    }
  }

  private storeReactionParentKeys(keys: Set<string>) {
    try {
      localStorage.setItem(
        REACTION_PARENT_CACHE_KEY,
        JSON.stringify([...keys].slice(-REACTION_PARENT_CACHE_LIMIT)),
      )
    } catch {}
  }

  private rememberReactionParent(roomId: string, eventId: string) {
    const key = this.reactionParentKey(roomId, eventId)
    const keys = this.reactionParentKeys()
    keys.delete(key)
    keys.add(key)
    this.storeReactionParentKeys(keys)
  }

  private forgetReactionParent(roomId: string, eventId: string) {
    const keys = this.reactionParentKeys()
    if (!keys.delete(this.reactionParentKey(roomId, eventId))) return
    this.storeReactionParentKeys(keys)
  }

  async sendReaction(event: MatrixEvent, key: string) {
    const roomId = event.getRoomId()
    const eventId = event.getId()
    if (!roomId || !eventId) throw new Error('Cannot react to an unsent message')
    const client = this.clientForRoom(roomId)
    if (!client) throw new Error('Client is not started')
    const response = await client.sendEvent(roomId, EventType.Reaction, {
      'm.relates_to': { rel_type: RelationType.Annotation, event_id: eventId, key },
    })
    this.rememberReactionParent(roomId, eventId)
    return response
  }

  mayHaveReactions(event: MatrixEvent) {
    const roomId = event.getRoomId()
    const eventId = event.getId()
    if (!roomId || !eventId) return false
    return (
      event.getServerAggregatedRelation(RelationType.Annotation) !== undefined ||
      this.reactionParentKeys().has(this.reactionParentKey(roomId, eventId))
    )
  }

  loadReactions(event: MatrixEvent) {
    const roomId = event.getRoomId()
    const eventId = event.getId()
    if (!roomId || !eventId) return Promise.resolve()
    const client = this.clientForEvent(event) ?? this.clientForRoom(roomId)
    if (!client) return Promise.resolve()
    const cacheKey = this.reactionParentKey(roomId, eventId)
    const existing = this.reactionLoads.get(cacheKey)
    if (existing) return existing
    const load = (async () => {
      const events: MatrixEvent[] = []
      const seenTokens = new Set<string>()
      let from: string | undefined
      do {
        const page = await client.relations(
          roomId,
          eventId,
          RelationType.Annotation,
          EventType.Reaction,
          { dir: Direction.Backward, from, limit: 100 },
        )
        events.push(...page.events)
        from = page.nextBatch && !seenTokens.has(page.nextBatch) ? page.nextBatch : undefined
        if (from) seenTokens.add(from)
      } while (from)

      const room = client.getRoom(roomId)
      if (!room) return
      for (const reaction of events) {
        this.trackEventOwner(client, reaction, room)
        room.relations.aggregateChildEvent(reaction)
      }
      if (events.length === 0) this.forgetReactionParent(roomId, eventId)
      this.observers.forEach((observer) => observer.onEvent?.(event, room))
    })().catch((error) => {
      this.reactionLoads.delete(cacheKey)
      throw error
    })
    this.reactionLoads.set(cacheKey, load)
    return load
  }

  async sendReply(roomId: string, body: string, event: MatrixEvent, accountId?: string) {
    const eventId = event.getId()
    const client = this.clientForRoomAccount(roomId, accountId)
    if (!client || !eventId) throw new Error('Cannot reply to this message')
    return this.queueSend(
      roomId,
      () =>
        client.sendEvent(roomId, EventType.RoomMessage, {
          msgtype: MsgType.Text as MsgType.Text,
          body,
          'm.relates_to': { 'm.in_reply_to': { event_id: eventId } },
        }),
      client,
    )
  }

  // Preserve thread relations and the reply currently shown by the composer.
  async editMessage(event: MatrixEvent, body: string, replyToEventId?: string) {
    const roomId = event.getRoomId()
    const eventId = event.getId()
    const client = this.clientForEventAuthor(event)
    if (!client || !roomId || !eventId) throw new Error('Cannot edit this message')
    const txnId = client.makeTxnId()
    const originalRelation = event.getOriginalContent()['m.relates_to'] as
      | { rel_type?: string; 'm.in_reply_to'?: { event_id: string } }
      | undefined
    const relatesTo = originalRelation?.rel_type
      ? originalRelation
      : replyToEventId
        ? { 'm.in_reply_to': { event_id: replyToEventId } }
        : undefined
    const newContent = {
      msgtype: MsgType.Text as MsgType.Text,
      body,
      ...(relatesTo ? { 'm.relates_to': relatesTo } : {}),
    }
    return this.queueSend(
      roomId,
      async () => {
        const room = client.getRoom(roomId)
        const send = client.sendEvent(
          roomId,
          EventType.RoomMessage,
          {
            msgtype: MsgType.Text,
            body: `* ${body}`,
            'm.new_content': newContent,
            'm.relates_to': { rel_type: RelationType.Replace, event_id: eventId },
          },
          txnId,
        )
        // Capture the local echo before /sync can detach the relation event. Matrix compares
        // replacement timestamps, so a homeserver clock ahead of the device can otherwise make
        // a later local edit look older until its remote echo arrives.
        const replacement = room?.getEventForTxnId(txnId)
        const response = await send
        if (replacement) {
          event.makeReplaced(replacement)
          this.observers.forEach((observer) => observer.onEvent?.(event, room ?? undefined))
        }
        return response
      },
      client,
    )
  }

  async sendSticker(
    roomId: string,
    body: string,
    url: string,
    info?: ImageInfo,
    reply?: MatrixEvent,
    accountId?: string,
  ) {
    const client = this.clientForRoomAccount(roomId, accountId)
    if (!client) throw new Error('Client is not started')
    const replyId = reply?.getId()
    return this.queueSend(
      roomId,
      () =>
        client.sendEvent(roomId, EventType.Sticker, {
          body,
          url,
          info: info ?? {},
          ...(replyId ? { 'm.relates_to': { 'm.in_reply_to': { event_id: replyId } } } : {}),
        }),
      client,
    )
  }

  async redactMessage(event: MatrixEvent) {
    const roomId = event.getRoomId()
    const eventId = event.getId()
    if (!roomId || !eventId) throw new Error('Cannot remove this message')
    const client = this.clientForEventAuthor(event) ?? this.clientForRoom(roomId)
    if (!client) throw new Error('Cannot remove this message')
    const room = client.getRoom(roomId)
    const relation = event.getRelation()
    const response = await client.redactEvent(roomId, eventId)
    if (room && relation?.event_id && relation.rel_type) {
      await room.relations
        .getChildEventsForEvent(relation.event_id, relation.rel_type, event.getType())
        ?.removeEvent(event)
    }
    this.observers.forEach((observer) => observer.onEvent?.(event, room ?? undefined))
    return response
  }

  async setPinned(event: MatrixEvent, pinned: boolean) {
    const roomId = event.getRoomId()
    const eventId = event.getId()
    if (!roomId || !eventId) throw new Error('Cannot pin this message')
    const client = this.clientForRoom(roomId)
    const room = client?.getRoom(roomId)
    if (!client || !room) throw new Error('Cannot pin this message')
    const current =
      room.currentState
        .getStateEvents(EventType.RoomPinnedEvents, '')
        ?.getContent<{ pinned?: string[] }>()?.pinned ?? []
    const next = pinned
      ? current.includes(eventId)
        ? current
        : [...current, eventId]
      : current.filter((id) => id !== eventId)
    return client.sendStateEvent(roomId, EventType.RoomPinnedEvents, { pinned: next }, '')
  }

  cancelPendingMessage(event: MatrixEvent): boolean {
    const client = this.clientForEvent(event)
    if (!client) return false
    if (
      ![EventStatus.QUEUED, EventStatus.NOT_SENT, EventStatus.ENCRYPTING].includes(
        event.status as EventStatus,
      )
    )
      return false
    client.cancelPendingEvent(event)
    return true
  }

  async muteRoom(roomId: string, muted: boolean) {
    await this.clientForRoom(roomId)?.setRoomMutePushRule('global', roomId, muted)
  }

  getRoomNotificationMode(roomId: string): RoomNotificationMode {
    const rule = this.clientForRoom(roomId)?.getRoomPushRule('global', roomId)
    if (rule?.actions.includes(PushRuleActionName.DontNotify)) return 'none'
    if (rule?.actions.includes(PushRuleActionName.Notify)) return 'all'
    return 'mentions'
  }

  private notificationTargets(
    client: MatrixClient,
    roomId: string,
    seen = new Set<string>(),
  ): string[] {
    if (seen.has(roomId)) return []
    seen.add(roomId)
    const room = client.getRoom(roomId)
    if (room?.getType() !== RoomType.Space) return [roomId]
    const children = room.currentState
      .getStateEvents(EventType.SpaceChild)
      .filter((event) => Array.isArray(event.getContent().via))
      .flatMap((event) => this.notificationTargets(client, event.getStateKey() ?? '', seen))
    return [roomId, ...children]
  }

  async setRoomNotificationMode(roomId: string, mode: RoomNotificationMode, accountId?: string) {
    const client = this.clientForRoomAccount(roomId, accountId)
    if (!client) throw new Error('Matrix client is not ready')
    const targets = this.notificationTargets(client, roomId)
    await Promise.all(
      targets.map(async (targetId) => {
        const existing = client.getRoomPushRule('global', targetId)
        if (existing)
          await client.deletePushRule('global', PushRuleKind.RoomSpecific, existing.rule_id)
        if (mode === 'none') {
          await client.addPushRule('global', PushRuleKind.RoomSpecific, targetId, {
            actions: [PushRuleActionName.DontNotify],
          })
        } else if (mode === 'all') {
          await client.addPushRule('global', PushRuleKind.RoomSpecific, targetId, {
            actions: [PushRuleActionName.Notify, { set_tweak: TweakName.Sound, value: 'default' }],
          })
        }
      }),
    )
    for (const targetId of targets) {
      const room = client.getRoom(targetId)
      if (room) this.observers.forEach((observer) => observer.onRoom?.(room))
    }
  }

  async setPinnedRoomOrder(roomIds: string[]) {
    await Promise.all(
      roomIds.map(async (roomId, index) => {
        const client = this.clientForRoom(roomId)
        if (!client?.getRoom(roomId)) throw new Error('The room account is not available')
        await client.setRoomTag(roomId, 'm.favourite', {
          order: (index + 1) / (roomIds.length + 1),
        })
      }),
    )
  }

  async uploadImagePackFiles(files: File[]) {
    if (!this.client) throw new Error('Matrix client is not ready')
    return Promise.all(
      files.map(async (file) => {
        const upload = await this.client!.uploadContent(file, { name: file.name, type: file.type })
        return {
          body: file.name.replace(/\.[^.]+$/, ''),
          url: upload.content_uri,
          info: { mimetype: file.type, size: file.size },
        }
      }),
    )
  }

  async savePersonalImagePack(content: Record<string, unknown>) {
    if (!this.client) throw new Error('Matrix client is not ready')
    await this.client.setAccountData('im.ponies.user_emotes' as never, content as never)
  }

  imagePackOrder(client = this.client) {
    const order = client
      ?.getAccountData(IMAGE_PACK_ORDER_EVENT as never)
      ?.getContent<{ order?: unknown }>().order
    if (!Array.isArray(order)) return []
    return [...new Set(order.filter((key): key is string => typeof key === 'string' && !!key))]
  }

  async setImagePackOrder(order: string[], client = this.client) {
    if (!client) throw new Error('Matrix client is not ready')
    await client.setAccountData(
      IMAGE_PACK_ORDER_EVENT as never,
      {
        order: [...new Set(order)],
      } as never,
    )
  }

  async saveRoomImagePack(
    roomId: string,
    content: Record<string, unknown>,
    stateKey = '',
    eventType: (typeof roomImagePackTypes)[number] = 'im.ponies.room_emotes',
  ) {
    const client = this.clientForRoom(roomId)
    if (!client) throw new Error('Matrix client is not ready')
    const splitSizingFields = {
      'chat.foxchat.split_pack': {
        root_state_key: stateKey,
        part: Number.MAX_SAFE_INTEGER,
        total: Number.MAX_SAFE_INTEGER,
      },
    }
    const chunks = splitImagePackContent(content, IMAGE_PACK_STATE_TARGET_BYTES, splitSizingFields)
    const partPrefix = `${stateKey || 'default'}.foxchat-part.`
    const existing = await client.roomState(roomId)
    const nextStateKeys = chunks.map((_, index) =>
      index === 0 ? stateKey : `${partPrefix}${index + 1}`,
    )
    for (const [index, chunk] of chunks.entries()) {
      const splitChunk =
        chunks.length === 1
          ? chunk
          : {
              ...chunk,
              'chat.foxchat.split_pack': {
                root_state_key: stateKey,
                part: index + 1,
                total: chunks.length,
              },
            }
      if (jsonByteLength(splitChunk) > IMAGE_PACK_STATE_TARGET_BYTES)
        throw new Error(`Image pack state fragment exceeds ${IMAGE_PACK_STATE_TARGET_BYTES} bytes`)
      await client.sendStateEvent(
        roomId,
        eventType as never,
        splitChunk as never,
        nextStateKeys[index],
      )
    }
    const obsoleteParts = existing
      .filter((event) => event.type === eventType)
      .map((event) => event.state_key ?? '')
      .filter(
        (existingStateKey) =>
          existingStateKey.startsWith(partPrefix) && !nextStateKeys.includes(existingStateKey),
      )
    for (const obsoleteStateKey of obsoleteParts)
      await client.sendStateEvent(roomId, eventType as never, {} as never, obsoleteStateKey)
    this.invalidateRoomImagePacks(roomId, client)
    await this.roomImagePacks(roomId, client, true)
  }

  invalidateRoomImagePacks(roomId: string, client = this.clientForRoom(roomId)) {
    if (!client) return
    this.imagePackLists.get(client)?.delete(roomId)
  }

  async roomImagePacks(
    roomId: string,
    client = this.clientForRoom(roomId),
    force = false,
  ): Promise<RoomImagePackLocation[]> {
    if (!client) return []
    const cache = this.imagePackLists.get(client) ?? new Map()
    if (!this.imagePackLists.has(client)) this.imagePackLists.set(client, cache)
    const cached = cache.get(roomId)
    if (!force && cached && Date.now() - cached.loadedAt < IMAGE_PACK_LIST_TTL_MS)
      return cached.packs

    const loads = this.imagePackListLoads.get(client) ?? new Map()
    if (!this.imagePackListLoads.has(client)) this.imagePackListLoads.set(client, loads)
    const pending = loads.get(roomId)
    if (pending)
      return force ? pending.then(() => this.roomImagePacks(roomId, client, true)) : pending

    const load = client
      .roomState(roomId)
      .then((events) => {
        const packs = roomImagePacksFromStateEvents(events as RoomImagePackStateEvent[])
        cache.set(roomId, { loadedAt: Date.now(), packs })
        return packs
      })
      .catch(() => {
        const known = client.getRoom(roomId)
        return cached?.packs ?? (known ? findRoomImagePacks(known) : [])
      })
      .finally(() => loads.delete(roomId))
    loads.set(roomId, load)
    return load
  }

  async saveSpaceRoles(
    spaceId: string,
    tags: Record<string, { name: string; color?: string; icon?: { key: string } }>,
    assignments: Record<string, number>,
    permissionLevels: Record<string, number> = {},
  ) {
    const client = this.clientForRoom(spaceId)
    if (!client) throw new Error('Matrix client is not ready')
    const space = client.getRoom(spaceId)
    if (!space || space.getType() !== RoomType.Space) throw new Error('Space not found')
    const current =
      space.currentState.getStateEvents(EventType.RoomPowerLevels, '')?.getContent() ?? {}
    const users = { ...((current.users as Record<string, number> | undefined) ?? {}) }
    const defaultLevel = typeof current.users_default === 'number' ? current.users_default : 0
    for (const [userId, level] of Object.entries(assignments)) {
      if (isInfiniteRoomCreator(space, userId) || level === defaultLevel) delete users[userId]
      else users[userId] = level
    }
    await client.sendStateEvent(
      spaceId,
      'in.cinny.room.power_level_tags' as never,
      tags as never,
      '',
    )
    await client.sendStateEvent(
      spaceId,
      EventType.RoomPowerLevels,
      { ...applyPermissionLevels(current, permissionLevels), users } as never,
      '',
    )
  }

  async saveRoomRoles(
    roomId: string,
    tags: Record<string, { name: string; color?: string; icon?: { key: string } }>,
    assignments: Record<string, number>,
    permissionLevels: Record<string, number>,
  ) {
    const client = this.clientForRoom(roomId)
    if (!client) throw new Error('Matrix client is not ready')
    const room = client.getRoom(roomId)
    if (!room) throw new Error('Room not found')
    const current =
      room.currentState.getStateEvents(EventType.RoomPowerLevels, '')?.getContent() ?? {}
    const users = { ...((current.users as Record<string, number> | undefined) ?? {}) }
    const defaultLevel = typeof current.users_default === 'number' ? current.users_default : 0
    for (const [userId, level] of Object.entries(assignments)) {
      if (isInfiniteRoomCreator(room, userId) || level === defaultLevel) delete users[userId]
      else users[userId] = level
    }
    await client.sendStateEvent(
      roomId,
      'in.cinny.room.power_level_tags' as never,
      tags as never,
      '',
    )
    await client.sendStateEvent(
      roomId,
      EventType.RoomPowerLevels,
      { ...applyPermissionLevels(current, permissionLevels), users } as never,
      '',
    )
  }

  private spaceRoleBaseline(space: Room) {
    const tags =
      (space.currentState
        .getStateEvents('in.cinny.room.power_level_tags', '')
        ?.getContent() as Record<
        string,
        { name: string; color?: string; icon?: { key: string } }
      >) ?? {}
    const assignments = Object.fromEntries(
      space
        .getJoinedMembers()
        .map((member) => [member.userId, effectivePowerLevel(space, member.userId)]),
    )
    const currentSpacePower =
      space.currentState.getStateEvents(EventType.RoomPowerLevels, '')?.getContent() ?? {}
    const permissionKeys = ['events_default', 'state_default', 'invite', 'kick', 'ban', 'redact']
    const permissions = Object.fromEntries(
      permissionKeys.map((key) => [
        key,
        typeof currentSpacePower[key] === 'number'
          ? currentSpacePower[key]
          : key === 'events_default'
            ? 0
            : 50,
      ]),
    )
    return { tags, assignments, permissions }
  }

  private async applyRoleSyncToChild(
    client: MatrixClient,
    room: Room,
    tags: Record<string, { name: string; color?: string; icon?: { key: string } }>,
    assignments: Record<string, number>,
    permissionLevels: Record<string, number>,
  ) {
    const current =
      room.currentState.getStateEvents(EventType.RoomPowerLevels, '')?.getContent() ?? {}
    const users = { ...((current.users as Record<string, number> | undefined) ?? {}) }
    const defaultLevel = typeof current.users_default === 'number' ? current.users_default : 0
    for (const [userId, level] of Object.entries(assignments)) {
      if (isInfiniteRoomCreator(room, userId) || level === defaultLevel) delete users[userId]
      else users[userId] = level
    }
    await client.sendStateEvent(
      room.roomId,
      'in.cinny.room.power_level_tags' as never,
      tags as never,
      '',
    )
    await client.sendStateEvent(
      room.roomId,
      EventType.RoomPowerLevels,
      { ...applyPermissionLevels(current, permissionLevels), users } as never,
      '',
    )
  }

  async syncSpaceRoles(
    spaceId: string,
    roleTags?: Record<string, { name: string; color?: string; icon?: { key: string } }>,
    roleAssignments?: Record<string, number>,
    permissionLevels?: Record<string, number>,
    permissionChanges?: Record<string, number>,
  ) {
    const client = this.clientForRoom(spaceId)
    if (!client) throw new Error('Matrix client is not ready')
    const space = client.getRoom(spaceId)
    if (!space || space.getType() !== RoomType.Space) throw new Error('Space not found')
    const baseline = this.spaceRoleBaseline(space)
    const tags = roleTags ?? baseline.tags
    const assignments = roleAssignments ?? baseline.assignments
    const currentPermissions = permissionLevels ?? baseline.permissions
    const previousPermissions =
      space.currentState
        .getStateEvents('chat.foxchat.space_role_sync', '')
        ?.getContent<{ permissions?: Record<string, number> }>().permissions ?? {}
    const changedPermissions =
      permissionChanges ??
      Object.fromEntries(
        Object.entries(currentPermissions).filter(
          ([key, value]) => previousPermissions[key] !== value,
        ),
      )
    const childIds: string[] = []
    const pendingSpaces = [space]
    const seenSpaces = new Set<string>()
    while (pendingSpaces.length) {
      const parent = pendingSpaces.shift()!
      if (seenSpaces.has(parent.roomId)) continue
      seenSpaces.add(parent.roomId)
      for (const event of parent.currentState.getStateEvents(EventType.SpaceChild)) {
        if (!Array.isArray(event.getContent().via)) continue
        const child = client.getRoom(event.getStateKey() ?? '')
        if (!child) continue
        if (!childIds.includes(child.roomId)) childIds.push(child.roomId)
        if (child.getType() === RoomType.Space) pendingSpaces.push(child)
      }
    }
    const synced: string[] = []
    const failed: { roomId: string; name: string; error: string }[] = []
    for (const roomId of childIds) {
      const room = client.getRoom(roomId)
      if (!room || room.getMyMembership() !== 'join') continue
      try {
        await this.applyRoleSyncToChild(client, room, tags, assignments, changedPermissions)
        synced.push(roomId)
      } catch (error) {
        failed.push({
          roomId,
          name: room.name,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }
    await client.sendStateEvent(
      spaceId,
      'chat.foxchat.space_role_sync' as never,
      { permissions: currentPermissions } as never,
      '',
    )
    return { total: childIds.length, synced, failed }
  }

  async applyCurrentSpaceRolesToRoom(spaceId: string, roomId: string) {
    const client = this.clientForRoom(spaceId)
    if (!client) throw new Error('Matrix client is not ready')
    const space = client.getRoom(spaceId)
    if (!space || space.getType() !== RoomType.Space) throw new Error('Space not found')
    const room = client.getRoom(roomId)
    if (!room) throw new Error('Room not found')
    const { tags, assignments, permissions } = this.spaceRoleBaseline(space)
    await this.applyRoleSyncToChild(client, room, tags, assignments, permissions)
  }

  async assignRoomRole(roomId: string, userId: string, level: number, propagateFromSpace = false) {
    const client = this.clientForRoom(roomId)
    if (!client) throw new Error('Matrix client is not ready')
    const room = client.getRoom(roomId)
    if (!room) throw new Error('Room not found')
    const apply = async (target: Room) => {
      const ownId = client.getUserId()
      if (!ownId || ownId === userId) throw new Error('You cannot assign a role to yourself')
      const ownLevel = effectivePowerLevel(target, ownId)
      const targetLevel = effectivePowerLevel(target, userId)
      if (!target.currentState.maySendStateEvent(EventType.RoomPowerLevels, ownId))
        throw new Error(`You cannot manage roles in ${target.name}`)
      if (ownLevel <= targetLevel) throw new Error(`You must outrank this user in ${target.name}`)
      if (level > ownLevel)
        throw new Error(`You cannot grant a role above your own in ${target.name}`)
      const current =
        target.currentState.getStateEvents(EventType.RoomPowerLevels, '')?.getContent() ?? {}
      const users = { ...((current.users as Record<string, number> | undefined) ?? {}) }
      const defaultLevel = typeof current.users_default === 'number' ? current.users_default : 0
      if (isInfiniteRoomCreator(target, userId) || level === defaultLevel) delete users[userId]
      else users[userId] = level
      await client.sendStateEvent(
        target.roomId,
        EventType.RoomPowerLevels,
        { ...current, users } as never,
        '',
      )
    }
    await apply(room)
    if (!propagateFromSpace || room.getType() !== RoomType.Space) return { synced: [], failed: [] }
    const synced: string[] = []
    const failed: string[] = []
    const queue = [room]
    const seen = new Set<string>()
    while (queue.length) {
      const parent = queue.shift()!
      if (seen.has(parent.roomId)) continue
      seen.add(parent.roomId)
      for (const event of parent.currentState.getStateEvents(EventType.SpaceChild)) {
        if (!Array.isArray(event.getContent().via)) continue
        const child = client.getRoom(event.getStateKey() ?? '')
        if (!child || child.getMyMembership() !== 'join') continue
        if (child.getType() === RoomType.Space) queue.push(child)
        try {
          await apply(child)
          synced.push(child.roomId)
        } catch {
          failed.push(child.roomId)
        }
      }
    }
    return { synced, failed }
  }

  async addFavoriteImagePack(roomOrAlias: string) {
    if (!this.client) throw new Error('Matrix client is not ready')
    const value = roomOrAlias.trim()
    const roomId = value.startsWith('#')
      ? (await this.client.getRoomIdForAlias(value)).room_id
      : value
    if (!roomId.startsWith('!')) throw new Error('Enter a Matrix room ID or room alias')
    for (const type of ['m.image_pack.rooms', 'im.ponies.emote_rooms']) {
      const current = this.client.getAccountData(type as never)?.getContent() as
        | { rooms?: Record<string, unknown> }
        | undefined
      await this.client.setAccountData(
        type as never,
        { ...current, rooms: { ...(current?.rooms ?? {}), [roomId]: {} } } as never,
      )
    }
    return roomId
  }

  async removeFavoriteImagePack(roomId: string) {
    if (!this.client) throw new Error('Matrix client is not ready')
    for (const type of ['m.image_pack.rooms', 'im.ponies.emote_rooms']) {
      const current = this.client.getAccountData(type as never)?.getContent() as
        | { rooms?: Record<string, unknown> }
        | undefined
      const rooms = { ...(current?.rooms ?? {}) }
      delete rooms[roomId]
      await this.client.setAccountData(type as never, { ...current, rooms } as never)
    }
  }

  async unpinRoom(roomId: string) {
    const client = this.clientForRoom(roomId)
    if (!client) throw new Error('Client is not started')
    await client.deleteRoomTag(roomId, 'm.favourite')
  }

  async addRoomTag(roomId: string, tag: string) {
    const client = this.clientForRoom(roomId)
    if (!client?.getRoom(roomId)) throw new Error('The room account is not available')
    await client.setRoomTag(roomId, tag, {})
  }

  async removeRoomTag(roomId: string, tag: string) {
    const client = this.clientForRoom(roomId)
    if (!client?.getRoom(roomId)) throw new Error('The room account is not available')
    await client.deleteRoomTag(roomId, tag)
  }

  async leaveRoom(roomId: string, accountId?: string) {
    const client = accountId ? this.accountClient(accountId) : this.clientForRoom(roomId)
    if (!client?.getRoom(roomId)) throw new Error('Client is not started')
    await client.leave(roomId)
  }

  async kickRoomMember(roomId: string, userId: string, reason?: string) {
    const client = this.clientForRoom(roomId)
    if (!client) throw new Error('Matrix client is not ready')
    await client.kick(roomId, userId, reason?.trim() || undefined)
  }

  async banRoomMember(roomId: string, userId: string, reason?: string) {
    const client = this.clientForRoom(roomId)
    if (!client) throw new Error('Matrix client is not ready')
    await client.ban(roomId, userId, reason?.trim() || undefined)
  }

  getBlockedUsers() {
    return this.client?.getIgnoredUsers() ?? []
  }

  async setUserBlocked(userId: string, blocked: boolean) {
    if (!this.client) throw new Error('Matrix client is not ready')
    const users = new Set(this.client.getIgnoredUsers())
    if (blocked) users.add(userId)
    else users.delete(userId)
    await this.client.setIgnoredUsers([...users])
  }

  async sendFile(
    roomId: string,
    file: File,
    txnId?: string,
    onProgress?: (loaded: number, total: number) => void,
    abortController?: AbortController,
    spoiler = false,
    accountId?: string,
    galleryId?: string,
  ) {
    const client = this.clientForRoomAccount(roomId, accountId)
    if (!client) throw new Error('Client is not started')
    const upload = await client.uploadContent(file, {
      name: file.name,
      type: file.type,
      progressHandler: onProgress
        ? (progress) => onProgress(progress.loaded, progress.total)
        : undefined,
      abortController,
    })
    const info = { mimetype: file.type, size: file.size }
    if (file.type.startsWith('image/')) {
      return this.queueSend(
        roomId,
        () =>
          client.sendEvent(
            roomId,
            EventType.RoomMessage,
            {
              msgtype: MsgType.Image,
              body: file.name,
              url: upload.content_uri,
              info,
              ...(spoiler ? { 'page.codeberg.everypizza.msc4193.spoiler': true } : {}),
              ...(galleryId ? { [GALLERY_EVENT_FIELD]: galleryId } : {}),
            },
            txnId,
          ),
        client,
      )
    }
    if (file.type.startsWith('audio/')) {
      return this.queueSend(
        roomId,
        () =>
          client.sendEvent(
            roomId,
            EventType.RoomMessage,
            {
              msgtype: MsgType.Audio,
              body: file.name,
              url: upload.content_uri,
              info,
            },
            txnId,
          ),
        client,
      )
    }
    if (file.type.startsWith('video/')) {
      return this.queueSend(
        roomId,
        () =>
          client.sendEvent(
            roomId,
            EventType.RoomMessage,
            {
              msgtype: MsgType.Video,
              body: file.name,
              url: upload.content_uri,
              info,
            },
            txnId,
          ),
        client,
      )
    }
    return this.queueSend(
      roomId,
      () =>
        client.sendEvent(
          roomId,
          EventType.RoomMessage,
          {
            msgtype: MsgType.File,
            body: file.name,
            filename: file.name,
            url: upload.content_uri,
            info,
          },
          txnId,
        ),
      client,
    )
  }

  async sendVoiceMessage(
    roomId: string,
    file: File,
    duration: number,
    waveform: number[],
    txnId?: string,
    onProgress?: (loaded: number, total: number) => void,
    accountId?: string,
  ) {
    const client = this.clientForRoomAccount(roomId, accountId)
    if (!client) throw new Error('Client is not started')
    const upload = await client.uploadContent(file, {
      name: file.name,
      type: file.type,
      progressHandler: onProgress
        ? (progress) => onProgress(progress.loaded, progress.total)
        : undefined,
    })
    return this.queueSend(
      roomId,
      () =>
        client.sendEvent(
          roomId,
          EventType.RoomMessage,
          {
            msgtype: MsgType.Audio,
            body: file.name,
            url: upload.content_uri,
            info: { mimetype: file.type, size: file.size, duration },
            'org.matrix.msc3245.voice': {},
            'org.matrix.msc1767.audio': { duration, waveform },
          } as never,
          txnId,
        ),
      client,
    )
  }

  async setTyping(roomId: string, typing: boolean) {
    const client = this.clientForRoom(roomId)
    if (client?.getRoom(roomId)?.getMyMembership() === 'join')
      await client.sendTyping(roomId, typing, 5000)
  }

  async markRead(event: MatrixEvent, visibleAccountId?: string) {
    const roomId = event.getRoomId()
    const eventId = event.getId()
    if (!roomId || !isServerEventId(eventId)) return
    const joinedAccounts = this.roomAccounts(roomId)
    const selectedAccountId = visibleAccountId ?? this.selectedRoomAccountId(roomId)
    const accounts = this.autoReadAllAccountsEnabled()
      ? joinedAccounts
      : joinedAccounts.filter((account) => account.id === selectedAccountId)
    const targets = accounts.length > 0 ? accounts : joinedAccounts.slice(0, 1)
    const results = await Promise.allSettled(
      targets.map(async ({ client }) => {
        const accountRoom = client.getRoom(roomId)
        if (!accountRoom || accountRoom.getMyMembership() !== 'join') return
        const receiptEvent = accountRoom.findEventById(eventId) ?? event
        let receipts = this.lastReadReceipts.get(client)
        if (!receipts) {
          receipts = new Map()
          this.lastReadReceipts.set(client, receipts)
        }
        const previous = receipts.get(roomId)
        if (previous?.eventId !== eventId) {
          const optimistic = { eventId, timestamp: event.getTs() }
          receipts.set(roomId, optimistic)
          try {
            await client.setRoomReadMarkers(roomId, eventId, receiptEvent)
          } catch (error) {
            if (receipts.get(roomId) === optimistic) {
              if (previous) receipts.set(roomId, previous)
              else receipts.delete(roomId)
            }
            throw error
          }
        }
        const latestNotifiable = [...accountRoom.getLiveTimeline().getEvents()]
          .reverse()
          .find(
            (candidate) =>
              !isHiddenTimelineActivity(candidate) &&
              (isVisibleMessageEvent(candidate) ||
                client.getPushActionsForEvent(candidate)?.notify === true),
          )
        if (!latestNotifiable || event.getTs() < latestNotifiable.getTs()) return
        accountRoom.setUnreadNotificationCount(NotificationCountType.Total, 0)
        accountRoom.setUnreadNotificationCount(NotificationCountType.Highlight, 0)
        for (const thread of accountRoom.getThreads()) {
          accountRoom.setThreadUnreadNotificationCount(thread.id, NotificationCountType.Total, 0)
          accountRoom.setThreadUnreadNotificationCount(
            thread.id,
            NotificationCountType.Highlight,
            0,
          )
        }
        this.observers.forEach((observer) => observer.onRoom?.(this.room(roomId) ?? accountRoom))
      }),
    )
    const failures = results.filter((result) => result.status === 'rejected')
    if (failures.length) {
      console.warn('[receipts] Could not mark every joined account as read', {
        roomId,
        failedAccounts: failures.length,
        totalAccounts: targets.length,
        reasons: failures.map((result) =>
          result.status === 'rejected' ? result.reason : undefined,
        ),
      })
    }
    const latestNotifiableTimestamp = Math.max(
      0,
      ...targets.map(
        ({ client }) =>
          [...(client.getRoom(roomId)?.getLiveTimeline().getEvents() ?? [])]
            .reverse()
            .find(
              (candidate) =>
                !isHiddenTimelineActivity(candidate) &&
                (isVisibleMessageEvent(candidate) ||
                  client.getPushActionsForEvent(candidate)?.notify === true),
            )
            ?.getTs() ?? 0,
      ),
    )
    if (
      failures.length === 0 &&
      latestNotifiableTimestamp > 0 &&
      event.getTs() >= latestNotifiableTimestamp
    ) {
      void clearMatrixPushRoom(roomId)
    }
  }

  async markRoomOrSpaceRead(roomId: string) {
    const joinedAccounts = this.roomAccounts(roomId)
    if (!joinedAccounts.length) throw new Error('Room is not available')
    const selectedAccountId = this.selectedRoomAccountId(roomId)
    const roots = this.autoReadAllAccountsEnabled()
      ? joinedAccounts
      : joinedAccounts.filter((account) => account.id === selectedAccountId)
    if (!roots.length) throw new Error('Room is not available')

    const targets: Array<{ client: MatrixClient; room: Room }> = []
    const targetKeys = new Set<string>()
    for (const { id: accountId, client } of roots) {
      const root = client.getRoom(roomId)
      if (!root) continue
      const queue = [root]
      const seen = new Set<string>()
      while (queue.length) {
        const room = queue.shift()!
        if (seen.has(room.roomId)) continue
        seen.add(room.roomId)
        if (room.getMyMembership() !== 'join') continue
        const hasUnread =
          room.getUnreadNotificationCount(NotificationCountType.Total) > 0 ||
          room.getUnreadNotificationCount(NotificationCountType.Highlight) > 0 ||
          room.hasThreadUnreadNotification()
        if (hasUnread) {
          const key = `${accountId}\0${room.roomId}`
          if (!targetKeys.has(key)) {
            targetKeys.add(key)
            targets.push({ client, room })
          }
        }
        if (room.getType() === RoomType.Space) {
          for (const event of room.currentState.getStateEvents(EventType.SpaceChild)) {
            if (!Array.isArray(event.getContent().via)) continue
            const child = client.getRoom(event.getStateKey() ?? '')
            if (child?.getMyMembership() === 'join') queue.push(child)
          }
        }
      }
    }

    const failures: string[] = []
    for (const { client, room } of targets) {
      try {
        const latestEvent = [...room.getLiveTimeline().getEvents()]
          .reverse()
          .find((event) => !!event.getId() && !room.hasPendingEvent(event.getId()!))
        const eventId = latestEvent?.getId()
        if (latestEvent && eventId) {
          await client.setRoomReadMarkers(room.roomId, eventId, latestEvent)
          let receipts = this.lastReadReceipts.get(client)
          if (!receipts) {
            receipts = new Map()
            this.lastReadReceipts.set(client, receipts)
          }
          receipts.set(room.roomId, {
            eventId,
            timestamp: latestEvent.getTs(),
          })
        }
        room.setUnreadNotificationCount(NotificationCountType.Total, 0)
        room.setUnreadNotificationCount(NotificationCountType.Highlight, 0)
        for (const thread of room.getThreads()) {
          room.setThreadUnreadNotificationCount(thread.id, NotificationCountType.Total, 0)
          room.setThreadUnreadNotificationCount(thread.id, NotificationCountType.Highlight, 0)
        }
        await clearMatrixPushRoom(room.roomId)
        this.observers.forEach((observer) => observer.onRoom?.(this.room(room.roomId) ?? room))
      } catch (error) {
        failures.push(`${room.name}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    if (failures.length)
      throw new Error(
        `Could not mark ${failures.length} room${failures.length === 1 ? '' : 's'} as read: ${failures.join('; ')}`,
      )
    return { marked: targets.length }
  }

  private unreadReceiptPosition(room: Room, client: MatrixClient, events: MatrixEvent[]) {
    const userId = client.getSafeUserId()
    // getEventReadUpTo deliberately hides receipts whose events are not loaded. Keep the raw
    // public and private receipt IDs too, so a limited initial sync cannot resurrect read history.
    const publicReceipt = room.getReadReceiptForUserId(userId, true, ReceiptType.Read)
    const privateReceipt = room.getReadReceiptForUserId(userId, true, ReceiptType.ReadPrivate)
    const serverReceiptIds = new Set(
      [
        room.getEventReadUpTo(userId),
        publicReceipt?.eventId,
        privateReceipt?.eventId,
        room.getAccountData(EventType.FullyRead)?.getContent<{ event_id?: string }>().event_id,
      ].filter((eventId): eventId is string => !!eventId),
    )
    const hasKnownReceipt = serverReceiptIds.size > 0
    let receiptIndex = -1
    for (const eventId of serverReceiptIds) {
      receiptIndex = Math.max(
        receiptIndex,
        events.findIndex((event) => event.getId() === eventId),
      )
    }
    const receiptTimestamp = Math.max(
      -1,
      publicReceipt?.data?.ts ?? -1,
      privateReceipt?.data?.ts ?? -1,
    )
    if (receiptTimestamp >= 0) {
      for (let index = events.length - 1; index >= 0; index--) {
        if (events[index].getTs() <= receiptTimestamp) {
          receiptIndex = Math.max(receiptIndex, index)
          break
        }
      }
    }
    const localReceipts = this.lastReadReceipts.get(client)
    const optimistic = localReceipts?.get(room.roomId)
    if (!optimistic) return { index: receiptIndex, known: hasKnownReceipt }
    if (
      serverReceiptIds.has(optimistic.eventId) ||
      [...serverReceiptIds].some(
        (eventId) => (room.findEventById(eventId)?.getTs() ?? -1) >= optimistic.timestamp,
      )
    ) {
      localReceipts?.delete(room.roomId)
      return { index: receiptIndex, known: hasKnownReceipt }
    }

    const optimisticIndex = events.findIndex((event) => event.getId() === optimistic.eventId)
    if (optimisticIndex >= 0) return { index: Math.max(receiptIndex, optimisticIndex), known: true }

    for (let index = events.length - 1; index >= 0; index--) {
      if (events[index].getTs() <= optimistic.timestamp) {
        receiptIndex = Math.max(receiptIndex, index)
        break
      }
    }
    return { index: receiptIndex, known: true }
  }

  private filteredUnreadEvents(room: Room, client: MatrixClient, ownUserIds: Set<string>) {
    const appearance = timelineAppearanceSettings()
    const events = room.getLiveTimeline().getEvents()
    const receipt = this.unreadReceiptPosition(room, client, events)
    const unread = events
      .slice(receipt.index >= 0 ? receipt.index + 1 : 0)
      .filter(
        (event) =>
          !event.isRedacted() &&
          !ownUserIds.has(event.getSender() ?? '') &&
          !isHiddenTimelineActivity(event, appearance) &&
          (isVisibleMessageEvent(event) || client.getPushActionsForEvent(event)?.notify === true),
      )
    if (receipt.index >= 0) return unread
    const expected = Math.max(
      room.getUnreadNotificationCount(NotificationCountType.Total),
      room.getUnreadNotificationCount(NotificationCountType.Highlight),
    )
    if (receipt.known) return expected > 0 ? unread.slice(-expected) : []
    return expected > 0 ? unread.slice(-expected) : unread
  }

  private filteredUnreadEventCount(room: Room, client: MatrixClient, ownUserIds: Set<string>) {
    const appearance = timelineAppearanceSettings()
    const events = room.getLiveTimeline().getEvents()
    const receipt = this.unreadReceiptPosition(room, client, events)
    let count = 0
    for (let index = receipt.index >= 0 ? receipt.index + 1 : 0; index < events.length; index++) {
      const event = events[index]
      if (
        !event.isRedacted() &&
        !ownUserIds.has(event.getSender() ?? '') &&
        !isHiddenTimelineActivity(event, appearance) &&
        (isVisibleMessageEvent(event) || client.getPushActionsForEvent(event)?.notify === true)
      )
        count++
    }
    if (receipt.index >= 0) return count
    const expected = Math.max(
      room.getUnreadNotificationCount(NotificationCountType.Total),
      room.getUnreadNotificationCount(NotificationCountType.Highlight),
    )
    if (receipt.known) return Math.min(count, expected)
    return expected > 0 ? Math.min(count, expected) : count
  }

  async unreadMessages(room: Room) {
    const selectedAccountId = this.selectedRoomAccountId(room.roomId)
    const selectedAccount = this.roomAccounts(room.roomId).find(
      (account) => account.id === selectedAccountId,
    )
    const client = selectedAccount?.client ?? this.clientForRoomInstance(room)
    const selectedRoom = client?.getRoom(room.roomId)
    if (!client || !selectedRoom) return []
    const ownUserIds = new Set(this.availableAccounts().map((account) => account.userId))
    return this.filteredUnreadEvents(selectedRoom, client, ownUserIds)
  }

  effectiveUnreadCount(roomId: string): number {
    const accounts = this.roomAccounts(roomId)
    if (!accounts.length) return 0
    const ownUserIds = new Set(this.availableAccounts().map((account) => account.userId))
    const countFor = ({ client }: { client: MatrixClient }) => {
      const room = client.getRoom(roomId)
      return room ? this.filteredUnreadEventCount(room, client, ownUserIds) : 0
    }
    const selected = accounts.find((account) => account.id === this.selectedRoomAccountId(roomId))
    return countFor(selected ?? accounts[0])
  }

  async loadOlderMessages(room: Room, limit = 30) {
    const client = this.clientForRoomInstance(room)
    if (!client) return false
    return client.paginateEventTimeline(room.getLiveTimeline(), { backwards: true, limit })
  }

  async loadEventContext(room: Room, eventId: string) {
    const client = this.clientForRoomInstance(room)
    if (!client) throw new Error('Client is not started')
    return client.getEventTimeline(room.getUnfilteredTimelineSet(), eventId)
  }

  async paginateTimeline(
    room: Room,
    timeline: ReturnType<Room['getLiveTimeline']>,
    backwards: boolean,
    limit = 30,
  ) {
    const client = this.clientForRoomInstance(room)
    if (!client) return false
    return client.paginateEventTimeline(timeline, { backwards, limit })
  }

  // In a combined multi-account room, only the account driving the on-screen timeline
  // normally paginates. If that account joined more recently than another logged-in account
  // sharing the room, its copy of older events can be undecryptable ("history before you
  // joined") even though the other account could read them - but that other account's own
  // timeline never independently backfills just because the primary one hit its join wall.
  // This paginates every joined account a page backwards so combinedRoomEvents can pick up
  // whichever account actually has a decryptable copy. Callers should keep invoking this
  // (bounded) after hitting the wall, since it can take more than one page for a
  // less-recently-scrolled account's timeline to catch up to the same point in history.
  // Returns whether any account actually had more to fetch.
  async backfillCombinedRoomHistory(roomId: string, limit = 30) {
    const results = await Promise.allSettled(
      this.roomAccounts(roomId).map(async ({ client }) => {
        const room = client.getRoom(roomId)
        const timeline = room?.getLiveTimeline()
        if (!room || !timeline || !timeline.getPaginationToken(Direction.Backward)) return false
        return client.paginateEventTimeline(timeline, { backwards: true, limit })
      }),
    )
    return results.some((result) => result.status === 'fulfilled' && result.value)
  }

  async joinRoom(roomIdOrAlias: string, viaServers?: string[]) {
    const invited = this.availableAccounts().find(
      (account) => account.client.getRoom(roomIdOrAlias)?.getMyMembership() === 'invite',
    )
    const client = invited?.client ?? this.clientForRoom(roomIdOrAlias)
    if (!client) throw new Error('Client is not started')
    return client.joinRoom(roomIdOrAlias, { viaServers })
  }

  async joinRoomAs(roomIdOrAlias: string, accountId: string, viaServers?: string[]) {
    const client = this.accountClient(accountId)
    if (!client) throw new Error('Account is not available')
    return client.joinRoom(roomIdOrAlias.trim(), { viaServers })
  }

  async declineRoomInvite(roomId: string, accountId: string) {
    const client = this.accountClient(accountId)
    const room = client?.getRoom(roomId)
    if (!client || room?.getMyMembership() !== 'invite')
      throw new Error('Room invitation is no longer available')
    await client.leave(roomId)
  }

  async publicRooms(accountId: string, term?: string, since?: string, server?: string) {
    const client = this.accountClient(accountId)
    if (!client) throw new Error('Account is not available')
    return client.publicRooms({
      server,
      limit: 30,
      since,
      filter: term?.trim() ? { generic_search_term: term.trim() } : undefined,
    })
  }

  async searchMessages(accountId: string, term: string, roomId?: string) {
    const client = this.accountClient(accountId)
    if (!client) throw new Error('Account is not available')
    return client.searchRoomEvents({
      term,
      filter: roomId ? { rooms: [roomId] } : undefined,
    })
  }

  searchMore(accountId: string, results: ISearchResults) {
    const client = this.accountClient(accountId)
    if (!client) throw new Error('Account is not available')
    return client.backPaginateRoomEventsSearch(results)
  }

  async createRoomAs(
    accountId: string,
    name: string,
    topic?: string,
    isPublic = false,
    encrypted = false,
    voiceChannel = false,
    federated = true,
  ) {
    const client = this.accountClient(accountId)
    if (!client) throw new Error('Account is not available')
    const normalizedName = name.trim()
    const result = await client.createRoom({
      name: normalizedName,
      topic: topic?.trim() || undefined,
      visibility: isPublic ? Visibility.Public : Visibility.Private,
      preset: isPublic ? Preset.PublicChat : Preset.PrivateChat,
      initial_state: encrypted
        ? [
            {
              type: EventType.RoomEncryption,
              state_key: '',
              content: { algorithm: 'm.megolm.v1.aes-sha2' },
            },
          ]
        : undefined,
      creation_content: {
        ...(voiceChannel ? { type: VOICE_CHANNEL_ROOM_TYPE } : {}),
        'm.federate': federated,
      },
      room_type: voiceChannel ? VOICE_CHANNEL_ROOM_TYPE : undefined,
      power_level_content_override: voiceChannel
        ? {
            events: {
              'org.matrix.msc3401.call.member': 0,
              'm.call.member': 0,
              'org.matrix.msc4143.rtc.member': 0,
              'm.rtc.member': 0,
            },
          }
        : undefined,
    } as any)
    // The room may not enter the SDK store until the next sync.
    return {
      roomId: result.room_id,
      name: client.getRoom(result.room_id)?.name || normalizedName,
    }
  }

  async createSpaceAs(
    accountId: string,
    name: string,
    topic?: string,
    isPublic = false,
    federated = true,
  ) {
    const client = this.accountClient(accountId)
    if (!client) throw new Error('Account is not available')
    const result = await client.createRoom({
      name: name.trim(),
      topic: topic?.trim() || undefined,
      visibility: isPublic ? Visibility.Public : Visibility.Private,
      preset: isPublic ? Preset.PublicChat : Preset.PrivateChat,
      creation_content: { type: RoomType.Space, 'm.federate': federated },
    })
    return client.getRoom(result.room_id) ?? (await client.joinRoom(result.room_id))
  }

  async inviteToRoomAs(roomId: string, userId: string, accountId?: string) {
    const client = accountId ? this.accountClient(accountId) : this.clientForRoom(roomId)
    if (!client?.getRoom(roomId)) throw new Error('The selected account is not joined to this room')
    await client.invite(roomId, userId.trim())
  }

  findExistingDM(userId: string): Room | undefined {
    for (const account of this.availableAccounts()) {
      const room = account.client.getRooms().find((candidate) => {
        if (candidate.getType() === RoomType.Space) return false
        if (candidate.getMyMembership() !== 'join') return false
        const memberIds = new Set([
          ...candidate.getMembersWithMembership('join').map((member) => member.userId),
          ...candidate.getMembersWithMembership('invite').map((member) => member.userId),
        ])
        return memberIds.size === 2 && memberIds.has(userId)
      })
      if (room) return room
    }
    return undefined
  }

  async createDMAs(accountId: string, userId: string) {
    const client = this.accountClient(accountId)
    if (!client) throw new Error('Account is not available')
    const targetId = userId.trim()
    const direct =
      client.getAccountData(EventType.Direct)?.getContent<Record<string, string[]>>() ?? {}
    const existingRoomId = direct[targetId]?.find(
      (id) => client.getRoom(id)?.getMyMembership() === 'join',
    )
    if (existingRoomId) return client.getRoom(existingRoomId)!
    const result = await client.createRoom({
      is_direct: true,
      preset: Preset.TrustedPrivateChat,
      invite: [targetId],
    })
    await client.setAccountData(EventType.Direct, {
      ...direct,
      [targetId]: [...(direct[targetId] ?? []), result.room_id],
    })
    return client.getRoom(result.room_id) ?? (await client.joinRoom(result.room_id))
  }

  async openOrCreateDMWith(userId: string) {
    const targetId = userId.trim()
    const existing = this.findExistingDM(targetId)
    if (existing) return existing
    const accountId = this.activeAccountId() ?? this.availableAccounts()[0]?.id
    if (!accountId) throw new Error('No account available')
    return this.createDMAs(accountId, targetId)
  }

  async getOrCreateVoiceCall(roomId: string): Promise<GroupCall> {
    const client = this.clientForRoom(roomId)
    if (!client) throw new Error('Client is not started')
    await client.waitUntilRoomReadyForGroupCalls(roomId)
    return (
      client.getGroupCallForRoom(roomId) ??
      client.createGroupCall(roomId, GroupCallType.Voice, false, GroupCallIntent.Room)
    )
  }

  async enableEncryption(roomId: string) {
    const client = this.clientForRoom(roomId)
    if (!client) throw new Error('Client is not started')
    await client.sendStateEvent(
      roomId,
      EventType.RoomEncryption,
      { algorithm: 'm.megolm.v1.aes-sha2' },
      '',
    )
  }

  async requestDeviceVerification(userId: string, deviceId: string) {
    if (!this.client) throw new Error('Client is not started')
    const crypto = this.client.getCrypto()
    if (!crypto) throw new Error('Encryption is not initialized')
    return crypto.requestDeviceVerification(userId, deviceId)
  }

  private notificationDecryptListenerRegistered = false
  private pushTokenListenerRegistered = false

  async listenForNotificationDecryptRequests() {
    const invoke = window.__TAURI_INTERNALS__?.invoke
    if (!invoke) return
    const { addPluginListener } = await import('@tauri-apps/api/core')
    if (!this.notificationDecryptListenerRegistered) {
      this.notificationDecryptListenerRegistered = true
      try {
        await addPluginListener<{ roomId: string; eventId: string }>(
          'remote-push',
          'notification-decrypt-request',
          ({ roomId, eventId }) => {
            void this.decryptForNotification(roomId, eventId)
              .then((decrypted) => {
                if (!decrypted) return undefined
                return invoke('plugin:remote-push|update_notification', {
                  roomId,
                  eventId,
                  ...decrypted,
                })
              })
              .catch((error) =>
                console.warn('[push] Notification decrypt round-trip failed', {
                  roomId,
                  eventId,
                  error,
                }),
              )
          },
        )
      } catch (error) {
        this.notificationDecryptListenerRegistered = false
        console.warn('[push] Could not register notification decrypt listener', error)
      }
    }
    if (!this.pushTokenListenerRegistered) {
      this.pushTokenListenerRegistered = true
      try {
        await addPluginListener<{ token: string }>('remote-push', 'token-received', ({ token }) => {
          const accounts = this.availableAccounts()
          console.info('[push] Firebase token rotated; refreshing Matrix pushers', {
            accounts: accounts.length,
            tokenSuffix: token.slice(-8),
          })
          void Promise.allSettled(accounts.map(({ client }) => registerMatrixPush(client))).then(
            (results) => {
              const failed = results.filter((result) => result.status === 'rejected').length
              if (failed)
                console.warn('[push] Some Matrix pushers rejected the rotated Firebase token', {
                  failed,
                  accounts: results.length,
                })
            },
          )
        })
      } catch (error) {
        this.pushTokenListenerRegistered = false
        console.warn('[push] Could not register Firebase token listener', error)
      }
    }
  }

  private async decryptForNotification(roomId: string, eventId: string) {
    const client = this.clientForRoom(roomId)
    if (!client) return undefined
    try {
      const room = client.getRoom(roomId)
      const mapper = client.getEventMapper()
      const raw = await client.fetchRoomEvent(roomId, eventId)
      const event = mapper({ ...raw, room_id: roomId } as Parameters<typeof mapper>[0])
      await client.decryptEventIfNeeded(event).catch(() => undefined)
      if (event.isDecryptionFailure()) return undefined
      if (isHiddenTimelineActivity(event)) return { suppress: true }
      if (event.getType() !== EventType.RoomMessage || event.isRedacted()) return undefined
      const senderId = event.getSender() ?? ''
      if (this.availableAccounts().some((account) => account.userId === senderId)) {
        return { suppress: true }
      }
      const senderName = room?.getMember(senderId)?.name ?? senderId
      const body = String(event.getContent().body ?? 'Sent an attachment')
      return { senderId, senderName, roomName: room?.name, body }
    } catch (error) {
      console.warn('[push] Could not decrypt notification event', { roomId, eventId, error })
      return undefined
    }
  }

  async logout() {
    const session = this.restoreSession()
    try {
      if (session) await this.revokeSession(session)
    } finally {
      await this.forgetCurrentAccount()
    }
  }

  async deactivateAccount(auth?: Record<string, unknown>, erase = false) {
    if (!this.client) throw new Error('Matrix client is not started')
    const result = await this.client.deactivateAccount(auth, erase)
    await this.forgetCurrentAccount()
    return result
  }

  private removeSavedAccount(accountId: string) {
    const remaining = this.savedAccounts().filter((saved) => this.accountId(saved) !== accountId)
    localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(remaining))
    if (accountId === this.activeAccountId()) {
      if (remaining[0]) localStorage.setItem(ACTIVE_ACCOUNT_KEY, this.accountId(remaining[0]))
      else localStorage.removeItem(ACTIVE_ACCOUNT_KEY)
    }
    const selections = Object.fromEntries(
      Object.entries(this.roomAccountSelections()).filter(
        ([, selectedAccountId]) => selectedAccountId !== accountId,
      ),
    )
    localStorage.setItem(ROOM_ACCOUNTS_KEY, JSON.stringify(selections))
    const modes = this.presenceModes()
    delete modes[accountId]
    localStorage.setItem(PRESENCE_MODES_KEY, JSON.stringify(modes))
  }

  private async forgetCurrentAccount() {
    const current = this.restoreSession()
    if (current) this.removeSavedAccount(this.accountId(current))
    await this.stop()
    localStorage.removeItem(SESSION_KEY)
    sessionStorage.removeItem(SESSION_KEY)
    this.backupAccounts()
  }
}

export const matrixService = new MatrixClientService()
