// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  androidRoomSnapshotFromSavedSync,
  cacheAndroidRoomTimeline,
  fetchAndroidRoomSnapshot,
  mergeAndroidRoomTimelineCache,
} from '../../src/matrix/MatrixClientService'

describe('Android room snapshot', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('returns the bounded snapshot and authenticates the request', async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ next_batch: 'next' }),
    })

    await expect(
      fetchAndroidRoomSnapshot(
        'https://matrix.example/_matrix/client/v3/sync',
        'token',
        1_000,
        fetcher,
      ),
    ).resolves.toEqual({ next_batch: 'next' })
    expect(fetcher).toHaveBeenCalledWith(
      'https://matrix.example/_matrix/client/v3/sync',
      expect.objectContaining({
        headers: { Authorization: 'Bearer token' },
        signal: expect.any(AbortSignal),
      }),
    )
  })

  it('reconstructs an immediately usable sync response from the IndexedDB projection', () => {
    const roomsData = { join: { '!room:example.org': { timeline: { events: [] } } } }
    const accountData = [{ type: 'm.direct', content: {} }]

    expect(
      androidRoomSnapshotFromSavedSync({
        nextBatch: 'cached-next',
        roomsData,
        accountData,
      }),
    ).toEqual({
      next_batch: 'cached-next',
      rooms: roomsData,
      account_data: { events: accountData },
    })
    expect(androidRoomSnapshotFromSavedSync(null)).toBeUndefined()
  })

  it('aborts instead of leaving Android startup pending forever', async () => {
    vi.useFakeTimers()
    const fetcher = vi.fn(
      (_url, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('The operation was aborted', 'AbortError')),
          )
        }),
    )
    const snapshot = fetchAndroidRoomSnapshot(
      'https://matrix.example/_matrix/client/v3/sync',
      'token',
      250,
      fetcher as typeof fetch,
    )
    const rejection = expect(snapshot).rejects.toThrow(
      'Android room snapshot timed out after 250 ms',
    )

    await vi.advanceTimersByTimeAsync(250)
    await rejection
  })

  it('preserves a homeserver HTTP failure', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: false, status: 401 })

    await expect(
      fetchAndroidRoomSnapshot(
        'https://matrix.example/_matrix/client/v3/sync',
        'token',
        1_000,
        fetcher,
      ),
    ).rejects.toThrow('Android room snapshot failed with HTTP 401')
  })

  it('persists only the newest 40 native timeline events', () => {
    const snapshot = {
      next_batch: 'next',
      rooms: {
        join: {
          '!room:example.org': {
            state: { events: [{ type: 'm.room.name' }] },
            timeline: { events: [] },
          },
        },
      },
    }
    const events = Array.from({ length: 50 }, (_, index) => ({
      event_id: `$${index + 1}`,
      origin_server_ts: index + 1,
      type: 'm.room.message',
      content: { body: `${index + 1}` },
    }))

    const cached = cacheAndroidRoomTimeline(snapshot, '!room:example.org', events)
    const room = (cached.rooms as typeof snapshot.rooms).join['!room:example.org']
    const timelineEvents = room.timeline.events as Array<{ event_id: string }>
    expect(timelineEvents).toHaveLength(40)
    expect(timelineEvents[0].event_id).toBe('$11')
    expect(timelineEvents.at(-1)?.event_id).toBe('$50')
    expect(room.state.events).toEqual([{ type: 'm.room.name' }])
  })

  it('keeps the clear cached block when the fresh room projection contains one event', () => {
    const cached = {
      next_batch: 'cached',
      rooms: {
        join: {
          '!room:example.org': {
            timeline: {
              events: [
                {
                  event_id: '$same',
                  origin_server_ts: 1,
                  type: 'm.room.message',
                  content: { body: 'decrypted' },
                },
              ],
            },
          },
        },
      },
    }
    const fresh = {
      next_batch: 'fresh',
      rooms: {
        join: {
          '!room:example.org': {
            state: { events: [{ type: 'm.room.name' }] },
            timeline: {
              events: [
                {
                  event_id: '$same',
                  origin_server_ts: 1,
                  type: 'm.room.encrypted',
                  content: {},
                },
              ],
            },
          },
        },
      },
    }

    const merged = mergeAndroidRoomTimelineCache(fresh, cached)
    const room = (merged.rooms as typeof fresh.rooms).join['!room:example.org']
    expect(room.timeline.events).toEqual(cached.rooms.join['!room:example.org'].timeline.events)
    expect(room.state.events).toEqual([{ type: 'm.room.name' }])
    expect(merged.next_batch).toBe('fresh')
  })
})
