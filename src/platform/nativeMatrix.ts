import { EventType, MatrixEventEvent, type MatrixClient, type MatrixEvent } from 'matrix-js-sdk'
import {
  VerificationPhase,
  VerificationRequestEvent,
  VerifierEvent,
  type ShowSasCallbacks,
  type VerificationRequest,
  type Verifier,
} from 'matrix-js-sdk/lib/crypto-api'
import { reportClientError } from './errorLogging'

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

export type NativeVerificationSnapshot = {
  active: boolean
  requestId?: string
  userId?: string
  initiatedByMe?: boolean
  otherUserId?: string
  otherDeviceId?: string | null
  senderId?: string | null
  flowId?: string | null
  phase?: 'requested' | 'ready' | 'started' | 'cancelled' | 'done' | 'failed'
  error?: string | null
  emojis?: Array<[string, string]> | null
  decimals?: number[] | null
}

type NativeListener = (...args: unknown[]) => void

const VERIFICATION_BRIDGE_TIMEOUT_MS = 50_000

class NativeEmitter {
  private listeners = new Map<string, Set<NativeListener>>()

  on(event: string, listener: NativeListener) {
    const listeners = this.listeners.get(event) ?? new Set<NativeListener>()
    listeners.add(listener)
    this.listeners.set(event, listeners)
    return this
  }

  off(event: string, listener: NativeListener) {
    this.listeners.get(event)?.delete(listener)
    return this
  }

  protected emit(event: string, ...args: unknown[]) {
    this.listeners.get(event)?.forEach((listener) => listener(...args))
  }
}

class NativeVerifierAdapter extends NativeEmitter {
  private sas: ShowSasCallbacks | null = null
  private finished: Promise<void>
  private resolveFinished!: () => void
  private rejectFinished!: (error: Error) => void
  hasBeenCancelled = false

  constructor(
    readonly userId: string,
    private readonly request: NativeVerificationRequestAdapter,
  ) {
    super()
    this.finished = new Promise<void>((resolve, reject) => {
      this.resolveFinished = resolve
      this.rejectFinished = reject
    })
  }

  verify() {
    return this.finished
  }

  cancel(error: Error) {
    void this.request.cancel().catch(() => undefined)
    this.cancelled(error)
  }

  getShowSasCallbacks() {
    return this.sas
  }

  getReciprocateQrCodeCallbacks() {
    return null
  }

  apply(snapshot: NativeVerificationSnapshot) {
    const emoji = snapshot.emojis?.map(
      ([symbol, description]) => [symbol, description] as [string, string],
    )
    const decimal = snapshot.decimals
    const next =
      emoji?.length || decimal?.length === 3
        ? ({
            sas: {
              emoji: emoji?.length ? [...emoji] : undefined,
              decimal:
                decimal?.length === 3
                  ? ([decimal[0], decimal[1], decimal[2]] as [number, number, number])
                  : undefined,
            },
            confirm: async () => {
              this.request.apply(await nativeVerificationAction('verificationApprove', snapshot))
            },
            mismatch: () => {
              void nativeVerificationAction('verificationDecline', snapshot).then((next) =>
                this.request.apply(next),
              )
            },
            cancel: () => {
              void nativeVerificationAction('verificationCancel', snapshot).then((next) =>
                this.request.apply(next),
              )
            },
          } satisfies ShowSasCallbacks)
        : null
    const firstSas = !this.sas && next
    this.sas = next
    if (firstSas) this.emit(VerifierEvent.ShowSas, firstSas)
    if (snapshot.phase === 'done') this.resolveFinished()
    if (snapshot.phase === 'cancelled' || snapshot.phase === 'failed') {
      const error = new Error(snapshot.error || 'Verification was cancelled')
      this.cancelled(error)
    }
  }

  private cancelled(error: Error) {
    if (this.hasBeenCancelled) return
    this.hasBeenCancelled = true
    this.emit(VerifierEvent.Cancel, error)
    this.rejectFinished(error)
  }
}

class NativeVerificationRequestAdapter extends NativeEmitter {
  private snapshot: NativeVerificationSnapshot
  private nativeVerifier?: NativeVerifierAdapter

  constructor(snapshot: NativeVerificationSnapshot) {
    super()
    this.snapshot = snapshot
    this.apply(snapshot)
  }

  get transactionId() {
    return this.snapshot.requestId
  }
  get roomId() {
    return undefined
  }
  get initiatedByMe() {
    return !!this.snapshot.initiatedByMe
  }
  get otherUserId() {
    return this.snapshot.otherUserId || this.snapshot.userId || ''
  }
  get otherDeviceId() {
    return this.snapshot.otherDeviceId ?? undefined
  }
  get isSelfVerification() {
    return this.snapshot.otherUserId === this.snapshot.userId
  }
  get phase() {
    return nativeVerificationPhase(this.snapshot.phase)
  }
  get pending() {
    return [
      VerificationPhase.Requested,
      VerificationPhase.Ready,
      VerificationPhase.Started,
    ].includes(this.phase)
  }
  get accepting() {
    return false
  }
  get declining() {
    return false
  }
  get timeout() {
    return null
  }
  get methods() {
    return ['m.sas.v1']
  }
  get chosenMethod() {
    return this.phase >= VerificationPhase.Started ? 'm.sas.v1' : null
  }
  get verifier() {
    return this.nativeVerifier as unknown as Verifier | undefined
  }
  get cancellationCode() {
    return this.phase === VerificationPhase.Cancelled ? 'm.user' : null
  }
  get cancellingUserId() {
    return undefined
  }

  otherPartySupportsMethod(method: string) {
    return method === 'm.sas.v1'
  }

  async accept() {
    this.apply(await nativeVerificationAction('verificationAccept', this.snapshot))
  }

  async cancel() {
    this.apply(await nativeVerificationAction('verificationCancel', this.snapshot))
  }

  async startVerification(method: string) {
    if (method !== 'm.sas.v1') throw new Error(`Unsupported verification method: ${method}`)
    this.ensureVerifier()
    this.apply(await nativeVerificationAction('verificationStartSas', this.snapshot))
    return this.nativeVerifier as unknown as Verifier
  }

  async scanQRCode() {
    throw new Error('QR verification is not supported by the Android native client')
  }

  async generateQRCode() {
    return undefined
  }

  apply(snapshot: NativeVerificationSnapshot) {
    this.snapshot = snapshot
    if (snapshot.phase === 'started' || snapshot.emojis?.length || snapshot.decimals?.length)
      this.ensureVerifier()
    this.nativeVerifier?.apply(snapshot)
    this.emit(VerificationRequestEvent.Change)
  }

  private ensureVerifier() {
    if (!this.nativeVerifier)
      this.nativeVerifier = new NativeVerifierAdapter(this.otherUserId, this)
  }
}

const nativeVerificationRequests = new Map<string, NativeVerificationRequestAdapter>()

function nativeVerificationPhase(phase: NativeVerificationSnapshot['phase']) {
  switch (phase) {
    case 'ready':
      return VerificationPhase.Ready
    case 'started':
      return VerificationPhase.Started
    case 'done':
      return VerificationPhase.Done
    case 'cancelled':
    case 'failed':
      return VerificationPhase.Cancelled
    default:
      return VerificationPhase.Requested
  }
}

function nativeVerificationAction(action: string, snapshot: NativeVerificationSnapshot) {
  if (!snapshot.userId || !snapshot.requestId)
    throw new Error('The native verification request is incomplete')
  return command<NativeVerificationSnapshot>(action, {
    userId: snapshot.userId,
    requestId: snapshot.requestId,
  })
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

export function nativeSetPresence(userId: string, presence: string) {
  return command<{ ok: true }>('setPresence', { userId, presence })
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

export function nativeSetupRecovery(userId: string, passphrase?: string) {
  return command<{ recoveryKey: string; version: string }>('setupRecovery', {
    userId,
    passphrase,
  })
}

export function nativeSecurityStatus<T>(userId: string) {
  return command<T>('securityStatus', { userId })
}

export function nativeUserIdentities<
  T extends Record<
    string,
    {
      known: boolean
      verified?: boolean
      previouslyVerified?: boolean
      needsApproval?: boolean
      masterKey?: string
    }
  >,
>(userId: string, targetUserIds: string[]) {
  return command<T>('userIdentities', { userId, targetUserIds })
}

export async function nativeRequestVerification(userId: string, targetUserId?: string) {
  let timeout: ReturnType<typeof setTimeout> | undefined
  const bridgeTimeout = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      const error = new Error('Native Matrix verification did not respond within 50 seconds')
      reportClientError('native-matrix:verification-request-timeout', error.message, error)
      reject(error)
    }, VERIFICATION_BRIDGE_TIMEOUT_MS)
  })
  const snapshot = await Promise.race([
    command<NativeVerificationSnapshot>('verificationRequest', {
      userId,
      targetUserId,
    }),
    bridgeTimeout,
  ]).finally(() => {
    if (timeout !== undefined) clearTimeout(timeout)
  })
  return applyNativeVerificationSnapshot(snapshot)
}

export async function nativeVerificationStatus(userId: string) {
  const snapshot = await command<NativeVerificationSnapshot>('verificationStatus', { userId })
  return snapshot.active ? applyNativeVerificationSnapshot(snapshot) : undefined
}

export function currentNativeVerification(userId: string) {
  return nativeVerificationRequests.get(userId) as unknown as VerificationRequest | undefined
}

export function applyNativeVerificationSnapshot(snapshot: NativeVerificationSnapshot) {
  if (!snapshot.active || !snapshot.userId || !snapshot.requestId) return undefined
  let request = nativeVerificationRequests.get(snapshot.userId)
  if (!request || request.transactionId !== snapshot.requestId) {
    request = new NativeVerificationRequestAdapter(snapshot)
    nativeVerificationRequests.set(snapshot.userId, request)
  } else {
    request.apply(snapshot)
  }
  return request as unknown as VerificationRequest
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

  client.setPresence = async ({ presence }) => {
    await nativeSetPresence(userId, presence)
  }

  client.setSyncPresence = async (presence) => {
    await nativeSetPresence(userId, presence ?? 'offline')
  }

  client.setRoomReadMarkers = (async (roomId: string) => {
    await nativeMarkRead(userId, roomId)
    return {}
  }) as typeof client.setRoomReadMarkers

  client.logout = (async () => {
    await nativeLogout(userId)
    return {}
  }) as typeof client.logout
}
