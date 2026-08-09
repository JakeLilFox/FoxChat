import type { MatrixEvent, Room } from 'matrix-js-sdk'
import { isVisibleMessageEvent } from './eventHelpers'

export type RecentMessageCandidate = { event: MatrixEvent; room: Room }

export const selectRecentMessageCandidates = (
  rooms: Room[],
  sinceTs: number | undefined,
  limit: number,
  eventsForRoom: (room: Room) => MatrixEvent[] = (room) => room.getLiveTimeline().getEvents(),
) => {
  const candidates: RecentMessageCandidate[] = []
  for (const room of rooms)
    for (const event of eventsForRoom(room)) {
      if (!isVisibleMessageEvent(event)) continue
      if (sinceTs !== undefined && event.getTs() <= sinceTs) continue
      candidates.push({ event, room })
    }

  candidates.sort((a, b) => a.event.getTs() - b.event.getTs())
  return candidates.slice(-limit)
}
