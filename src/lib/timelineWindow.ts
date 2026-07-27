import type { MatrixEvent } from 'matrix-js-sdk'
import { isVisibleMessageEvent, MESSAGE_WINDOW_SIZE } from './eventHelpers'
import { isServerEventId } from './matrixIdentifiers'

export function addedVisibleEventCount(previousCount: number, currentCount: number) {
  return Math.max(0, currentCount - previousCount)
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
  boundaryEventId?: string,
) {
  // Unread counters can clear before sync echoes the latest receipt.
  if (unreadCount <= 0) {
    return { unreadStart: undefined, windowEndOffset: 0 }
  }
  const boundaryIndex = boundaryEventId
    ? events.findIndex((event) => event.getId() === boundaryEventId)
    : -1
  // Ignore a boundary that is no longer in the window.
  const boundedEvents =
    boundaryEventId && boundaryIndex >= 0 ? events.slice(0, boundaryIndex + 1) : events
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
