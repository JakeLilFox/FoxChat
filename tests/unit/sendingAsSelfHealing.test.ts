// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'
import { MatrixClientService } from '../../src/matrix/MatrixClientService'
import { fakeClient, fakeRoom, setFakeMembership, type FakeClient } from './support/fakeMatrix'

const ROOM_ID = '!room:example.org'

const serviceWithAccounts = (
  accounts: Array<{ id: string; userId: string; client: FakeClient }>,
) => {
  const instance = new MatrixClientService()
  const internals = instance as unknown as {
    roomAccounts: (roomId: string) => Array<{ id: string; userId: string; client: FakeClient }>
    availableAccounts: () => Array<{ id: string; userId: string; client: FakeClient }>
    backupAccounts: () => void
  }
  internals.roomAccounts = (roomId: string) =>
    accounts.filter((account) => account.client.getRoom(roomId)?.getMyMembership() === 'join')
  internals.availableAccounts = () => accounts
  internals.backupAccounts = () => undefined
  return instance
}

describe('sending-as account self-healing when kicked', () => {
  it('falls back to the remaining joined account once the selected one is kicked', () => {
    localStorage.clear()
    const roomA = fakeRoom({ roomId: ROOM_ID })
    const roomB = fakeRoom({ roomId: ROOM_ID })
    const clientA = fakeClient([roomA], '@a:example.org')
    const clientB = fakeClient([roomB], '@b:example.org')
    const service = serviceWithAccounts([
      { id: 'a', userId: '@a:example.org', client: clientA },
      { id: 'b', userId: '@b:example.org', client: clientB },
    ])
    localStorage.setItem('foxchat.matrix.roomAccounts', JSON.stringify({ [ROOM_ID]: 'a' }))

    expect(service.clientForRoom(ROOM_ID)).toBe(clientA)

    setFakeMembership(roomA, 'leave')

    expect(service.clientForRoom(ROOM_ID)).toBe(clientB)
    expect(service.selectedRoomAccountId(ROOM_ID)).toBe('b')
    expect(JSON.parse(localStorage.getItem('foxchat.matrix.roomAccounts')!)[ROOM_ID]).toBe('b')
  })
})
