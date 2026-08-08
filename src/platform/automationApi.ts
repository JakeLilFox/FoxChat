import { listen } from '@tauri-apps/api/event'
import { invoke } from '@tauri-apps/api/core'
import { Direction, EventType, type MatrixEvent, type Room } from 'matrix-js-sdk'
import * as VoiceAudioMixer from '../components/calls/ElementCallAudioMixer'
import { matrixService } from '../matrix/MatrixClientService'
import { matrixRTCActiveSpeakers, matrixRTCVoiceMembers } from '../components/calls/voiceRoom'
import { eventBody, isVisibleMessageEvent } from '../lib/eventHelpers'
import { lastMessagePreview, roomLatestTs } from '../lib/timelineHelpers'
import { downloadAndDecryptMedia } from '../lib/mediaDecrypt'

export const AUTOMATION_ENABLED_KEY = 'foxchat.automation.enabled'
export const AUTOMATION_PORT_KEY = 'foxchat.automation.port'
export const AUTOMATION_API_KEY = 'foxchat.automation.apiKey'
export const DEFAULT_AUTOMATION_PORT = 29331

export type AutomationStatus = {
  running: boolean
  port?: number
  connections: number
}

type ApiRequest = {
  connectionId: string
  request: { id: string; method: string; params?: Record<string, unknown> }
}

type CallState = {
  room_id: string
  active: boolean
  input: { microphone_muted: boolean; camera_enabled: boolean; screen_sharing: boolean }
  screenshares: string[]
  viewed_screenshares: string[]
  users?: string[]
}

let integrationStarting = false
let integrationStarted = false
let callState = new Map<string, CallState>()
let currentCallRoomId: string | undefined
let bridgeSocket: WebSocket | undefined
let bridgeAuthenticated = false
let bridgeSuperseded = false
let bridgeReconnect: number | undefined

const nativeAvailable = () => !!window.__TAURI_INTERNALS__?.invoke
const mobileBrowser = () => /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
const automationEnabled = () => localStorage.getItem(AUTOMATION_ENABLED_KEY) === 'true'
export const automationApiSupported = () => !mobileBrowser()
export const automationApiUsesBridge = () => !nativeAvailable()

const stopBridge = (superseded = false) => {
  bridgeSuperseded = superseded
  bridgeAuthenticated = false
  if (bridgeReconnect) window.clearTimeout(bridgeReconnect)
  bridgeReconnect = undefined
  const socket = bridgeSocket
  bridgeSocket = undefined
  socket?.close()
}

const startBridge = (port: number, apiKey: string) => {
  stopBridge(false)
  const socket = new WebSocket(`ws://127.0.0.1:${port}/v1`)
  bridgeSocket = socket
  socket.addEventListener('open', () => {
    socket.send(JSON.stringify({ type: 'authenticate', role: 'matrix_client', api_key: apiKey }))
  })
  socket.addEventListener('message', (event) => {
    let frame: Record<string, unknown>
    try {
      frame = JSON.parse(String(event.data)) as Record<string, unknown>
    } catch {
      return
    }
    if (frame.type === 'authenticated') {
      bridgeAuthenticated = true
      return
    }
    const error = frame.error as { code?: string } | undefined
    if (frame.type === 'error' && error?.code === 'provider_replaced') {
      bridgeSuperseded = true
      bridgeAuthenticated = false
      return
    }
    if (frame.type === 'bridge_request') {
      const request = frame.request as ApiRequest['request'] | undefined
      const connectionId = typeof frame.connection_id === 'string' ? frame.connection_id : ''
      if (request && connectionId) void answer({ connectionId, request })
    }
  })
  socket.addEventListener('close', () => {
    const wasActiveSocket = bridgeSocket === socket
    if (wasActiveSocket) bridgeSocket = undefined
    bridgeAuthenticated = false
    if (wasActiveSocket && !bridgeSuperseded && automationSettings().enabled) {
      bridgeReconnect = window.setTimeout(() => {
        const settings = automationSettings()
        if (settings.enabled) startBridge(settings.port, settings.apiKey)
      }, 2_000)
    }
  })
}

export function generateAutomationApiKey() {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export function automationSettings() {
  let apiKey = localStorage.getItem(AUTOMATION_API_KEY)
  if (!apiKey) {
    apiKey = generateAutomationApiKey()
    localStorage.setItem(AUTOMATION_API_KEY, apiKey)
  }
  return {
    enabled: localStorage.getItem(AUTOMATION_ENABLED_KEY) === 'true',
    port: nativeAvailable()
      ? Number(localStorage.getItem(AUTOMATION_PORT_KEY)) || DEFAULT_AUTOMATION_PORT
      : DEFAULT_AUTOMATION_PORT,
    apiKey,
  }
}

export async function automationApiStatus(): Promise<AutomationStatus> {
  if (!nativeAvailable())
    return { running: bridgeAuthenticated, port: automationSettings().port, connections: 0 }
  return invoke<AutomationStatus>('automation_api_status')
}

export async function configureAutomationApi(enabled: boolean, port: number, apiKey: string) {
  if (!automationApiSupported() && enabled)
    throw new Error('The automation API is available in desktop browsers and the desktop app')
  const effectivePort = nativeAvailable() ? port : DEFAULT_AUTOMATION_PORT
  localStorage.setItem(AUTOMATION_ENABLED_KEY, String(enabled))
  localStorage.setItem(AUTOMATION_PORT_KEY, String(effectivePort))
  localStorage.setItem(AUTOMATION_API_KEY, apiKey)
  if (!nativeAvailable()) {
    if (enabled) startBridge(effectivePort, apiKey)
    else stopBridge()
    return
  }
  if (enabled) await invoke<number>('start_automation_api', { port: effectivePort, apiKey })
  else await invoke('stop_automation_api')
}

const publish = (event: string, data: Record<string, unknown>) => {
  if (!automationEnabled()) return
  if (nativeAvailable()) {
    void invoke('publish_automation_event', { event, data }).catch(() => undefined)
  } else if (bridgeAuthenticated && bridgeSocket?.readyState === WebSocket.OPEN) {
    bridgeSocket.send(JSON.stringify({ type: 'publish', event, data, timestamp: Date.now() }))
  }
}

const roomFor = (roomId: unknown) => {
  if (typeof roomId !== 'string' || !roomId) throw apiError('invalid_params', 'room_id is required')
  const room = matrixService.clientForRoom(roomId)?.getRoom(roomId)
  if (!room) throw apiError('not_found', `Room ${roomId} is not available`)
  return room
}

const apiError = (code: string, message: string) => Object.assign(new Error(message), { code })

const roomJson = (room: Room) => ({
  room_id: room.roomId,
  // Matches what the room list/chat header show: local overrides and DM naming are already
  // baked into `room.name` by MatrixClientService, not just the raw m.room.name state event.
  name: room.name,
  membership: room.getMyMembership(),
  unread_count: room.getUnreadNotificationCount(),
  avatar_url: room.getMxcAvatarUrl(),
  pinned: !!room.tags['m.favourite'],
  last_activity_ts: roomLatestTs(room),
  last_message: lastMessagePreview(room),
})

// Same ordering as the room list sidebar: pinned rooms first (by their favourite order),
// then everything else by most recent activity.
const sortedRooms = (rooms: Room[]) => {
  const pinnedIndex = new Map(
    rooms
      .filter((room) => !!room.tags['m.favourite'])
      .sort(
        (a, b) =>
          (Number(a.tags['m.favourite']?.order) || 0.5) -
          (Number(b.tags['m.favourite']?.order) || 0.5),
      )
      .map((room, index) => [room.roomId, index] as const),
  )
  return [...rooms].sort((a, b) => {
    const ai = pinnedIndex.get(a.roomId)
    const bi = pinnedIndex.get(b.roomId)
    if (ai !== undefined || bi !== undefined)
      return ai === undefined ? 1 : bi === undefined ? -1 : ai - bi
    return roomLatestTs(b) - roomLatestTs(a)
  })
}

// Stickers and images are inlined as decrypted base64 so a consumer never has to repeat
// FoxChat's own decryption (mxc download + m.room.encrypted file unwrapping) itself. Capped so a
// large photo can't stall the socket or bloat every timeline/notification payload.
const INLINE_MEDIA_MAX_BYTES = 5 * 1024 * 1024

const arrayBufferToBase64 = (buffer: ArrayBuffer) => {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  const chunkSize = 0x8000
  for (let offset = 0; offset < bytes.length; offset += chunkSize)
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize))
  return btoa(binary)
}

const isInlineableMedia = (event: MatrixEvent) =>
  event.getType() === EventType.Sticker || event.getContent().msgtype === 'm.image'

const mediaAttachmentJson = async (event: MatrixEvent, room: Room) => {
  if (!isInlineableMedia(event)) return undefined
  const content = event.getContent()
  const declaredSize = Number(content.info?.size) || undefined
  const declaredMimetype =
    typeof content.info?.mimetype === 'string' ? content.info.mimetype : 'application/octet-stream'
  if (declaredSize && declaredSize > INLINE_MEDIA_MAX_BYTES)
    return { mimetype: declaredMimetype, size: declaredSize }
  try {
    const client = matrixService.clientForRoomInstance(room)
    const { blob, mimetype } = await downloadAndDecryptMedia(content, client)
    if (blob.size > INLINE_MEDIA_MAX_BYTES) return { mimetype, size: blob.size }
    return { mimetype, size: blob.size, base64: arrayBufferToBase64(await blob.arrayBuffer()) }
  } catch {
    return { mimetype: declaredMimetype, size: declaredSize }
  }
}

const messageEventJson = async (event: MatrixEvent, room: Room) => {
  const content = event.getContent()
  const msgtype =
    typeof content.msgtype === 'string'
      ? content.msgtype
      : event.getType() === EventType.Sticker
        ? 'm.sticker'
        : undefined
  const media = await mediaAttachmentJson(event, room)
  return {
    room_id: room.roomId,
    event_id: event.getId(),
    sender: event.getSender(),
    sender_display_name: room.getMember(event.getSender() ?? '')?.name,
    timestamp: event.getTs(),
    body: eventBody(event),
    msgtype,
    ...(media ? { media } : {}),
  }
}

const TIMELINE_DEFAULT_LIMIT = 30
const TIMELINE_MAX_LIMIT = 100
const timelineLimit = (value: unknown) =>
  Math.min(TIMELINE_MAX_LIMIT, Math.max(1, Number(value) || TIMELINE_DEFAULT_LIMIT))

// Fetches (paginating backwards as needed) enough of the room's live timeline to cover the
// requested window, anchored on `anchorEventId` when given. This is the same live timeline the
// app itself scrolls, so a running FoxChat window and automation clients see consistent history.
const loadRoomTimelineEvents = async (
  room: Room,
  anchorEventId: string | undefined,
  count: number,
) => {
  const timeline = room.getLiveTimeline()
  const visible = () => timeline.getEvents().filter(isVisibleMessageEvent)
  for (let attempt = 0; attempt < 25; attempt += 1) {
    const events = visible()
    const anchorIndex = anchorEventId
      ? events.findIndex((event) => event.getId() === anchorEventId)
      : -1
    const haveEnough = anchorEventId
      ? anchorIndex !== -1 && anchorIndex >= count
      : events.length >= count
    if (haveEnough || !timeline.getPaginationToken(Direction.Backward)) return events
    if (!(await matrixService.loadOlderMessages(room, count))) return events
  }
  return visible()
}

const userJson = async (userId: string, room?: Room) => {
  const client = room ? matrixService.clientForRoom(room.roomId) : matrixService.matrixClient
  if (!client) throw apiError('not_ready', 'Matrix is not connected')
  const profile = await client.getProfileInfo(userId)
  const member = room?.getMember(userId)
  const raw = profile as Record<string, unknown>
  const avatarMxc = typeof profile.avatar_url === 'string' ? profile.avatar_url : undefined
  return {
    user_id: userId,
    display_name: member?.name || profile.displayname || userId,
    avatar_url: avatarMxc,
    avatar_http_url: avatarMxc ? client.mxcUrlToHttp(avatarMxc, 256, 256, 'crop') : undefined,
    banner_url:
      typeof raw['chat.commet.profile_banner'] === 'string'
        ? raw['chat.commet.profile_banner']
        : undefined,
    presence: client.getUser(userId)?.presence,
    status_message: client.getUser(userId)?.presenceStatusMsg,
    membership: member?.membership,
  }
}

const requestCallHost = <T>(method: string, params: Record<string, unknown>) =>
  new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(
      () => reject(apiError('call_unavailable', 'Call controls are not available')),
      2_000,
    )
    window.dispatchEvent(
      new CustomEvent('foxchat-automation-call-command', {
        detail: {
          method,
          params,
          resolve: (value: T) => {
            window.clearTimeout(timer)
            resolve(value)
          },
          reject: (reason: unknown) => {
            window.clearTimeout(timer)
            reject(reason)
          },
        },
      }),
    )
  })

async function handleMethod(method: string, params: Record<string, unknown>) {
  switch (method) {
    case 'system.ping':
      return { pong: true, version: 1 }
    case 'rooms.list':
      return sortedRooms(matrixService.rooms()).map(roomJson)
    case 'room.get':
      return roomJson(roomFor(params.room_id))
    case 'room.read': {
      const room = roomFor(params.room_id)
      const event = room.getLiveTimeline().getEvents().at(-1)
      if (event) await matrixService.markRead(event)
      return { room_id: room.roomId, event_id: event?.getId(), read: !!event }
    }
    case 'room.timeline': {
      const room = roomFor(params.room_id)
      const limit = timelineLimit(params.limit)
      const beforeEventId =
        typeof params.before_event_id === 'string' ? params.before_event_id : undefined
      const afterEventId =
        typeof params.after_event_id === 'string' ? params.after_event_id : undefined
      if (beforeEventId && afterEventId)
        throw apiError('invalid_params', 'Use only one of before_event_id or after_event_id')
      const anchorEventId = beforeEventId ?? afterEventId
      const events = await loadRoomTimelineEvents(room, anchorEventId, limit)
      const timeline = room.getLiveTimeline()
      if (anchorEventId) {
        const anchorIndex = events.findIndex((event) => event.getId() === anchorEventId)
        if (anchorIndex === -1)
          throw apiError(
            'not_found',
            `${beforeEventId ? 'before_event_id' : 'after_event_id'} was not found in this room's history`,
          )
        if (beforeEventId) {
          const start = Math.max(0, anchorIndex - limit)
          return {
            room_id: room.roomId,
            messages: await Promise.all(
              events.slice(start, anchorIndex).map((event) => messageEventJson(event, room)),
            ),
            start_reached: start === 0 && !timeline.getPaginationToken(Direction.Backward),
          }
        }
        const end = Math.min(events.length, anchorIndex + 1 + limit)
        return {
          room_id: room.roomId,
          messages: await Promise.all(
            events.slice(anchorIndex + 1, end).map((event) => messageEventJson(event, room)),
          ),
          end_reached: end >= events.length,
        }
      }
      const start = Math.max(0, events.length - limit)
      return {
        room_id: room.roomId,
        messages: await Promise.all(
          events.slice(start).map((event) => messageEventJson(event, room)),
        ),
        start_reached: start === 0 && !timeline.getPaginationToken(Direction.Backward),
      }
    }
    case 'message.send': {
      const room = roomFor(params.room_id)
      const body = typeof params.body === 'string' ? params.body.trim() : ''
      if (!body) throw apiError('invalid_params', 'body is required')
      const response = await matrixService.sendText(room.roomId, body)
      return { room_id: room.roomId, event_id: response.event_id }
    }
    case 'user.get':
    case 'user.avatar.get':
    case 'user.banner.get': {
      const userId = typeof params.user_id === 'string' ? params.user_id : ''
      if (!userId) throw apiError('invalid_params', 'user_id is required')
      const room = typeof params.room_id === 'string' ? roomFor(params.room_id) : undefined
      const user = await userJson(userId, room)
      if (method === 'user.avatar.get')
        return {
          user_id: userId,
          avatar_url: user.avatar_url,
          avatar_http_url: user.avatar_http_url,
        }
      if (method === 'user.banner.get') return { user_id: userId, banner_url: user.banner_url }
      return user
    }
    case 'call.status': {
      const room = roomFor(params.room_id)
      const state = callState.get(room.roomId)
      return {
        room_id: room.roomId,
        active: matrixRTCVoiceMembers(matrixService.clientForRoom(room.roomId), room).length > 0,
        local: state,
      }
    }
    case 'call.current': {
      const current = currentCallRoomId ? callState.get(currentCallRoomId) : undefined
      if (!current) return { active: false, room_id: null }
      return {
        active: true,
        room_id: current.room_id,
        input: current.input,
        screenshares: current.screenshares,
        viewed_screenshares: current.viewed_screenshares,
      }
    }
    case 'call.open': {
      const room = roomFor(params.room_id)
      window.dispatchEvent(new CustomEvent('foxchat-join-voice', { detail: room }))
      return { room_id: room.roomId, opening: true }
    }
    case 'call.users': {
      const room = roomFor(params.room_id)
      const client = matrixService.clientForRoom(room.roomId)
      return matrixRTCVoiceMembers(client, room).map((member) => ({
        user_id: member.userId,
        display_name: member.name || member.userId,
        speaking: matrixRTCActiveSpeakers.get(room.roomId)?.has(member.userId) ?? false,
        microphone_volume: VoiceAudioMixer.getUserVolume(member.userId, 'microphone'),
        screenshare_volume: VoiceAudioMixer.getUserVolume(member.userId, 'screen_share_audio'),
        screenshare_muted: VoiceAudioMixer.getScreenshareAudioMuted(member.userId),
      }))
    }
    case 'call.input.get':
    case 'call.input.set':
    case 'call.leave':
    case 'call.screenshare.view':
    case 'call.screenshare.leave':
      return requestCallHost(method, params)
    case 'call.user_audio.set': {
      const userId = typeof params.user_id === 'string' ? params.user_id : ''
      const source = params.source === 'screen_share_audio' ? 'screen_share_audio' : 'microphone'
      if (!userId) throw apiError('invalid_params', 'user_id is required')
      if (typeof params.volume === 'number')
        VoiceAudioMixer.setUserVolume(userId, source, params.volume)
      if (source === 'screen_share_audio' && typeof params.muted === 'boolean')
        VoiceAudioMixer.setScreenshareAudioMuted(userId, params.muted)
      return {
        user_id: userId,
        source,
        volume: VoiceAudioMixer.getUserVolume(userId, source),
        muted: source === 'screen_share_audio' && VoiceAudioMixer.getScreenshareAudioMuted(userId),
      }
    }
    default:
      throw apiError('method_not_found', `Unknown method: ${method}`)
  }
}

async function answer(payload: ApiRequest) {
  const { connectionId, request } = payload
  let response: Record<string, unknown>
  try {
    const result = await handleMethod(request.method, request.params ?? {})
    response = { type: 'response', id: request.id, ok: true, result }
  } catch (error) {
    const value = error as Error & { code?: string }
    response = {
      type: 'response',
      id: request.id,
      ok: false,
      error: { code: value.code || 'internal_error', message: value.message || String(error) },
    }
  }
  if (nativeAvailable()) {
    await invoke('respond_automation_api', { connectionId, response }).catch(() => undefined)
  } else if (bridgeAuthenticated && bridgeSocket?.readyState === WebSocket.OPEN) {
    bridgeSocket.send(
      JSON.stringify({ type: 'bridge_response', connection_id: connectionId, response }),
    )
  }
}

const publishMessage = (event: MatrixEvent, room?: Room) => {
  if (!automationEnabled()) return
  const isMessageLike =
    event.getType() === EventType.RoomMessage || event.getType() === EventType.Sticker
  if (!room || !isMessageLike || event.isRedacted()) return
  void (async () => {
    const content = event.getContent()
    const msgtype =
      typeof content.msgtype === 'string'
        ? content.msgtype
        : event.getType() === EventType.Sticker
          ? 'm.sticker'
          : undefined
    const media = await mediaAttachmentJson(event, room)
    const data = {
      room_id: room.roomId,
      room_name: room.name,
      event_id: event.getId(),
      sender: event.getSender(),
      sender_display_name: room.getMember(event.getSender() ?? '')?.name,
      timestamp: event.getTs(),
      message: { msgtype, body: content.body, ...(media ? { media } : {}) },
    }
    publish('message.received', data)
    const client = matrixService.clientForRoom(room.roomId)
    if (client?.getPushActionsForEvent(event)?.notify) publish('notification.received', data)
  })()
}

const pollCalls = () => {
  if (!automationEnabled()) return
  const next = new Map<string, Set<string>>()
  for (const room of matrixService.rooms()) {
    const users = new Set(
      matrixRTCVoiceMembers(matrixService.clientForRoom(room.roomId), room).map(
        (member) => member.userId,
      ),
    )
    if (users.size) next.set(room.roomId, users)
  }
  const roomIds = new Set([...callState.keys(), ...next.keys()])
  for (const roomId of roomIds) {
    const previous = new Set(callState.get(roomId)?.users ?? [])
    const current = next.get(roomId) ?? new Set<string>()
    if (!previous.size && current.size) publish('call.started', { room_id: roomId })
    if (previous.size && !current.size) publish('call.ended', { room_id: roomId })
    for (const userId of current)
      if (!previous.has(userId)) publish('call.user_joined', { room_id: roomId, user_id: userId })
    for (const userId of previous)
      if (!current.has(userId)) publish('call.user_left', { room_id: roomId, user_id: userId })
    const state = callState.get(roomId) ?? {
      room_id: roomId,
      active: !!current.size,
      input: { microphone_muted: false, camera_enabled: false, screen_sharing: false },
      screenshares: [],
      viewed_screenshares: [],
    }
    callState.set(roomId, Object.assign(state, { users: [...current] }))
  }
}

export async function startAutomationApiIntegration() {
  if (!automationApiSupported() || integrationStarted || integrationStarting) return
  integrationStarting = true
  try {
    if (nativeAvailable())
      await listen<ApiRequest>(
        'foxchat://automation-request',
        (event) => void answer(event.payload),
      )
    matrixService.subscribe({ onEvent: publishMessage })
    const onCallState = (event: Event) => {
      const next = (event as CustomEvent<CallState>).detail
      const previous = callState.get(next.room_id)
      if (next.active) currentCallRoomId = next.room_id
      else if (currentCallRoomId === next.room_id) currentCallRoomId = undefined
      callState.set(next.room_id, { ...next, users: previous?.users })
      if (previous && JSON.stringify(previous.input) !== JSON.stringify(next.input))
        publish('call.input_changed', { room_id: next.room_id, input: next.input })
      const before = new Set(previous?.screenshares ?? [])
      const after = new Set(next.screenshares)
      for (const user_id of after)
        if (!before.has(user_id))
          publish('call.screenshare_started', { room_id: next.room_id, user_id })
      for (const user_id of before)
        if (!after.has(user_id))
          publish('call.screenshare_ended', { room_id: next.room_id, user_id })
      const viewedBefore = new Set(previous?.viewed_screenshares ?? [])
      const viewedAfter = new Set(next.viewed_screenshares)
      for (const user_id of viewedAfter)
        if (!viewedBefore.has(user_id))
          publish('call.screenshare_joined', { room_id: next.room_id, user_id })
      for (const user_id of viewedBefore)
        if (!viewedAfter.has(user_id))
          publish('call.screenshare_left', { room_id: next.room_id, user_id })
    }
    window.addEventListener('foxchat-call-state', onCallState)
    window.setInterval(pollCalls, 1_000)
    const settings = automationSettings()
    if (settings.enabled)
      await configureAutomationApi(true, settings.port, settings.apiKey).catch((error) =>
        console.error('[automation-api] Could not start', error),
      )
    integrationStarted = true
  } finally {
    integrationStarting = false
  }
}
