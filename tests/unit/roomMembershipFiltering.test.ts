// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { ClientEvent, RoomEvent, type MatrixClient, type Room } from 'matrix-js-sdk'
import { MatrixClientService } from '../../src/matrix/MatrixClientService'

const fakeRoom = (roomId: string, membership: 'join' | 'leave' | 'invite') =>
  ({
    roomId,
    name: roomId,
    myUserId: '@user:example.org',
    getMyMembership: () => membership,
    getType: () => undefined,
    getMembers: () => [],
    getLiveTimeline: () => ({ getEvents: () => [] }),
    currentState: { getStateEvents: () => undefined },
    relations: { aggregateChildEvent: () => undefined },
  }) as unknown as Room

const serviceWithRooms = (rooms: Room[]) => {
  const service = new MatrixClientService()
  const client = {
    getRooms: () => rooms,
    getRoom: (roomId: string) => rooms.find((room) => room.roomId === roomId),
  } as unknown as MatrixClient
  ;(
    service as unknown as {
      availableAccounts: () => Array<{ id: string; userId: string; client: MatrixClient }>
    }
  ).availableAccounts = () => [{ id: 'account', userId: '@user:example.org', client }]
  return service
}

describe('joined room filtering', () => {
  afterEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
  })

  it('keeps joined channels while excluding left rooms and invitations from the drawer list', () => {
    const joined = fakeRoom('!joined:example.org', 'join')
    const left = fakeRoom('!left:example.org', 'leave')
    const invited = fakeRoom('!invited:example.org', 'invite')
    const service = serviceWithRooms([joined, left, invited])

    expect(service.rooms().map((room) => room.roomId)).toEqual([joined.roomId])
    expect(service.joinedRoom(joined.roomId)).toBe(joined)
    expect(service.joinedRoom(left.roomId)).toBeUndefined()
    expect(service.joinedRoom(invited.roomId)).toBeUndefined()
  })

  it('does not send a delayed typing update after leaving', async () => {
    const left = fakeRoom('!left:example.org', 'leave')
    const sendTyping = vi.fn()
    const client = {
      getRoom: () => left,
      sendTyping,
    } as unknown as MatrixClient
    const service = new MatrixClientService()
    ;(
      service as unknown as {
        clientForRoom: () => MatrixClient
      }
    ).clientForRoom = () => client

    await service.setTyping(left.roomId, false)

    expect(sendTyping).not.toHaveBeenCalled()
  })

  it('waits for an accepted invitation to reach joined sync state before navigation', async () => {
    let membership: 'invite' | 'join' = 'invite'
    const room = {
      ...fakeRoom('!invited:example.org', 'invite'),
      getMyMembership: () => membership,
    } as Room
    const listeners = new Map<string, Set<(changedRoom: Room) => void>>()
    const client = {
      getRoom: () => room,
      on: (event: string, listener: (changedRoom: Room) => void) => {
        const registered = listeners.get(event) ?? new Set()
        registered.add(listener)
        listeners.set(event, registered)
      },
      off: (event: string, listener: (changedRoom: Room) => void) => {
        listeners.get(event)?.delete(listener)
      },
    } as unknown as MatrixClient
    const service = new MatrixClientService()
    ;(
      service as unknown as {
        availableAccounts: () => Array<{ id: string; userId: string; client: MatrixClient }>
      }
    ).availableAccounts = () => [{ id: 'account', userId: '@user:example.org', client }]

    const synchronized = service.waitForJoinedRoomAs(room.roomId, 'account', 1000)
    membership = 'join'
    for (const listener of listeners.get(RoomEvent.MyMembership) ?? []) listener(room)

    await expect(synchronized).resolves.toBe(room)
    expect(listeners.get(ClientEvent.Room)).toHaveLength(0)
    expect(listeners.get(RoomEvent.MyMembership)).toHaveLength(0)
  })
})
