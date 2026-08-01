import { vi } from 'vitest'
import {
  NotificationCountType,
  PushRuleActionName,
  PushRuleKind,
  RuleId,
  type MatrixEvent,
  type Room,
  type RoomType,
} from 'matrix-js-sdk'
import { ReceiptType } from 'matrix-js-sdk/lib/@types/read_receipts'

export type FakeRoomOptions = {
  roomId: string
  name?: string
  type?: RoomType
  version?: string
  membership?: 'join' | 'invite' | 'leave'
  members?: Record<string, number>
  state?: Record<string, unknown>
  maySendStateEvent?: boolean | ((eventType: string, userId: string) => boolean)
  maySendMessage?: boolean
  createSender?: string
  events?: MatrixEvent[]
  unreadTotal?: number
  unreadHighlight?: number
  readReceipts?: Record<string, string>
  readReceiptTimestamps?: Record<string, number>
  privateReadReceipts?: Record<string, string>
  privateReadReceiptTimestamps?: Record<string, number>
  readUpTo?: Record<string, string>
  fullyRead?: string
  hasThreadUnread?: boolean
  threads?: Array<{ id: string }>
}

export type FakeEventOptions = {
  id: string
  roomId?: string
  type?: string
  sender: string
  ts?: number
  redacted?: boolean
  notify?: boolean
  content?: Record<string, unknown>
  prevContent?: Record<string, unknown>
}

export function fakeEvent(options: FakeEventOptions): MatrixEvent {
  const content = options.content ?? { msgtype: 'm.text', body: options.id }
  const event = {
    getId: () => options.id,
    getRoomId: () => options.roomId,
    getType: () => options.type ?? 'm.room.message',
    getSender: () => options.sender,
    getTs: () => options.ts ?? 0,
    isRedacted: () => options.redacted ?? false,
    isDecryptionFailure: () => false,
    getContent: <T>() => content as T,
    getOriginalContent: <T>() => content as T,
    getPrevContent: <T>() => (options.prevContent ?? {}) as T,

    __notify: options.notify ?? false,
  }
  return event as unknown as MatrixEvent
}

const stateMapKey = (type: string, stateKey: string) => `${type} ${stateKey}`

export function fakeRoom(options: FakeRoomOptions): Room {
  const entries = new Map<string, unknown>()
  for (const [key, content] of Object.entries(options.state ?? {})) {
    const separator = key.indexOf(':')
    const type = separator >= 0 ? key.slice(0, separator) : key
    const stateKey = separator >= 0 ? key.slice(separator + 1) : ''
    entries.set(stateMapKey(type, stateKey), content)
  }
  const wrapEvent = (stateKey: string, content: unknown) => ({
    getContent: <T>() => content as T,
    getSender: () => options.createSender,
    getStateKey: () => stateKey,
  })
  let membership = options.membership ?? 'join'
  const events = [...(options.events ?? [])]
  const counts = {
    [NotificationCountType.Total]: options.unreadTotal ?? 0,
    [NotificationCountType.Highlight]: options.unreadHighlight ?? 0,
  } as Record<NotificationCountType, number>
  const receipts = { ...(options.readReceipts ?? {}) }
  const privateReceipts = { ...(options.privateReadReceipts ?? {}) }
  let hasThreadUnread = options.hasThreadUnread ?? false
  const threads = options.threads ?? []
  const room = {
    roomId: options.roomId,
    name: options.name ?? options.roomId,
    getType: () => options.type,
    getVersion: () => options.version ?? '10',
    getMyMembership: () => membership,
    __setMembership: (value: 'join' | 'invite' | 'leave') => {
      membership = value
    },
    maySendMessage: () => options.maySendMessage ?? true,
    getMember: (userId: string) => {
      const level = options.members?.[userId]
      return level === undefined ? null : { userId, powerLevel: level }
    },
    getJoinedMembers: () => Object.keys(options.members ?? {}).map((userId) => ({ userId })),
    currentState: {
      getStateEvents: (type: string, stateKey?: string) => {
        if (stateKey === undefined) {
          const prefix = `${type} `
          return [...entries.entries()]
            .filter(([key]) => key.startsWith(prefix))
            .map(([key, content]) => wrapEvent(key.slice(prefix.length), content))
        }
        const content = entries.get(stateMapKey(type, stateKey))
        return content === undefined ? undefined : wrapEvent(stateKey, content)
      },
      maySendStateEvent: (type: string, userId: string) =>
        typeof options.maySendStateEvent === 'function'
          ? options.maySendStateEvent(type, userId)
          : (options.maySendStateEvent ?? true),
    },
    getLiveTimeline: () => ({ getEvents: () => events }),
    findEventById: (eventId: string) => events.find((event) => event.getId() === eventId),
    hasPendingEvent: () => false,
    getReadReceiptForUserId: (
      userId: string,
      _ignoreSynthesized = false,
      receiptType = ReceiptType.Read,
    ) => {
      const eventId =
        receiptType === ReceiptType.ReadPrivate ? privateReceipts[userId] : receipts[userId]
      const timestamp =
        receiptType === ReceiptType.ReadPrivate
          ? options.privateReadReceiptTimestamps?.[userId]
          : options.readReceiptTimestamps?.[userId]
      return eventId ? { eventId, data: timestamp === undefined ? {} : { ts: timestamp } } : null
    },
    getEventReadUpTo: (userId: string) => {
      const eventId =
        options.readUpTo?.[userId] ?? privateReceipts[userId] ?? receipts[userId] ?? null
      return eventId && events.some((event) => event.getId() === eventId) ? eventId : null
    },
    getAccountData: (type: string) =>
      type === 'm.fully_read' && options.fullyRead
        ? { getContent: () => ({ event_id: options.fullyRead }) }
        : undefined,
    getUnreadNotificationCount: (type: NotificationCountType = NotificationCountType.Total) =>
      counts[type] ?? 0,
    setUnreadNotificationCount: vi.fn((type: NotificationCountType, value: number) => {
      counts[type] = value
    }),
    hasThreadUnreadNotification: () => hasThreadUnread,
    __setHasThreadUnread: (value: boolean) => {
      hasThreadUnread = value
    },
    getThreads: () => threads,
    setThreadUnreadNotificationCount: vi.fn(),
  }
  return room as unknown as Room
}

export function fakeClient(rooms: Room[], userId = '@me:example.org') {
  const registry = new Map(rooms.map((room) => [room.roomId, room]))
  const sendStateEvent = vi.fn(
    async (_roomId: string, _type: string, _content: unknown, _stateKey?: string) => ({
      event_id: '$fake',
    }),
  )
  const sendReadReceipt = vi.fn(async () => undefined)
  const setRoomReadMarkers = vi.fn(async () => undefined)
  return {
    getRoom: (roomId: string) => registry.get(roomId),
    getRooms: () => [...registry.values()],
    getUserId: () => userId,
    getSafeUserId: () => userId,
    sendStateEvent,
    sendReadReceipt,
    setRoomReadMarkers,
    getRoomPushRule: () => ({ actions: [PushRuleActionName.Notify] }),
    getPushActionsForEvent: (event: MatrixEvent) => ({
      notify: !!(event as unknown as { __notify?: boolean }).__notify,
      tweaks: {},
    }),
    getPushDetailsForEvent: (event: MatrixEvent) => {
      const notify = !!(event as unknown as { __notify?: boolean }).__notify
      const mentions = event.getContent<{
        'm.mentions'?: { user_ids?: string[]; room?: boolean }
      }>()['m.mentions']
      const userMentioned = mentions?.user_ids?.includes(userId) === true
      const roomMentioned = mentions?.room === true
      return {
        actions: { notify, tweaks: { highlight: userMentioned || roomMentioned } },
        rule: {
          actions: [PushRuleActionName.Notify],
          default: true,
          enabled: true,
          kind: userMentioned || roomMentioned ? PushRuleKind.Override : PushRuleKind.Underride,
          rule_id: userMentioned
            ? RuleId.IsUserMention
            : roomMentioned
              ? RuleId.IsRoomMention
              : RuleId.Message,
        },
      }
    },
  }
}
export type FakeClient = ReturnType<typeof fakeClient>

export function setFakeMembership(room: Room, membership: 'join' | 'invite' | 'leave') {
  ;(
    room as unknown as { __setMembership(value: 'join' | 'invite' | 'leave'): void }
  ).__setMembership(membership)
}
