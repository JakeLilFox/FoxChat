// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { RoomType } from 'matrix-js-sdk'
import { containingSpacePath } from '../../src/lib/spaceHelpers'
import { fakeClient, fakeRoom } from './support/fakeMatrix'

describe('containingSpacePath', () => {
  it("resolves a room's single containing space", () => {
    const room = fakeRoom({ roomId: '!room:example.org' })
    const space = fakeRoom({
      roomId: '!space:example.org',
      type: RoomType.Space,
      state: {
        'm.space.child:!room:example.org': { via: ['example.org'] },
      },
    })
    const client = fakeClient([room, space])

    expect(containingSpacePath('!room:example.org', client as never)).toEqual([
      '!space:example.org',
    ])
  })

  it('walks nested sub-spaces from the top down', () => {
    const room = fakeRoom({ roomId: '!room:example.org' })
    const subSpace = fakeRoom({
      roomId: '!sub:example.org',
      type: RoomType.Space,
      state: {
        'm.space.child:!room:example.org': { via: ['example.org'] },
      },
    })
    const topSpace = fakeRoom({
      roomId: '!top:example.org',
      type: RoomType.Space,
      state: {
        'm.space.child:!sub:example.org': { via: ['example.org'] },
      },
    })
    const client = fakeClient([room, subSpace, topSpace])

    expect(containingSpacePath('!room:example.org', client as never)).toEqual([
      '!top:example.org',
      '!sub:example.org',
    ])
  })

  it('ignores m.space.child events without a valid via array (orphaned per the Matrix spec)', () => {
    const room = fakeRoom({ roomId: '!room:example.org' })
    const space = fakeRoom({
      roomId: '!space:example.org',
      type: RoomType.Space,
      state: {
        'm.space.child:!room:example.org': {},
      },
    })
    const client = fakeClient([room, space])

    expect(containingSpacePath('!room:example.org', client as never)).toEqual([])
  })

  it('returns an empty path for a room with no containing space', () => {
    const room = fakeRoom({ roomId: '!room:example.org' })
    const client = fakeClient([room])

    expect(containingSpacePath('!room:example.org', client as never)).toEqual([])
  })
})
