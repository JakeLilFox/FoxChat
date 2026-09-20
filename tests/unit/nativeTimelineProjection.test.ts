// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createClient, MatrixEvent, Room } from 'matrix-js-sdk'
import { MatrixClientService } from '../../src/matrix/MatrixClientService'

const userId = '@me:example.org'
const roomId = '!room:example.org'
const raw = (id: string, body: string) => ({
  event_id: id,
  room_id: roomId,
  sender: userId,
  origin_server_ts: 1,
  type: 'm.room.message',
  content: { msgtype: 'm.text', body },
})

describe('native timeline page projection', () => {
  afterEach(() => vi.restoreAllMocks())
  const setup = () => {
    const client = createClient({ baseUrl: 'https://example.org', userId })
    const room = new Room(roomId, client, userId)
    client.store.storeRoom(room)
    const service = new MatrixClientService()
    vi.spyOn(service, 'availableAccounts').mockReturnValue([
      { id: 'account', userId, client },
    ] as never)
    const onEvent = vi.fn()
    service.subscribe({ onEvent })
    const apply = (events: ReturnType<typeof raw>[], backwards = false, initial = false) =>
      service['applyNativeTimelineBatch']({
        userId,
        roomId,
        backwards,
        initial,
        events: events.map((event) => ({
          eventId: event.event_id,
          rawEvent: JSON.stringify(event),
        })),
      })
    return { room, apply, onEvent }
  }

  it('replaces encrypted events with clear Rust JSON and publishes subsequent changes', async () => {
    const { room, apply, onEvent } = setup()
    await room.addLiveEvents(
      [
        new MatrixEvent({
          ...raw('$a', ''),
          type: 'm.room.encrypted',
          content: { algorithm: 'm.megolm.v1.aes-sha2', ciphertext: 'encrypted' },
        }),
      ],
      { addToState: false },
    )
    await apply([raw('$a', 'clear')])
    expect(room.findEventById('$a')?.getContent().body).toBe('clear')
    expect(onEvent).toHaveBeenCalledOnce()
    await apply([raw('$a', 'updated')])
    expect(room.findEventById('$a')?.getContent().body).toBe('updated')
    expect(onEvent).toHaveBeenCalledTimes(2)
    await apply([raw('$a', 'updated')])
    expect(onEvent).toHaveBeenCalledTimes(2)
    expect(room.getLiveTimeline().getEvents()).toHaveLength(1)
  })

  it('prepends history in page order without duplicating an overlapping event', async () => {
    const { room, apply } = setup()
    await apply([raw('$c', 'c'), raw('$d', 'd')])
    await apply([raw('$a', 'a'), raw('$b', 'b'), raw('$c', 'c')], true)
    expect(
      room
        .getLiveTimeline()
        .getEvents()
        .map((event) => event.getId()),
    ).toEqual(['$a', '$b', '$c', '$d'])
  })

  it('updates overlapping history events without moving them to the live edge', async () => {
    const { room, apply } = setup()
    await apply([raw('$b', 'old'), raw('$c', 'c')])
    await apply([raw('$a', 'a'), raw('$b', 'decrypted')], true)
    expect(
      room
        .getLiveTimeline()
        .getEvents()
        .map((event) => event.getId()),
    ).toEqual(['$a', '$b', '$c'])
    expect(room.findEventById('$b')?.getContent().body).toBe('decrypted')
  })

  it('starts with a contiguous native page instead of merging a disconnected persisted window', async () => {
    const { room, apply } = setup()
    await apply([raw('$stale', 'stale')])
    await apply([raw('$new', 'new')], false, true)
    expect(
      room
        .getLiveTimeline()
        .getEvents()
        .map((event) => event.getId()),
    ).toEqual(['$new'])
  })
})
