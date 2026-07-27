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
