// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest'
import { MatrixClientService } from '../../src/matrix/MatrixClientService'

describe('room creation', () => {
  it('uses the successful room ID without joining again while sync catches up', async () => {
    const createRoom = vi.fn().mockResolvedValue({
      room_id: '!created:example.org',
    })
    const joinRoom = vi.fn()
    const client = {
      createRoom,
      getRoom: vi.fn().mockReturnValue(undefined),
      joinRoom,
    }
    const service = new MatrixClientService()
    ;(service as unknown as { accountClient: () => typeof client }).accountClient = () => client

    await expect(
      service.createRoomAs('account', '  Encrypted room  ', undefined, false, true),
    ).resolves.toEqual({
      roomId: '!created:example.org',
      name: 'Encrypted room',
    })
    expect(createRoom).toHaveBeenCalledWith(expect.objectContaining({ name: 'Encrypted room' }))
    expect(joinRoom).not.toHaveBeenCalled()
  })

  it('can retain the selected account while a successful join awaits local sync', () => {
    localStorage.clear()
    const service = new MatrixClientService()
    const client = {}
    const internals = service as unknown as {
      availableAccounts: () => Array<{
        id: string
        userId: string
        client: typeof client
      }>
      roomAccounts: () => []
      backupAccounts: () => void
      room: () => undefined
    }
    internals.availableAccounts = () => [{ id: 'account', userId: '@joined:example.org', client }]
    internals.roomAccounts = () => []
    internals.backupAccounts = vi.fn()
    internals.room = () => undefined

    expect(() => service.selectRoomAccount('!room:example.org', 'account')).toThrow(
      'Account is not joined to this room',
    )
    expect(() => service.selectRoomAccount('!room:example.org', 'account', true)).not.toThrow()
    expect(JSON.parse(localStorage.getItem('foxchat.matrix.roomAccounts') ?? '{}')).toEqual({
      '!room:example.org': 'account',
    })
  })
})
