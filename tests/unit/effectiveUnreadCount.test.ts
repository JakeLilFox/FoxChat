// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest'
import { MatrixClientService } from '../../src/matrix/MatrixClientService'
import { fakeClient, fakeEvent, fakeRoom, type FakeClient } from './support/fakeMatrix'

type FakeAccount = { id: string; userId: string; client: FakeClient }

const serviceWithAccounts = (accounts: FakeAccount[]) => {
  const instance = new MatrixClientService()
  const internals = instance as unknown as {
    roomAccounts: (roomId: string) => FakeAccount[]
    availableAccounts: () => FakeAccount[]
    backupAccounts: () => void
  }
  internals.roomAccounts = () => accounts
  internals.availableAccounts = () => accounts
  internals.backupAccounts = () => undefined
  return instance
}

const ROOM_ID = '!room:example.org'

describe('effectiveUnreadCount', () => {
  it("excludes the reading account's own messages from its unread count", () => {
    localStorage.clear()
    const room = fakeRoom({
      roomId: ROOM_ID,
      events: [
        fakeEvent({ id: '$1', sender: '@other:example.org' }),
        fakeEvent({ id: '$2', sender: '@me:example.org' }),
      ],
      unreadTotal: 2,
    })
    const client = fakeClient([room], '@me:example.org')
    const service = serviceWithAccounts([{ id: 'me', userId: '@me:example.org', client }])

    expect(service.effectiveUnreadCount(ROOM_ID)).toBe(1)
  })

  it('always follows the selected sending-as account, even when read-all is on', async () => {
    localStorage.clear()

    const roomA = fakeRoom({
      roomId: ROOM_ID,
      events: [fakeEvent({ id: '$1', sender: '@b:example.org' })],
    })

    const roomB = fakeRoom({
      roomId: ROOM_ID,
      events: [fakeEvent({ id: '$2', sender: '@carol:example.org' })],
    })
    const clientA = fakeClient([roomA], '@a:example.org')
    const clientB = fakeClient([roomB], '@b:example.org')
    const service = serviceWithAccounts([
      { id: 'a', userId: '@a:example.org', client: clientA },
      { id: 'b', userId: '@b:example.org', client: clientB },
    ])

    localStorage.setItem('foxchat.matrix.roomAccounts', JSON.stringify({ [ROOM_ID]: 'a' }))
    expect(service.effectiveUnreadCount(ROOM_ID)).toBe(0)
    expect(await service.unreadMessages(roomB)).toHaveLength(0)

    localStorage.setItem('foxchat.matrix.roomAccounts', JSON.stringify({ [ROOM_ID]: 'b' }))
    expect(service.effectiveUnreadCount(ROOM_ID)).toBe(1)
    expect(await service.unreadMessages(roomA)).toHaveLength(1)
  })

  it('continues following the selected sending-as account when auto-read-all is off', () => {
    localStorage.clear()
    localStorage.setItem('foxchat.matrix.autoReadAllAccounts', 'false')
    const roomA = fakeRoom({
      roomId: ROOM_ID,
      events: [fakeEvent({ id: '$1', sender: '@b:example.org' })],
    })
    const roomB = fakeRoom({
      roomId: ROOM_ID,
      events: [fakeEvent({ id: '$2', sender: '@carol:example.org' })],
    })
    const clientA = fakeClient([roomA], '@a:example.org')
    const clientB = fakeClient([roomB], '@b:example.org')
    const service = serviceWithAccounts([
      { id: 'a', userId: '@a:example.org', client: clientA },
      { id: 'b', userId: '@b:example.org', client: clientB },
    ])

    localStorage.setItem('foxchat.matrix.roomAccounts', JSON.stringify({ [ROOM_ID]: 'a' }))
    expect(service.effectiveUnreadCount(ROOM_ID)).toBe(0)

    localStorage.setItem('foxchat.matrix.roomAccounts', JSON.stringify({ [ROOM_ID]: 'b' }))
    expect(service.effectiveUnreadCount(ROOM_ID)).toBe(1)
  })

  it('uses the selected account private read position instead of an older public receipt', () => {
    localStorage.clear()
    localStorage.setItem('foxchat.matrix.autoReadAllAccounts', 'false')
    const events = [
      fakeEvent({ id: '$1', sender: '@carol:example.org' }),
      fakeEvent({ id: '$2', sender: '@carol:example.org' }),
      fakeEvent({ id: '$3', sender: '@carol:example.org' }),
    ]
    const room = fakeRoom({
      roomId: ROOM_ID,
      events,
      unreadTotal: 2,
      readReceipts: { '@me:example.org': '$1' },
      readUpTo: { '@me:example.org': '$3' },
    })
    const client = fakeClient([room], '@me:example.org')
    const service = serviceWithAccounts([{ id: 'me', userId: '@me:example.org', client }])
    localStorage.setItem('foxchat.matrix.roomAccounts', JSON.stringify({ [ROOM_ID]: 'me' }))

    expect(service.effectiveUnreadCount(ROOM_ID)).toBe(0)
  })

  it('honors the selected account fully-read marker when it is newer than its receipt', () => {
    localStorage.clear()
    localStorage.setItem('foxchat.matrix.autoReadAllAccounts', 'false')
    const events = [
      fakeEvent({ id: '$1', sender: '@carol:example.org' }),
      fakeEvent({ id: '$2', sender: '@carol:example.org' }),
    ]
    const room = fakeRoom({
      roomId: ROOM_ID,
      events,
      unreadTotal: 1,
      readReceipts: { '@me:example.org': '$1' },
      fullyRead: '$2',
    })
    const client = fakeClient([room], '@me:example.org')
    const service = serviceWithAccounts([{ id: 'me', userId: '@me:example.org', client }])

    expect(service.effectiveUnreadCount(ROOM_ID)).toBe(0)
  })

  it.each([
    [
      'public receipt',
      {
        readReceipts: { '@me:example.org': '$outside' },
        readReceiptTimestamps: { '@me:example.org': 100 },
      },
    ],
    [
      'private receipt',
      {
        privateReadReceipts: { '@me:example.org': '$outside' },
        privateReadReceiptTimestamps: { '@me:example.org': 100 },
      },
    ],
    ['fully-read marker', { fullyRead: '$outside' }],
  ])(
    'does not resurrect loaded history after refresh when an out-of-window %s says the room is read',
    (_label, receiptState) => {
      localStorage.clear()
      const room = fakeRoom({
        roomId: ROOM_ID,
        events: [
          fakeEvent({ id: '$recent-1', sender: '@other:example.org', ts: 10 }),
          fakeEvent({ id: '$recent-2', sender: '@other:example.org', ts: 20 }),
        ],
        unreadTotal: 0,
        ...receiptState,
      })
      const client = fakeClient([room], '@me:example.org')
      const service = serviceWithAccounts([{ id: 'me', userId: '@me:example.org', client }])

      expect(service.effectiveUnreadCount(ROOM_ID)).toBe(0)
    },
  )

  it('uses the server count when an out-of-window receipt has genuine unread messages after it', async () => {
    localStorage.clear()
    const events = [
      fakeEvent({ id: '$recent-1', sender: '@other:example.org', ts: 10 }),
      fakeEvent({ id: '$recent-2', sender: '@me:example.org', ts: 20 }),
      fakeEvent({ id: '$recent-3', sender: '@other:example.org', ts: 30 }),
      fakeEvent({ id: '$recent-4', sender: '@other:example.org', ts: 40 }),
    ]
    const room = fakeRoom({
      roomId: ROOM_ID,
      events,
      unreadTotal: 2,
      readReceipts: { '@me:example.org': '$outside' },
      readReceiptTimestamps: { '@me:example.org': 5 },
    })
    const client = fakeClient([room], '@me:example.org')
    const service = serviceWithAccounts([{ id: 'me', userId: '@me:example.org', client }])

    expect(service.effectiveUnreadCount(ROOM_ID)).toBe(2)
    expect(await service.unreadMessages(room)).toEqual([events[2], events[3]])
  })

  it('does not trust a stale positive server counter over a newer out-of-window receipt', () => {
    localStorage.clear()
    const room = fakeRoom({
      roomId: ROOM_ID,
      events: [
        fakeEvent({ id: '$recent-1', sender: '@other:example.org', ts: 10 }),
        fakeEvent({ id: '$recent-2', sender: '@other:example.org', ts: 20 }),
      ],
      unreadTotal: 2,
      readReceipts: { '@me:example.org': '$outside-latest' },
      readReceiptTimestamps: { '@me:example.org': 100 },
    })
    const client = fakeClient([room], '@me:example.org')
    const service = serviceWithAccounts([{ id: 'me', userId: '@me:example.org', client }])

    expect(service.effectiveUnreadCount(ROOM_ID)).toBe(0)
  })

  it('does not count an out-of-order decrypted event older than the receipt as unread', () => {
    localStorage.clear()
    const room = fakeRoom({
      roomId: ROOM_ID,
      events: [
        fakeEvent({ id: '$receipt', sender: '@me:example.org', ts: 20 }),
        fakeEvent({ id: '$late', sender: '@other:example.org', ts: 15 }),
      ],
      unreadTotal: 0,
      readReceipts: { '@me:example.org': '$receipt' },
      readReceiptTimestamps: { '@me:example.org': 30 },
    })
    const client = fakeClient([room], '@me:example.org')
    const service = serviceWithAccounts([{ id: 'me', userId: '@me:example.org', client }])

    expect(service.effectiveUnreadCount(ROOM_ID)).toBe(0)
  })

  it('still counts an event newer than the receipt as unread', () => {
    localStorage.clear()
    const room = fakeRoom({
      roomId: ROOM_ID,
      events: [
        fakeEvent({ id: '$receipt', sender: '@me:example.org', ts: 20 }),
        fakeEvent({ id: '$new', sender: '@other:example.org', ts: 40 }),
      ],
      unreadTotal: 1,
      readReceipts: { '@me:example.org': '$receipt' },
      readReceiptTimestamps: { '@me:example.org': 30 },
    })
    const client = fakeClient([room], '@me:example.org')
    const service = serviceWithAccounts([{ id: 'me', userId: '@me:example.org', client }])

    expect(service.effectiveUnreadCount(ROOM_ID)).toBe(1)
  })

  it('still derives genuine unread messages after an in-window receipt when counters lag at zero', () => {
    localStorage.clear()
    const room = fakeRoom({
      roomId: ROOM_ID,
      events: [
        fakeEvent({ id: '$read', sender: '@other:example.org' }),
        fakeEvent({ id: '$unread', sender: '@other:example.org' }),
      ],
      unreadTotal: 0,
      readReceipts: { '@me:example.org': '$read' },
    })
    const client = fakeClient([room], '@me:example.org')
    const service = serviceWithAccounts([{ id: 'me', userId: '@me:example.org', client }])

    expect(service.effectiveUnreadCount(ROOM_ID)).toBe(1)
  })

  it('uses the selected combined account out-of-window receipt after refresh', () => {
    localStorage.clear()
    localStorage.setItem('foxchat.matrix.autoReadAllAccounts', 'false')
    const events = [
      fakeEvent({ id: '$recent-1', sender: '@other:example.org', ts: 10 }),
      fakeEvent({ id: '$recent-2', sender: '@other:example.org', ts: 20 }),
    ]
    const roomA = fakeRoom({
      roomId: ROOM_ID,
      events,
      unreadTotal: 0,
      readReceipts: { '@a:example.org': '$outside-a' },
      readReceiptTimestamps: { '@a:example.org': 100 },
    })
    const roomB = fakeRoom({
      roomId: ROOM_ID,
      events,
      unreadTotal: 2,
      readReceipts: { '@b:example.org': '$outside-b' },
      readReceiptTimestamps: { '@b:example.org': 5 },
    })
    const clientA = fakeClient([roomA], '@a:example.org')
    const clientB = fakeClient([roomB], '@b:example.org')
    const service = serviceWithAccounts([
      { id: 'a', userId: '@a:example.org', client: clientA },
      { id: 'b', userId: '@b:example.org', client: clientB },
    ])

    localStorage.setItem('foxchat.matrix.roomAccounts', JSON.stringify({ [ROOM_ID]: 'a' }))
    expect(service.effectiveUnreadCount(ROOM_ID)).toBe(0)

    localStorage.setItem('foxchat.matrix.roomAccounts', JSON.stringify({ [ROOM_ID]: 'b' }))
    expect(service.effectiveUnreadCount(ROOM_ID)).toBe(2)
  })

  it('treats a room-event-only unread (e.g. a voice-chat join) as unread when it notifies (bug 1)', () => {
    localStorage.clear()
    const room = fakeRoom({
      roomId: ROOM_ID,
      events: [
        fakeEvent({
          id: '$call1',
          type: 'm.call.member',
          sender: '@other:example.org',
          notify: true,
        }),
      ],
      unreadTotal: 1,
    })
    const client = fakeClient([room], '@me:example.org')
    const service = serviceWithAccounts([{ id: 'me', userId: '@me:example.org', client }])

    expect(service.effectiveUnreadCount(ROOM_ID)).toBe(1)
  })

  it('reads timeline appearance settings once for a large unread scan', () => {
    localStorage.clear()
    const room = fakeRoom({
      roomId: ROOM_ID,
      events: Array.from({ length: 200 }, (_, index) =>
        fakeEvent({
          id: `$bulk-${index}`,
          sender: '@other:example.org',
        }),
      ),
      unreadTotal: 200,
    })
    const client = fakeClient([room], '@me:example.org')
    const service = serviceWithAccounts([{ id: 'me', userId: '@me:example.org', client }])
    const getItem = vi.spyOn(Storage.prototype, 'getItem')

    expect(service.effectiveUnreadCount(ROOM_ID)).toBe(200)
    expect(getItem.mock.calls.length).toBeLessThan(20)

    getItem.mockRestore()
  })
})
