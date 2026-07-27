import { EventType, type MatrixEvent, type Room } from 'matrix-js-sdk'
import { isHiddenTimelineActivity } from '../lib/eventHelpers'
import { matrixService } from '../matrix/MatrixClientService'
import { isAndroidApp } from './nativeBackground'

type NativeNotifications = {
  isPermissionGranted(): Promise<boolean>
  requestPermission(): Promise<string>
  createChannel?(channel: {
    id: string
    name: string
    importance: number
    vibration: boolean
  }): Promise<void>
  sendNotification(options: {
    id?: number
    title: string
    body: string
    channelId?: string
    sound?: string
    group?: string
    extra?: Record<string, unknown>
    autoCancel?: boolean
  }): Promise<void>
  onAction?(
    callback: (notification: NotificationAction) => void,
  ): Promise<{ unregister(): Promise<void> }>
}

type NotificationAction = { data?: Record<string, string>; extra?: Record<string, unknown> }
type NativeNotificationReply = { id?: string; roomId?: string; text?: string }

declare global {
  interface Window {
    __foxchatPendingNotificationReplies?: NativeNotificationReply[]
    __TAURI__?: {
      notification?: NativeNotifications
      core?: { invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> }
    }
  }
}

const startedAt = Date.now()
const notified = new Set<string>()
const activeGroups = new Set<string>()
const notificationId = (value: string) =>
  [...value].reduce(
    (hash, character) => Math.imul(hash ^ character.charCodeAt(0), 16777619),
    -2128831035,
  ) | 0

function nativeNotifications(): NativeNotifications | undefined {
  if (window.__TAURI__?.notification) return window.__TAURI__.notification
  const invoke = window.__TAURI__?.core?.invoke
  if (!invoke) return undefined
  return {
    isPermissionGranted: () => invoke<boolean>('plugin:notification|is_permission_granted'),
    requestPermission: () => invoke<string>('plugin:notification|request_permission'),
    createChannel: (channel) => invoke<void>('plugin:notification|create_channel', { ...channel }),
    sendNotification: (options) => invoke<void>('plugin:notification|notify', { options }),
    onAction: (callback) => registerNotificationActionListener(callback),
  }
}

async function sendNativeNotificationReplies(replies: NativeNotificationReply[]) {
  for (const reply of replies) {
    const roomId = reply.roomId
    const text = reply.text?.trim()
    if (!roomId || !text) continue
    try {
      await matrixService.sendText(roomId, text)
    } catch (error) {
      console.error('[notifications] Could not send Android Auto reply', { roomId, error })
    }
  }
}

export function listenForNativeNotificationReplies() {
  let handled = new Set<string>()
  const receive = (event?: Event) => {
    const replies =
      (event as CustomEvent<NativeNotificationReply[]> | undefined)?.detail ??
      window.__foxchatPendingNotificationReplies ??
      []
    delete window.__foxchatPendingNotificationReplies
    const fresh = replies.filter((reply) => !reply.id || !handled.has(reply.id))
    for (const reply of fresh) if (reply.id) handled.add(reply.id)
    if (handled.size > 100) handled = new Set([...handled].slice(-50))
    void sendNativeNotificationReplies(fresh)
  }
  window.addEventListener('foxchat-native-notification-replies', receive)
  receive()
  return () => window.removeEventListener('foxchat-native-notification-replies', receive)
}

async function registerNotificationActionListener(
  callback: (notification: NotificationAction) => void,
) {
  const internals = (
    window as unknown as {
      __TAURI_INTERNALS__?: {
        invoke<T>(command: string, args?: Record<string, unknown>): Promise<T>
        transformCallback(
          callback: (payload: { message?: NotificationAction; end?: boolean }) => void,
          once?: boolean,
        ): number
        unregisterCallback(id: number): void
      }
    }
  ).__TAURI_INTERNALS__
  if (!internals) throw new Error('Tauri is unavailable')
  const ipcKey = '__TAURI_TO_IPC_KEY__'
  const channelId = internals.transformCallback((payload) => {
    if (payload.end) internals.unregisterCallback(channelId)
    else if (payload.message) callback(payload.message)
  })
  const handler = {
    id: channelId,
    [ipcKey]: () => `__CHANNEL__:${channelId}`,
    toJSON: () => `__CHANNEL__:${channelId}`,
  }
  await internals.invoke('plugin:notification|register_listener', {
    event: 'actionPerformed',
    handler,
  })
  return {
    unregister: async () => {
      await internals.invoke('plugin:notification|remove_listener', {
        event: 'actionPerformed',
        channelId,
      })
      internals.unregisterCallback(channelId)
    },
  }
}

function openNotificationRoom(roomId: string) {
  const url = new URL(window.location.href)
  url.searchParams.set('room', roomId)
  url.searchParams.delete('space')
  url.searchParams.delete('roomModal')
  url.searchParams.delete('drawerOpen')
  history.pushState(
    {
      ...history.state,
      foxchatRoom: roomId,
      foxchatSpace: undefined,
      foxchatRoomModal: undefined,
      foxchatDrawerOpen: false,
    },
    '',
    `${url.pathname}${url.search}${url.hash}`,
  )
  window.dispatchEvent(new PopStateEvent('popstate', { state: history.state }))
  window.focus()
}

export function listenForNotificationNavigation() {
  const notifications = nativeNotifications()
  if (!notifications?.onAction) return () => undefined
  let disposed = false
  let listener: { unregister(): Promise<void> } | undefined
  void notifications
    .onAction((notification) => {
      const roomId =
        notification.data?.room_id ??
        notification.data?.roomId ??
        notification.extra?.roomId ??
        notification.extra?.room_id
      if (typeof roomId === 'string' && roomId) openNotificationRoom(roomId)
    })
    .then((value) => {
      if (disposed) void value.unregister()
      else listener = value
    })
    .catch(() => undefined)
  return () => {
    disposed = true
    if (listener) void listener.unregister()
  }
}

function notificationGroup(room: Room) {
  return room.roomId
}

function groupUnreadCount(groupId: string, seen = new Set<string>()): number {
  if (seen.has(groupId)) return 0
  seen.add(groupId)
  const room = matrixService.room(groupId)
  if (!room) return 0
  const own = matrixService.effectiveUnreadCount(groupId)
  const children = room.currentState
    .getStateEvents(EventType.SpaceChild)
    .filter((event) => Array.isArray(event.getContent().via))
    .reduce((total, event) => total + groupUnreadCount(event.getStateKey() ?? '', seen), 0)
  return own + children
}

function clearReadGroups() {
  for (const groupId of activeGroups)
    if (groupUnreadCount(groupId) === 0) activeGroups.delete(groupId)
}

async function permissionGranted(native?: NativeNotifications) {
  if (native) {
    if (await native.isPermissionGranted()) return true
    return (await native.requestPermission()) === 'granted'
  }
  if (!('Notification' in window)) return false
  if (Notification.permission === 'granted') return true
  if (Notification.permission === 'denied') return false
  return (await Notification.requestPermission()) === 'granted'
}

export async function notifyMatrixEvent(event: MatrixEvent, room?: Room) {
  clearReadGroups()
  if (isHiddenTimelineActivity(event)) return
  if (isAndroidApp()) return
  if (!room || event.getType() !== EventType.RoomMessage || event.isRedacted()) return
  const client = matrixService.matrixClient
  const senderId = event.getSender()
  const ownUserIds = new Set(matrixService.availableAccounts().map((account) => account.userId))
  if (!client || !senderId || ownUserIds.has(senderId)) return
  if (
    event.getTs() < startedAt - 2_000 ||
    (document.hasFocus() && document.visibilityState === 'visible')
  )
    return
  const eventId = event.getId()
  if (!eventId || notified.has(eventId)) return
  notified.add(eventId)
  if (notified.size > 1_000) notified.delete(notified.values().next().value!)
  const content = event.getContent()
  const relation = content['m.relates_to'] as { rel_type?: string } | undefined
  if (relation?.rel_type === 'm.replace') return
  if (!client.getPushActionsForEvent(event)?.notify) return
  const groupId = notificationGroup(room)
  const silent = activeGroups.has(groupId) && groupUnreadCount(groupId) > 0
  const sender = room.getMember(senderId)?.name ?? senderId
  const body = String(content.body ?? 'Sent an attachment')
  const native = nativeNotifications()
  if (!(await permissionGranted(native))) return
  if (native) {
    await native
      .createChannel?.({ id: 'messages', name: 'New messages', importance: 4, vibration: true })
      .catch(() => undefined)
    await native
      .createChannel?.({
        id: 'messages_silent',
        name: 'Additional unread messages',
        importance: 3,
        vibration: false,
      })
      .catch(() => undefined)
    await native.sendNotification({
      id: notificationId(eventId),
      title: `${sender} in ${room.name}`,
      body,
      channelId: silent ? 'messages_silent' : 'messages',
      sound: silent ? undefined : 'notification',
      group: `foxchat.room.${room.roomId}`,
      extra: { roomId: room.roomId },
      autoCancel: true,
    })
  } else {
    const notification = new Notification(`${sender} in ${room.name}`, { body, tag: eventId })
    notification.onclick = () => {
      notification.close()
      openNotificationRoom(room.roomId)
    }
    new Audio('/notification.ogg').play().catch(() => undefined)
  }
  activeGroups.add(groupId)
}
