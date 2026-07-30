import {
  eventBody,
  isMembershipChange,
  isTimelineEvent,
  isVisibleMessageEvent,
} from './eventHelpers'
import { TypingPreview } from '../styles'
import { Direction, EventType, MatrixEvent, Room, RoomType } from 'matrix-js-sdk'
import { matrixService } from '../matrix/MatrixClientService'
import { shouldGroupMessages } from './timelinePresentation'

export const logHistoryDiagnostics = (
  room: Room,
  label: string,
  extra: Record<string, unknown> = {},
) => {
  const timeline = room.getLiveTimeline()
  const events = timeline.getEvents()
  const typeCounts = new Map<string, number>()
  let visibleMessageCount = 0
  let membershipTransitionCount = 0
  for (const event of events) {
    const type = event.getType()
    typeCounts.set(type, (typeCounts.get(type) ?? 0) + 1)
    if (isVisibleMessageEvent(event)) visibleMessageCount++
    if (isMembershipChange(event)) membershipTransitionCount++
  }
  const types = Object.fromEntries(
    [...typeCounts].sort(([first], [second]) => first.localeCompare(second)),
  )
  console.info('[FoxChat history]', {
    label,
    at: new Date().toISOString(),
    room_id: room.roomId,
    room_name: room.name,
    membership: room.getMyMembership(),
    raw_event_count: events.length,
    visible_message_count: visibleMessageCount,
    membership_transition_count: membershipTransitionCount,
    event_types: types,
    backward_pagination_token: timeline.getPaginationToken(Direction.Backward),
    forward_pagination_token: timeline.getPaginationToken(Direction.Forward),
    first_event: events[0]
      ? {
          id: events[0].getId(),
          type: events[0].getType(),
          timestamp: events[0].getTs(),
        }
      : null,
    last_event: events.at(-1)
      ? {
          id: events.at(-1)!.getId(),
          type: events.at(-1)!.getType(),
          timestamp: events.at(-1)!.getTs(),
        }
      : null,
    ...extra,
  })
}
export type MessagePositionIndex = {
  sourceLength: number
  sourceFirst?: MatrixEvent
  sourceLast?: MatrixEvent
  events: MatrixEvent[]
  byEvent: Map<MatrixEvent, number>
  byId: Map<string, number>
}
export const messagePositionCache = new WeakMap<Room, MessagePositionIndex>()
export const buildMessagePositionIndex = (room: Room): MessagePositionIndex => {
  const source = room.getLiveTimeline().getEvents()
  const events = source.filter(isTimelineEvent)
  return {
    sourceLength: source.length,
    sourceFirst: source[0],
    sourceLast: source.at(-1),
    events,
    byEvent: new Map(events.map((item, index) => [item, index])),
    byId: new Map(events.flatMap((item, index) => (item.getId() ? [[item.getId()!, index]] : []))),
  }
}
export const messagePosition = (room: Room, event: MatrixEvent) => {
  const source = room.getLiveTimeline().getEvents()
  let cached = messagePositionCache.get(room)
  let index =
    cached?.byEvent.get(event) ?? (event.getId() ? cached?.byId.get(event.getId()!) : undefined)
  if (
    !cached ||
    cached.sourceLength !== source.length ||
    cached.sourceFirst !== source[0] ||
    cached.sourceLast !== source.at(-1) ||
    index === undefined
  ) {
    cached = buildMessagePositionIndex(room)
    messagePositionCache.set(room, cached)
    index =
      cached.byEvent.get(event) ?? (event.getId() ? cached.byId.get(event.getId()!) : undefined)
  }
  const previous = index !== undefined && index > 0 ? cached.events[index - 1] : undefined
  const next = index !== undefined ? cached.events[index + 1] : undefined
  return {
    grouped: !!previous && shouldGroupMessages(previous, event),
    continues: !!next && shouldGroupMessages(event, next),
  }
}
export const lastMessagePreview = (room: Room) =>
  eventBody([...room.getLiveTimeline().getEvents()].reverse().find(isVisibleMessageEvent)) ||
  'No messages yet'
export const roomUnreadCount = (
  room: Room,
  seen = new Set<string>(),
  ownUnread: (roomId: string) => number = (roomId) => matrixService.effectiveUnreadCount(roomId),
): number => {
  if (seen.has(room.roomId)) return 0
  seen.add(room.roomId)
  const own = ownUnread(room.roomId)
  if (room.getType() !== RoomType.Space) return own
  const client = matrixService.clientForRoomInstance(room)
  const children = room.currentState
    .getStateEvents(EventType.SpaceChild)
    .filter((event) => Array.isArray(event.getContent().via))
    .map(
      (event) =>
        client?.getRoom(event.getStateKey() ?? '') ?? matrixService.room(event.getStateKey() ?? ''),
    )
    .filter((child): child is Room => !!child)
  return own + children.reduce((total, child) => total + roomUnreadCount(child, seen, ownUnread), 0)
}
export const roomHasTyping = (
  room: Room,
  seen = new Set<string>(),
  ownIds = new Set(matrixService.availableAccounts().map((account) => account.userId)),
): boolean => {
  if (seen.has(room.roomId)) return false
  seen.add(room.roomId)
  if (room.getJoinedMembers().some((member) => member.typing && !ownIds.has(member.userId)))
    return true
  if (room.getType() !== RoomType.Space) return false
  const client = matrixService.clientForRoomInstance(room)
  return room.currentState
    .getStateEvents(EventType.SpaceChild)
    .filter((event) => Array.isArray(event.getContent().via))
    .map(
      (event) =>
        client?.getRoom(event.getStateKey() ?? '') ?? matrixService.room(event.getStateKey() ?? ''),
    )
    .filter((child): child is Room => !!child)
    .some((child) => roomHasTyping(child, seen, ownIds))
}
export const typingPreview = (
  <TypingPreview>
    Typing
    <span className="typingDots" aria-hidden>
      <i />
      <i />
      <i />
    </span>
  </TypingPreview>
)
export const roomLatestTs = (room: Room, seen = new Set<string>()): number => {
  if (seen.has(room.roomId)) return 0
  seen.add(room.roomId)
  const events = room.getLiveTimeline().getEvents()
  let own = 0
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (!isTimelineEvent(events[index])) continue
    own = events[index].getTs()
    break
  }
  if (room.getType() !== RoomType.Space) return own
  const client = matrixService.clientForRoomInstance(room)
  const children = room.currentState
    .getStateEvents(EventType.SpaceChild)
    .filter((event) => Array.isArray(event.getContent().via))
    .map(
      (event) =>
        client?.getRoom(event.getStateKey() ?? '') ?? matrixService.room(event.getStateKey() ?? ''),
    )
    .filter((child): child is Room => !!child)
  return Math.max(own, ...children.map((child) => roomLatestTs(child, seen)))
}
export const fittedMediaSize = (
  info: Record<string, unknown> | undefined,
  maxWidth: number,
  maxHeight: number,
  fallbackWidth: number,
  fallbackHeight: number,
) => {
  const sourceWidth = Number(info?.w) || fallbackWidth
  const sourceHeight = Number(info?.h) || fallbackHeight
  const scale = Math.min(1, maxWidth / sourceWidth, maxHeight / sourceHeight)
  return {
    width: Math.max(1, Math.round(sourceWidth * scale)),
    height: Math.max(1, Math.round(sourceHeight * scale)),
  }
}
