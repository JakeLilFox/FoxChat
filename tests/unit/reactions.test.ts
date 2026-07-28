// @vitest-environment jsdom

import { EventType, MatrixEvent, RelationType, type MatrixClient, type Room } from 'matrix-js-sdk'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MatrixClientService } from '../../src/matrix/MatrixClientService'

describe('reactions', () => {
  beforeEach(() => localStorage.clear())

  it('re-aggregates relation events restored with a room timeline', () => {
    const relation = new MatrixEvent({
      event_id: '$reaction',
      room_id: '!room:example.org',
      sender: '@alice:example.org',
      origin_server_ts: 1,
      type: EventType.Reaction,
      content: {
        'm.relates_to': {
          rel_type: RelationType.Annotation,
          event_id: '$message',
          key: '👍',
        },
      },
    })
    const aggregateChildEvent = vi.fn()
    const room = {
      roomId: '!room:example.org',
      name: 'Room',
      getLiveTimeline: () => ({ getEvents: () => [relation] }),
      relations: { aggregateChildEvent },
    }
    const client = {} as MatrixClient
    const service = new MatrixClientService()
    const internals = service as unknown as {
      applyLocalRoomName: () => void
      trackRoomOwner: (client: MatrixClient, room: Room) => void
    }
    internals.applyLocalRoomName = () => undefined

    internals.trackRoomOwner(client, room as unknown as Room)

    expect(aggregateChildEvent).toHaveBeenCalledWith(relation)
  })

  it('removes an accepted reaction redaction from the local relation aggregation', async () => {
    const reaction = new MatrixEvent({
      event_id: '$reaction',
      room_id: '!room:example.org',
      sender: '@alice:example.org',
      origin_server_ts: 1,
      type: EventType.Reaction,
      content: {
        'm.relates_to': {
          rel_type: RelationType.Annotation,
          event_id: '$message',
          key: '👍',
        },
      },
    })
    const removeEvent = vi.fn().mockResolvedValue(undefined)
    const getChildEventsForEvent = vi.fn().mockReturnValue({ removeEvent })
    const room = {
      relations: { getChildEventsForEvent },
    }
    const originalRelation = reaction.getRelation()
    let redacted = false
    vi.spyOn(reaction, 'getRelation').mockImplementation(() => (redacted ? null : originalRelation))
    const redactEvent = vi.fn().mockImplementation(async () => {
      redacted = true
      return { event_id: '$redaction' }
    })
    const client = {
      getRoom: () => room,
      redactEvent,
    } as unknown as MatrixClient
    const service = new MatrixClientService()
    const onEvent = vi.fn()
    service.subscribe({ onEvent })
    const internals = service as unknown as {
      roomAccounts: () => Array<{ userId: string; client: MatrixClient }>
    }
    internals.roomAccounts = () => [{ userId: '@alice:example.org', client }]

    await service.redactMessage(reaction)

    expect(redactEvent).toHaveBeenCalledWith('!room:example.org', '$reaction')
    expect(getChildEventsForEvent).toHaveBeenCalledWith(
      '$message',
      RelationType.Annotation,
      EventType.Reaction,
    )
    expect(removeEvent).toHaveBeenCalledWith(reaction)
    expect(onEvent).toHaveBeenCalledWith(reaction, room)
  })

  it('restores known reactions from the relations endpoint after a reload', async () => {
    const parent = new MatrixEvent({
      event_id: '$message',
      room_id: '!room:example.org',
      sender: '@alice:example.org',
      origin_server_ts: 1,
      type: EventType.RoomMessage,
      content: { msgtype: 'm.text', body: 'Hello' },
    })
    const reaction = new MatrixEvent({
      event_id: '$reaction',
      room_id: '!room:example.org',
      sender: '@alice:example.org',
      origin_server_ts: 2,
      type: EventType.Reaction,
      content: {
        'm.relates_to': {
          rel_type: RelationType.Annotation,
          event_id: '$message',
          key: '👍',
        },
      },
    })
    const aggregateChildEvent = vi.fn()
    const room = {
      relations: { aggregateChildEvent },
    }
    const sendEvent = vi.fn().mockResolvedValue({ event_id: '$reaction' })
    const relations = vi.fn().mockResolvedValue({ events: [reaction] })
    const client = {
      getRoom: () => room,
      relations,
      sendEvent,
    } as unknown as MatrixClient
    const service = new MatrixClientService()
    vi.spyOn(service, 'clientForRoom').mockReturnValue(client)
    const onEvent = vi.fn()
    service.subscribe({ onEvent })

    await service.sendReaction(parent, '👍')
    expect(service.mayHaveReactions(parent)).toBe(true)

    await service.loadReactions(parent)

    expect(relations).toHaveBeenCalledWith(
      '!room:example.org',
      '$message',
      RelationType.Annotation,
      EventType.Reaction,
      { dir: expect.anything(), from: undefined, limit: 100 },
    )
    expect(aggregateChildEvent).toHaveBeenCalledWith(reaction)
    expect(onEvent).toHaveBeenCalledWith(parent, room)
  })
})
