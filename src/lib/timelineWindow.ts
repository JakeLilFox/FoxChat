import type { MatrixEvent } from 'matrix-js-sdk'
import { isVisibleMessageEvent, MESSAGE_WINDOW_SIZE } from './eventHelpers'
import { isServerEventId } from './matrixIdentifiers'

export function addedVisibleEventCount(previousCount: number, currentCount: number) {
  return Math.max(0, currentCount - previousCount)
}

export function mergeTimelineEventSegments(...segments: MatrixEvent[][]) {
  const merged: MatrixEvent[] = []
  const positions = new Map<string, number>()
  for (const events of segments) {
    for (const event of events) {
      const eventId = event.getId()
      const transactionId = event.getTxnId?.()
      const keys = [
        eventId ? `event:${eventId}` : undefined,
        transactionId ? `txn:${event.getSender() ?? ''}:${transactionId}` : undefined,
      ].filter((key): key is string => !!key)
      const existing = keys.map((key) => positions.get(key)).find((index) => index !== undefined)
      const index = existing ?? merged.length
      if (existing === undefined) {
        if (!keys.length && merged.includes(event)) continue
        merged.push(event)
      } else merged[index] = event
      for (const key of keys) positions.set(key, index)
    }
  }
  return merged.sort((first, second) => first.getTs() - second.getTs())
}

export function shouldHandleTimelineGrowth(
  newestChanged: boolean,
  addedVisibleEvents: number,
  historyPageInProgress = false,
) {
  return !historyPageInProgress && (newestChanged || addedVisibleEvents > 0)
}

export function nextFollowLatest(
  followingLatest: boolean,
  atBottom: boolean,
  hasUserScrollIntent: boolean,
) {
  if (atBottom) return true
  return hasUserScrollIntent ? false : followingLatest
}

export function shouldFollowAddedEvents(
  followingLatest: boolean,
  windowEndOffset: number,
  bottomDistance: number,
  bottomThreshold: number,
) {
  return (
    windowEndOffset === 0 && (followingLatest || bottomDistance <= Math.max(0, bottomThreshold))
  )
}

export function visibleReadBoundary(
  events: MatrixEvent[],
  visibleEventId: string | undefined,
  atBottom: boolean,
) {
  // State events can carry notifications without rendering a message row.
  if (atBottom) {
    return [...events].reverse().find((event) => isServerEventId(event.getId()))
  }
  return visibleEventId ? events.find((event) => event.getId() === visibleEventId) : undefined
}

export function initialTimelinePosition(
  events: MatrixEvent[],
  readEventId: string | undefined,
  unreadCount: number,
  ownUserIds: ReadonlySet<string>,
  boundaryEventId?: string | null,
) {
  // Unread counters can clear before sync echoes the latest receipt.
  if (unreadCount <= 0) {
    return { unreadStart: undefined, windowEndOffset: 0 }
  }
  const boundaryIndex = boundaryEventId
    ? events.findIndex((event) => event.getId() === boundaryEventId)
    : -1
  // null means the room had no events when positioning began. Ignore a string boundary that is
  // no longer in the window.
  const boundedEvents =
    boundaryEventId === null
      ? []
      : boundaryEventId && boundaryIndex >= 0
        ? events.slice(0, boundaryIndex + 1)
        : events
  const current = boundedEvents.filter(isVisibleMessageEvent)
  const readIndex = readEventId ? current.findIndex((event) => event.getId() === readEventId) : -1
  const firstCandidate =
    readIndex >= 0 ? readIndex + 1 : Math.max(0, current.length - Math.max(0, unreadCount))
  let unreadIndex = -1
  for (let index = firstCandidate; index < current.length; index++) {
    if (ownUserIds.has(current[index].getSender() ?? '')) continue
    unreadIndex = index
    break
  }
  const unreadStart = unreadIndex >= 0 ? current[unreadIndex].getId() : undefined
  if (!unreadStart) return { unreadStart: undefined, windowEndOffset: 0 }
  const desiredEnd = Math.min(current.length, unreadIndex + MESSAGE_WINDOW_SIZE)
  return {
    unreadStart,
    windowEndOffset: Math.max(0, current.length - desiredEnd),
  }
}
