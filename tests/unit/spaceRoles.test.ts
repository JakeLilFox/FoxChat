// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { EventType, RoomType } from 'matrix-js-sdk'
import { MatrixClientService } from '../../src/matrix/MatrixClientService'
import { fakeClient, fakeRoom, type FakeClient } from './support/fakeMatrix'

const serviceWithClient = (client: FakeClient) => {
  const instance = new MatrixClientService()
  const internals = instance as unknown as {
    client: unknown
    roomAccounts: (roomId: string) => unknown[]
    availableAccounts: () => unknown[]
  }
  internals.client = client
  internals.roomAccounts = () => []
  internals.availableAccounts = () => []
  return instance
}

const powerLevelWrites = (client: FakeClient, roomId: string) =>
  client.sendStateEvent.mock.calls.filter(
    (call) => call[0] === roomId && call[1] === EventType.RoomPowerLevels,
  )
const tagWrites = (client: FakeClient, roomId: string) =>
  client.sendStateEvent.mock.calls.filter(
    (call) => call[0] === roomId && call[1] === 'in.cinny.room.power_level_tags',
  )

describe('saveRoomRoles / saveSpaceRoles', () => {
  it('saveRoomRoles writes role tags and merges assignments into the users map', async () => {
    const room = fakeRoom({
      roomId: '!room:example.org',
      state: {
        'm.room.power_levels': { users_default: 0, users: { '@old:example.org': 50 } },
      },
    })
    const client = fakeClient([room])
    const service = serviceWithClient(client)

    await service.saveRoomRoles(
      '!room:example.org',
      { 50: { name: 'Mod' } },
      { '@new:example.org': 50 },
      { invite: 50 },
    )

    expect(tagWrites(client, '!room:example.org')).toHaveLength(1)
    expect(tagWrites(client, '!room:example.org')[0][2]).toEqual({
      50: { name: 'Mod' },
    })
    const [, , content] = powerLevelWrites(client, '!room:example.org')[0]
    expect(content).toMatchObject({
      invite: 50,
      users: { '@old:example.org': 50, '@new:example.org': 50 },
    })
  })

  it("saveRoomRoles removes a user from the users map when assigned back to the room's default level", async () => {
    const room = fakeRoom({
      roomId: '!room:example.org',
      state: {
        'm.room.power_levels': { users_default: 0, users: { '@user:example.org': 50 } },
      },
    })
    const client = fakeClient([room])
    const service = serviceWithClient(client)

    await service.saveRoomRoles('!room:example.org', {}, { '@user:example.org': 0 }, {})

    const [, , content] = powerLevelWrites(client, '!room:example.org')[0]
    expect((content as { users: Record<string, number> }).users).not.toHaveProperty(
      '@user:example.org',
    )
  })

  it('saveRoomRoles never writes an explicit level for an infinite room creator', async () => {
    const room = fakeRoom({
      roomId: '!room:example.org',
      createSender: '@creator:example.org',
      state: {
        'm.room.create': { room_version: '12' },
        'm.room.power_levels': { users_default: 0 },
      },
    })
    const client = fakeClient([room])
    const service = serviceWithClient(client)

    await service.saveRoomRoles('!room:example.org', {}, { '@creator:example.org': 100 }, {})

    const [, , content] = powerLevelWrites(client, '!room:example.org')[0]
    expect((content as { users: Record<string, number> }).users).not.toHaveProperty(
      '@creator:example.org',
    )
  })

  it('saveSpaceRoles writes to the space only, not to any child room', async () => {
    const child = fakeRoom({ roomId: '!child:example.org' })
    const space = fakeRoom({
      roomId: '!space:example.org',
      type: RoomType.Space,
      state: {
        'm.space.child:!child:example.org': { via: ['example.org'] },
        'm.room.power_levels': { users_default: 0 },
      },
    })
    const client = fakeClient([space, child])
    const service = serviceWithClient(client)

    await service.saveSpaceRoles(
      '!space:example.org',
      { 50: { name: 'Mod' } },
      { '@user:example.org': 50 },
    )

    expect(powerLevelWrites(client, '!space:example.org')).toHaveLength(1)
    expect(powerLevelWrites(client, '!child:example.org')).toHaveLength(0)
  })
})

describe('syncSpaceRoles', () => {
  const buildSpaceGraph = (
    options: {
      subSpaceBaseline?: Record<string, number>
      memberships?: Record<string, 'join' | 'invite' | 'leave'>
    } = {},
  ) => {
    const roomA = fakeRoom({
      roomId: '!roomA:example.org',
      membership: options.memberships?.['!roomA:example.org'] ?? 'join',
      state: { 'm.room.power_levels': { users_default: 0, events_default: 0 } },
    })
    const roomB = fakeRoom({
      roomId: '!roomB:example.org',
      membership: options.memberships?.['!roomB:example.org'] ?? 'join',
      state: { 'm.room.power_levels': { users_default: 0, events_default: 0 } },
    })
    const orphanedRoom = fakeRoom({ roomId: '!orphan:example.org' })
    const subSpace = fakeRoom({
      roomId: '!sub:example.org',
      type: RoomType.Space,
      membership: options.memberships?.['!sub:example.org'] ?? 'join',
      state: {
        'm.space.child:!roomB:example.org': { via: ['example.org'] },
        'm.room.power_levels': { users_default: 0, events_default: 0 },
      },
    })
    const space = fakeRoom({
      roomId: '!space:example.org',
      type: RoomType.Space,
      state: {
        'm.space.child:!roomA:example.org': { via: ['example.org'] },
        'm.space.child:!sub:example.org': { via: ['example.org'] },

        'm.space.child:!orphan:example.org': {},
        'm.room.power_levels': { users_default: 0, events_default: 0, invite: 50 },
      },
    })
    const client = fakeClient([space, subSpace, roomA, roomB, orphanedRoom])
    return { space, subSpace, roomA, roomB, orphanedRoom, client }
  }

  it('BFS-walks nested sub-spaces and applies to every joined descendant, ignoring orphaned children', async () => {
    const { client } = buildSpaceGraph()
    const service = serviceWithClient(client)

    const result = await service.syncSpaceRoles(
      '!space:example.org',
      { 50: { name: 'Mod' } },
      { '@user:example.org': 50 },
    )

    expect(result.total).toBe(3)
    expect(result.synced.sort()).toEqual(
      ['!roomA:example.org', '!roomB:example.org', '!sub:example.org'].sort(),
    )
    expect(powerLevelWrites(client, '!roomA:example.org')).toHaveLength(1)
    expect(powerLevelWrites(client, '!roomB:example.org')).toHaveLength(1)
    expect(powerLevelWrites(client, '!sub:example.org')).toHaveLength(1)
    expect(powerLevelWrites(client, '!orphan:example.org')).toHaveLength(0)
  })

  it("skips rooms the account hasn't joined", async () => {
    const { client } = buildSpaceGraph({
      memberships: { '!roomA:example.org': 'invite' },
    })
    const service = serviceWithClient(client)

    const result = await service.syncSpaceRoles(
      '!space:example.org',
      {},
      { '@user:example.org': 50 },
    )

    expect(result.synced).not.toContain('!roomA:example.org')
    expect(powerLevelWrites(client, '!roomA:example.org')).toHaveLength(0)
  })

  it('collects a per-room failure without aborting the rest of the sync', async () => {
    const { client } = buildSpaceGraph()
    client.sendStateEvent.mockImplementation(async (roomId: string, type: string) => {
      if (roomId === '!roomA:example.org' && type === EventType.RoomPowerLevels) {
        throw new Error('boom')
      }
      return { event_id: '$fake' }
    })
    const service = serviceWithClient(client)

    const result = await service.syncSpaceRoles(
      '!space:example.org',
      {},
      { '@user:example.org': 50 },
    )

    expect(result.failed).toHaveLength(1)
    expect(result.failed[0].roomId).toBe('!roomA:example.org')
    expect(result.synced.sort()).toEqual(['!roomB:example.org', '!sub:example.org'].sort())
  })

  it('only pushes permission keys that changed since the last synced baseline, but always pushes the full member assignments', async () => {
    const roomA = fakeRoom({
      roomId: '!roomA:example.org',
      state: {
        'm.room.power_levels': {
          users_default: 0,
          events_default: 0,
          invite: 0,

          kick: 10,
        },
      },
    })
    const space = fakeRoom({
      roomId: '!space:example.org',
      type: RoomType.Space,
      state: {
        'm.space.child:!roomA:example.org': { via: ['example.org'] },
        'm.room.power_levels': {
          users_default: 0,
          events_default: 0,
          invite: 50,
          kick: 50,
        },
        'chat.foxchat.space_role_sync': {
          permissions: {
            events_default: 0,
            invite: 0,
            kick: 50,
            state_default: 50,
            ban: 50,
            redact: 50,
          },
        },
      },
    })
    const client = fakeClient([space, roomA])
    const service = serviceWithClient(client)

    await service.syncSpaceRoles('!space:example.org', {}, { '@user:example.org': 50 })

    const [, , content] = powerLevelWrites(client, '!roomA:example.org')[0]
    const written = content as Record<string, unknown>
    expect(written.invite).toBe(50)
    expect(written.kick).toBe(10)
    expect((written.users as Record<string, number>)['@user:example.org']).toBe(50)
  })

  it('writes the new full baseline to chat.foxchat.space_role_sync after syncing', async () => {
    const { client } = buildSpaceGraph()
    const service = serviceWithClient(client)

    await service.syncSpaceRoles(
      '!space:example.org',
      {},
      { '@user:example.org': 50 },
      { invite: 50, kick: 50, ban: 50, redact: 50, events_default: 0, state_default: 50 },
    )

    const baselineWrites = client.sendStateEvent.mock.calls.filter(
      (call) => call[0] === '!space:example.org' && call[1] === 'chat.foxchat.space_role_sync',
    )
    expect(baselineWrites).toHaveLength(1)
    expect(baselineWrites[0][2]).toEqual({
      permissions: {
        invite: 50,
        kick: 50,
        ban: 50,
        redact: 50,
        events_default: 0,
        state_default: 50,
      },
    })
  })
})

describe('applyCurrentSpaceRolesToRoom', () => {
  it("applies the space's full current permission set (not diffed) to exactly the one target room", async () => {
    const newRoom = fakeRoom({
      roomId: '!new:example.org',
      state: { 'm.room.power_levels': { users_default: 0 } },
    })
    const untouchedSibling = fakeRoom({ roomId: '!sibling:example.org' })
    const space = fakeRoom({
      roomId: '!space:example.org',
      type: RoomType.Space,
      members: { '@user:example.org': 50 },
      state: {
        'in.cinny.room.power_level_tags': { 50: { name: 'Mod' } },
        'm.room.power_levels': { users_default: 0, invite: 50, kick: 50 },

        'chat.foxchat.space_role_sync': {
          permissions: { invite: 50, kick: 50 },
        },
      },
    })
    const client = fakeClient([space, newRoom, untouchedSibling])
    const service = serviceWithClient(client)

    await service.applyCurrentSpaceRolesToRoom('!space:example.org', '!new:example.org')

    expect(tagWrites(client, '!new:example.org')).toHaveLength(1)
    expect(tagWrites(client, '!new:example.org')[0][2]).toEqual({
      50: { name: 'Mod' },
    })
    const [, , content] = powerLevelWrites(client, '!new:example.org')[0]
    const written = content as Record<string, unknown>
    expect(written.invite).toBe(50)
    expect(written.kick).toBe(50)
    expect((written.users as Record<string, number>)['@user:example.org']).toBe(50)
    expect(powerLevelWrites(client, '!sibling:example.org')).toHaveLength(0)
  })

  it("never touches chat.foxchat.space_role_sync, so it can't interfere with the next 'Sync baseline' diff", async () => {
    const newRoom = fakeRoom({ roomId: '!new:example.org' })
    const space = fakeRoom({
      roomId: '!space:example.org',
      type: RoomType.Space,
      state: { 'm.room.power_levels': { users_default: 0 } },
    })
    const client = fakeClient([space, newRoom])
    const service = serviceWithClient(client)

    await service.applyCurrentSpaceRolesToRoom('!space:example.org', '!new:example.org')

    const baselineWrites = client.sendStateEvent.mock.calls.filter(
      (call) => call[1] === 'chat.foxchat.space_role_sync',
    )
    expect(baselineWrites).toHaveLength(0)
  })
})

describe('assignRoomRole', () => {
  it("assigns a user's power level in a single room", async () => {
    const room = fakeRoom({
      roomId: '!room:example.org',
      members: { '@admin:example.org': 100, '@user:example.org': 0 },
      state: { 'm.room.power_levels': { users_default: 0 } },
    })
    const client = fakeClient([room], '@admin:example.org')
    const service = serviceWithClient(client)

    await service.assignRoomRole('!room:example.org', '@user:example.org', 50)

    const [, , content] = powerLevelWrites(client, '!room:example.org')[0]
    expect((content as { users: Record<string, number> }).users['@user:example.org']).toBe(50)
  })

  it("refuses to grant a role above the actor's own effective level", async () => {
    const room = fakeRoom({
      roomId: '!room:example.org',
      members: { '@mod:example.org': 50, '@user:example.org': 0 },
      state: { 'm.room.power_levels': { users_default: 0 } },
    })
    const client = fakeClient([room], '@mod:example.org')
    const service = serviceWithClient(client)

    await expect(
      service.assignRoomRole('!room:example.org', '@user:example.org', 100),
    ).rejects.toThrow(/above your own/)
  })

  it("refuses to act on a user who is already at or above the actor's own level", async () => {
    const room = fakeRoom({
      roomId: '!room:example.org',
      members: { '@mod:example.org': 50, '@peer:example.org': 50 },
      state: { 'm.room.power_levels': { users_default: 0 } },
    })
    const client = fakeClient([room], '@mod:example.org')
    const service = serviceWithClient(client)

    await expect(
      service.assignRoomRole('!room:example.org', '@peer:example.org', 0),
    ).rejects.toThrow(/outrank/)
  })

  it('refuses to assign a role to yourself', async () => {
    const room = fakeRoom({
      roomId: '!room:example.org',
      members: { '@admin:example.org': 100 },
      state: { 'm.room.power_levels': { users_default: 0 } },
    })
    const client = fakeClient([room], '@admin:example.org')
    const service = serviceWithClient(client)

    await expect(
      service.assignRoomRole('!room:example.org', '@admin:example.org', 50),
    ).rejects.toThrow(/yourself/)
  })

  it('with propagateFromSpace, applies the same assignment down the m.space.child tree', async () => {
    const child = fakeRoom({
      roomId: '!child:example.org',
      membership: 'join',
      members: { '@admin:example.org': 100, '@user:example.org': 0 },
      state: { 'm.room.power_levels': { users_default: 0 } },
    })
    const space = fakeRoom({
      roomId: '!space:example.org',
      type: RoomType.Space,
      members: { '@admin:example.org': 100, '@user:example.org': 0 },
      state: {
        'm.space.child:!child:example.org': { via: ['example.org'] },
        'm.room.power_levels': { users_default: 0 },
      },
    })
    const client = fakeClient([space, child], '@admin:example.org')
    const service = serviceWithClient(client)

    const result = await service.assignRoomRole('!space:example.org', '@user:example.org', 50, true)

    expect(result.synced).toEqual(['!child:example.org'])
    const [, , content] = powerLevelWrites(client, '!child:example.org')[0]
    expect((content as { users: Record<string, number> }).users['@user:example.org']).toBe(50)
  })

  it('propagateFromSpace collects a per-child failure instead of throwing, without affecting other children', async () => {
    const forbiddenChild = fakeRoom({
      roomId: '!forbidden:example.org',
      membership: 'join',
      members: { '@admin:example.org': 0, '@user:example.org': 0 },
      state: { 'm.room.power_levels': { users_default: 0 } },

      maySendStateEvent: false,
    })
    const okChild = fakeRoom({
      roomId: '!ok:example.org',
      membership: 'join',
      members: { '@admin:example.org': 100, '@user:example.org': 0 },
      state: { 'm.room.power_levels': { users_default: 0 } },
    })
    const space = fakeRoom({
      roomId: '!space:example.org',
      type: RoomType.Space,
      members: { '@admin:example.org': 100, '@user:example.org': 0 },
      state: {
        'm.space.child:!forbidden:example.org': { via: ['example.org'] },
        'm.space.child:!ok:example.org': { via: ['example.org'] },
        'm.room.power_levels': { users_default: 0 },
      },
    })
    const client = fakeClient([space, forbiddenChild, okChild], '@admin:example.org')
    const service = serviceWithClient(client)

    const result = await service.assignRoomRole('!space:example.org', '@user:example.org', 50, true)

    expect(result.synced).toEqual(['!ok:example.org'])
    expect(result.failed).toEqual(['!forbidden:example.org'])
  })

  it("does not propagate when the target room isn't a Space, even if propagateFromSpace is true", async () => {
    const room = fakeRoom({
      roomId: '!room:example.org',
      members: { '@admin:example.org': 100, '@user:example.org': 0 },
      state: { 'm.room.power_levels': { users_default: 0 } },
    })
    const client = fakeClient([room], '@admin:example.org')
    const service = serviceWithClient(client)

    const result = await service.assignRoomRole('!room:example.org', '@user:example.org', 50, true)

    expect(result).toEqual({ synced: [], failed: [] })
  })
})
