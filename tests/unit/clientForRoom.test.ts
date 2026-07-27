// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'
import { MatrixClientService } from '../../src/matrix/MatrixClientService'

type FakeClient = { getRoom: (roomId: string) => { maySendMessage: () => boolean } | undefined }
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

describe('clientForRoom', () => {
  it('uses the currently selected account when it can act in the room', () => {
    localStorage.clear()
    localStorage.setItem('foxchat.matrix.roomAccounts', JSON.stringify({ [ROOM_ID]: 'selected' }))
    const selectedClient: FakeClient = { getRoom: () => ({ maySendMessage: () => true }) }
    const otherClient: FakeClient = { getRoom: () => ({ maySendMessage: () => true }) }
    const service = serviceWithAccounts([
      { id: 'selected', userId: '@selected:example.org', client: selectedClient },
      { id: 'other', userId: '@other:example.org', client: otherClient },
    ])

    expect(service.clientForRoom(ROOM_ID)).toBe(selectedClient)
  })

  it('falls back to whichever joined account can currently act there when the selected one cannot', () => {
    localStorage.clear()
    localStorage.setItem('foxchat.matrix.roomAccounts', JSON.stringify({ [ROOM_ID]: 'selected' }))
    const selectedClient: FakeClient = { getRoom: () => ({ maySendMessage: () => false }) }
    const otherClient: FakeClient = { getRoom: () => ({ maySendMessage: () => true }) }
    const service = serviceWithAccounts([
      { id: 'selected', userId: '@selected:example.org', client: selectedClient },
      { id: 'other', userId: '@other:example.org', client: otherClient },
    ])

    expect(service.clientForRoom(ROOM_ID)).toBe(otherClient)
  })

  it('falls back to whichever account is actually joined when the selected account is not in the room at all', () => {
    localStorage.clear()
    localStorage.setItem('foxchat.matrix.roomAccounts', JSON.stringify({ [ROOM_ID]: 'not-joined' }))
    const otherClient: FakeClient = { getRoom: () => ({ maySendMessage: () => true }) }
    const service = serviceWithAccounts([
      { id: 'other', userId: '@other:example.org', client: otherClient },
    ])

    expect(service.clientForRoom(ROOM_ID)).toBe(otherClient)
  })
})
