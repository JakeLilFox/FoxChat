// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest'
import { NotificationCountType } from 'matrix-js-sdk'
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

describe('markRead target selection (auto-read-all-accounts preference)', () => {
  it('marks every joined account read when the preference is on (default)', async () => {
    localStorage.clear()
    const message = fakeEvent({ id: '$1', roomId: ROOM_ID, sender: '@carol:example.org' })
    const roomA = fakeRoom({ roomId: ROOM_ID, events: [message] })
    const roomB = fakeRoom({ roomId: ROOM_ID, events: [message] })
    const clientA = fakeClient([roomA], '@a:example.org')
    const clientB = fakeClient([roomB], '@b:example.org')
    const service = serviceWithAccounts([
      { id: 'a', userId: '@a:example.org', client: clientA },
      { id: 'b', userId: '@b:example.org', client: clientB },
    ])
    localStorage.setItem('foxchat.matrix.roomAccounts', JSON.stringify({ [ROOM_ID]: 'a' }))

    await service.markRead(message)

    expect(clientA.setRoomReadMarkers).toHaveBeenCalledWith(ROOM_ID, '$1', message)
    expect(clientB.setRoomReadMarkers).toHaveBeenCalledWith(ROOM_ID, '$1', message)
  })

  it('marks only the selected sending-as account read when the preference is off', async () => {
    localStorage.clear()
    localStorage.setItem('foxchat.matrix.autoReadAllAccounts', 'false')
    const message = fakeEvent({ id: '$1', roomId: ROOM_ID, sender: '@carol:example.org' })
    const roomA = fakeRoom({ roomId: ROOM_ID, events: [message] })
    const roomB = fakeRoom({ roomId: ROOM_ID, events: [message] })
    const clientA = fakeClient([roomA], '@a:example.org')
    const clientB = fakeClient([roomB], '@b:example.org')
    const service = serviceWithAccounts([
      { id: 'a', userId: '@a:example.org', client: clientA },
      { id: 'b', userId: '@b:example.org', client: clientB },
    ])
    localStorage.setItem('foxchat.matrix.roomAccounts', JSON.stringify({ [ROOM_ID]: 'a' }))

    await service.markRead(message)

    expect(clientA.setRoomReadMarkers).toHaveBeenCalledWith(ROOM_ID, '$1', message)
    expect(clientB.setRoomReadMarkers).not.toHaveBeenCalled()
  })

  it('keeps a delayed read callback bound to the account that observed the timeline', async () => {
    localStorage.clear()
    localStorage.setItem('foxchat.matrix.autoReadAllAccounts', 'false')
    const message = fakeEvent({ id: '$1', roomId: ROOM_ID, sender: '@carol:example.org' })
    const roomA = fakeRoom({ roomId: ROOM_ID, events: [message] })
    const roomB = fakeRoom({ roomId: ROOM_ID, events: [message] })
    const clientA = fakeClient([roomA], '@a:example.org')
    const clientB = fakeClient([roomB], '@b:example.org')
    const service = serviceWithAccounts([
      { id: 'a', userId: '@a:example.org', client: clientA },
      { id: 'b', userId: '@b:example.org', client: clientB },
    ])
    localStorage.setItem('foxchat.matrix.roomAccounts', JSON.stringify({ [ROOM_ID]: 'b' }))

    await service.markRead(message, 'a')

    expect(clientA.setRoomReadMarkers).toHaveBeenCalledWith(ROOM_ID, '$1', message)
    expect(clientB.setRoomReadMarkers).not.toHaveBeenCalled()
  })

  it('keeps every account read while server receipts catch up to the merged timeline', async () => {
    localStorage.clear()
    const first = fakeEvent({
      id: '$1',
      roomId: ROOM_ID,
      sender: '@carol:example.org',
      ts: 10,
    })
    const second = fakeEvent({
      id: '$2',
      roomId: ROOM_ID,
      sender: '@carol:example.org',
      ts: 20,
    })
    const latest = fakeEvent({
      id: '$3',
      roomId: ROOM_ID,
      sender: '@carol:example.org',
      ts: 30,
    })
    const roomA = fakeRoom({
      roomId: ROOM_ID,
      events: [first, second, latest],
      unreadTotal: 2,
      readReceipts: { '@a:example.org': '$1' },
    })

    const roomB = fakeRoom({
      roomId: ROOM_ID,
      events: [first, second],
      unreadTotal: 1,
      readReceipts: { '@b:example.org': '$1' },
    })
    const clientA = fakeClient([roomA], '@a:example.org')
    const clientB = fakeClient([roomB], '@b:example.org')
    const service = serviceWithAccounts([
      { id: 'a', userId: '@a:example.org', client: clientA },
      { id: 'b', userId: '@b:example.org', client: clientB },
    ])

    await service.markRead(latest)

    expect(clientA.setRoomReadMarkers).toHaveBeenCalledWith(ROOM_ID, '$3', latest)
    expect(clientB.setRoomReadMarkers).toHaveBeenCalledWith(ROOM_ID, '$3', latest)
    expect(service.effectiveUnreadCount(ROOM_ID)).toBe(0)
  })

  it('applies the optimistic read position before the durable marker request completes', async () => {
    localStorage.clear()
    const first = fakeEvent({
      id: '$1',
      roomId: ROOM_ID,
      sender: '@carol:example.org',
      ts: 10,
    })
    const latest = fakeEvent({
      id: '$2',
      roomId: ROOM_ID,
      sender: '@carol:example.org',
      ts: 20,
    })
    const room = fakeRoom({
      roomId: ROOM_ID,
      events: [first, latest],
      unreadTotal: 1,
      readReceipts: { '@me:example.org': '$1' },
    })
    const client = fakeClient([room], '@me:example.org')
    let finishRequest: () => void = () => undefined
    client.setRoomReadMarkers.mockImplementation(
      () =>
        new Promise<undefined>((resolve) => {
          finishRequest = () => resolve(undefined)
        }),
    )
    const service = serviceWithAccounts([{ id: 'me', userId: '@me:example.org', client }])

    const marking = service.markRead(latest)

    expect(service.effectiveUnreadCount(ROOM_ID)).toBe(0)
    finishRequest()
    await marking
  })

  it('rolls back an optimistic read position when the durable marker request fails', async () => {
    localStorage.clear()
    const first = fakeEvent({
      id: '$1',
      roomId: ROOM_ID,
      sender: '@carol:example.org',
      ts: 10,
    })
    const latest = fakeEvent({
      id: '$2',
      roomId: ROOM_ID,
      sender: '@carol:example.org',
      ts: 20,
    })
    const room = fakeRoom({
      roomId: ROOM_ID,
      events: [first, latest],
      unreadTotal: 1,
      readReceipts: { '@me:example.org': '$1' },
    })
    const client = fakeClient([room], '@me:example.org')
    client.setRoomReadMarkers.mockRejectedValue(new Error('offline'))
    const service = serviceWithAccounts([{ id: 'me', userId: '@me:example.org', client }])
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    await service.markRead(latest)

    expect(service.effectiveUnreadCount(ROOM_ID)).toBe(1)
    warning.mockRestore()
  })
})

describe('markRead notifiable-event detection (bug 1)', () => {
  it('zeroes unread counters when the latest notifying event is a room event, not a message', async () => {
    localStorage.clear()

    const joinEvent = fakeEvent({
      id: '$call1',
      roomId: ROOM_ID,
      type: 'm.call.member',
      sender: '@other:example.org',
      notify: true,
    })
    const room = fakeRoom({ roomId: ROOM_ID, events: [joinEvent], unreadTotal: 1 })
    const client = fakeClient([room], '@me:example.org')
    const service = serviceWithAccounts([{ id: 'me', userId: '@me:example.org', client }])
    localStorage.setItem('foxchat.matrix.roomAccounts', JSON.stringify({ [ROOM_ID]: 'me' }))

    await service.markRead(joinEvent)

    expect(room.setUnreadNotificationCount).toHaveBeenCalledWith(NotificationCountType.Total, 0)
    expect(room.setUnreadNotificationCount).toHaveBeenCalledWith(NotificationCountType.Highlight, 0)
  })
})

describe('markRoomOrSpaceRead target selection', () => {
  it('respects the auto-read-all-accounts preference the same way markRead does', async () => {
    localStorage.clear()
    localStorage.setItem('foxchat.matrix.autoReadAllAccounts', 'false')
    const roomA = fakeRoom({
      roomId: ROOM_ID,
      events: [fakeEvent({ id: '$1', roomId: ROOM_ID, sender: '@carol:example.org' })],
      unreadTotal: 1,
    })
    const roomB = fakeRoom({
      roomId: ROOM_ID,
      events: [fakeEvent({ id: '$2', roomId: ROOM_ID, sender: '@carol:example.org' })],
      unreadTotal: 1,
    })
    const clientA = fakeClient([roomA], '@a:example.org')
    const clientB = fakeClient([roomB], '@b:example.org')
    const service = serviceWithAccounts([
      { id: 'a', userId: '@a:example.org', client: clientA },
      { id: 'b', userId: '@b:example.org', client: clientB },
    ])
    localStorage.setItem('foxchat.matrix.roomAccounts', JSON.stringify({ [ROOM_ID]: 'a' }))

    await service.markRoomOrSpaceRead(ROOM_ID)

    expect(clientA.setRoomReadMarkers).toHaveBeenCalled()
    expect(clientB.setRoomReadMarkers).not.toHaveBeenCalled()
    expect(roomB.setUnreadNotificationCount).not.toHaveBeenCalled()
  })
})
