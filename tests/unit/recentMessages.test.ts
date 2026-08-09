// @vitest-environment jsdom

import { EventType, MatrixEvent, type Room } from 'matrix-js-sdk'
import { describe, expect, it } from 'vitest'
import { selectRecentMessageCandidates } from '../../src/lib/recentMessages'

const room = (roomId: string) => ({ roomId }) as Room

const message = (eventId: string, timestamp: number) =>
  new MatrixEvent({
    event_id: eventId,
    type: EventType.RoomMessage,
    sender: '@alice:example.org',
    origin_server_ts: timestamp,
    content: { msgtype: 'm.text', body: eventId },
  })

describe('recent automation messages', () => {
  it('returns only the newest limit messages across all rooms', () => {
    const firstRoom = room('!first:example.org')
    const secondRoom = room('!second:example.org')
    const events = new Map<Room, MatrixEvent[]>([
      [firstRoom, [message('$first-old', 100), message('$first-new', 500)]],
      [secondRoom, [message('$second-old', 200), message('$second-new', 400)]],
    ])

    const selected = selectRecentMessageCandidates(
      [firstRoom, secondRoom],
      undefined,
      2,
      (candidate) => events.get(candidate) ?? [],
    )

    expect(selected.map(({ event }) => event.getId())).toEqual(['$second-new', '$first-new'])
  })

  it('takes the newest limit messages after a cursor instead of the oldest backlog entries', () => {
    const firstRoom = room('!first:example.org')
    const secondRoom = room('!second:example.org')
    const events = new Map<Room, MatrixEvent[]>([
      [firstRoom, [message('$oldest-after-cursor', 200), message('$newest', 500)]],
      [secondRoom, [message('$before-cursor', 100), message('$middle', 400)]],
    ])

    const selected = selectRecentMessageCandidates(
      [firstRoom, secondRoom],
      100,
      2,
      (candidate) => events.get(candidate) ?? [],
    )

    expect(selected.map(({ event }) => event.getId())).toEqual(['$middle', '$newest'])
  })

  it('ignores edits and non-message timeline events before applying the limit', () => {
    const targetRoom = room('!room:example.org')
    const edit = new MatrixEvent({
      event_id: '$edit',
      type: EventType.RoomMessage,
      sender: '@alice:example.org',
      origin_server_ts: 500,
      content: {
        msgtype: 'm.text',
        body: 'edited',
        'm.relates_to': { rel_type: 'm.replace', event_id: '$message' },
      },
    })
    const stateEvent = new MatrixEvent({
      event_id: '$state',
      type: EventType.RoomName,
      sender: '@alice:example.org',
      origin_server_ts: 600,
      state_key: '',
      content: { name: 'Renamed' },
    })

    const selected = selectRecentMessageCandidates([targetRoom], undefined, 1, () => [
      message('$message', 400),
      edit,
      stateEvent,
    ])

    expect(selected.map(({ event }) => event.getId())).toEqual(['$message'])
  })
})
