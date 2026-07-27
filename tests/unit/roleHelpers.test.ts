// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { RoomType } from 'matrix-js-sdk'
import {
  assignableRoles,
  effectivePowerLevel,
  isInfiniteRoomCreator,
  roomRank,
} from '../../src/lib/roleHelpers'
import { matrixService } from '../../src/matrix/MatrixClientService'
import { fakeClient, fakeRoom } from './support/fakeMatrix'

describe('isInfiniteRoomCreator', () => {
  it('treats the m.room.create sender as an infinite creator on a v12+ room', () => {
    const room = fakeRoom({
      roomId: '!room:example.org',
      version: '12',
      createSender: '@creator:example.org',
      state: { 'm.room.create': { room_version: '12' } },
    })
    expect(isInfiniteRoomCreator(room, '@creator:example.org')).toBe(true)
  })

  it('treats an additional_creators entry as an infinite creator on a v12+ room', () => {
    const room = fakeRoom({
      roomId: '!room:example.org',
      createSender: '@creator:example.org',
      state: {
        'm.room.create': {
          room_version: '12',
          additional_creators: ['@cocreator:example.org'],
        },
      },
    })
    expect(isInfiniteRoomCreator(room, '@cocreator:example.org')).toBe(true)
  })

  it('does not grant infinite-creator status below room version 12', () => {
    const room = fakeRoom({
      roomId: '!room:example.org',
      createSender: '@creator:example.org',
      state: { 'm.room.create': { room_version: '11' } },
    })
    expect(isInfiniteRoomCreator(room, '@creator:example.org')).toBe(false)
  })

  it('is false for an unrelated user', () => {
    const room = fakeRoom({
      roomId: '!room:example.org',
      createSender: '@creator:example.org',
      state: { 'm.room.create': { room_version: '12' } },
    })
    expect(isInfiniteRoomCreator(room, '@someone-else:example.org')).toBe(false)
  })
})

describe('effectivePowerLevel', () => {
  it("returns the member's own power level", () => {
    const room = fakeRoom({
      roomId: '!room:example.org',
      members: { '@user:example.org': 42 },
    })
    expect(effectivePowerLevel(room, '@user:example.org')).toBe(42)
  })

  it("returns 0 for a user who isn't a member", () => {
    const room = fakeRoom({ roomId: '!room:example.org' })
    expect(effectivePowerLevel(room, '@nobody:example.org')).toBe(0)
  })

  it('is MAX_SAFE_INTEGER for an infinite room creator regardless of their listed power level', () => {
    const room = fakeRoom({
      roomId: '!room:example.org',
      createSender: '@creator:example.org',
      members: { '@creator:example.org': 0 },
      state: { 'm.room.create': { room_version: '12' } },
    })
    expect(effectivePowerLevel(room, '@creator:example.org')).toBe(Number.MAX_SAFE_INTEGER)
  })
})

describe('roomRank', () => {
  afterEach(() => {
    ;(matrixService as unknown as { client?: unknown }).client = undefined
  })

  it('falls back to the default Admin/Moderator/Member names when no tags are defined', () => {
    const room = fakeRoom({
      roomId: '!room:example.org',
      members: { '@user:example.org': 50 },
    })
    ;(matrixService as unknown as { client?: unknown }).client = fakeClient([room])

    expect(roomRank(room, '@user:example.org')).toEqual({
      level: 50,
      name: 'Moderator',
      color: undefined,
      icon: undefined,
    })
  })

  it("uses the room's own custom role tag when one is defined for the member's level", () => {
    const room = fakeRoom({
      roomId: '!room:example.org',
      members: { '@user:example.org': 50 },
      state: {
        'in.cinny.room.power_level_tags': {
          50: { name: 'Custom Mod', color: '#ff0000' },
        },
      },
    })
    ;(matrixService as unknown as { client?: unknown }).client = fakeClient([room])

    expect(roomRank(room, '@user:example.org')).toEqual({
      level: 50,
      name: 'Custom Mod',
      color: '#ff0000',
      icon: undefined,
    })
  })

  it("takes the max of the room-level and containing-space-level power, inheriting the space's tag for that level", () => {
    const room = fakeRoom({
      roomId: '!room:example.org',
      members: { '@user:example.org': 0 },
    })
    const space = fakeRoom({
      roomId: '!space:example.org',
      type: RoomType.Space,
      members: { '@user:example.org': 100 },
      state: {
        'm.space.child:!room:example.org': { via: ['example.org'] },
        'in.cinny.room.power_level_tags': {
          100: { name: 'Space Admin' },
        },
      },
    })
    ;(matrixService as unknown as { client?: unknown }).client = fakeClient([room, space])

    expect(roomRank(room, '@user:example.org')).toEqual({
      level: 100,
      name: 'Space Admin',
      color: undefined,
      icon: undefined,
    })
  })
})

describe('assignableRoles', () => {
  it('always includes level 0, sorted from highest to lowest, using tag names/colors where defined', () => {
    const room = fakeRoom({
      roomId: '!room:example.org',
      state: {
        'in.cinny.room.power_level_tags': {
          100: { name: 'Admin' },
          50: { name: 'Mod', color: '#123456' },
        },
      },
    })

    expect(assignableRoles(room)).toEqual([
      { level: 100, name: 'Admin', color: undefined },
      { level: 50, name: 'Mod', color: '#123456' },
      { level: 0, name: 'Member', color: undefined },
    ])
  })
})
