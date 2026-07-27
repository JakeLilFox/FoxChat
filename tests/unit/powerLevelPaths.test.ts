import { describe, expect, it } from 'vitest'
import {
  applyPermissionLevels,
  expandPermissionLevels,
  readPermissionLevel,
  type RolePermissionField,
} from '../../src/lib/powerLevelPaths'

describe('Matrix power-level paths', () => {
  it('reads flat and supported nested permissions', () => {
    const power = {
      invite: 25,
      events: { 'm.room.name': 50 },
      notifications: { room: 75 },
    }

    expect(readPermissionLevel(power, 'invite')).toBe(25)
    expect(readPermissionLevel(power, 'events.m.room.name')).toBe(50)
    expect(readPermissionLevel(power, 'notifications.room')).toBe(75)
    expect(readPermissionLevel(power, 'events.m.room.topic')).toBeUndefined()
    expect(readPermissionLevel({ invite: '25' }, 'invite')).toBeUndefined()
  })

  it('updates nested values without mutating input or dropping siblings', () => {
    const current = {
      invite: 0,
      events: { 'm.room.name': 50, 'm.room.topic': 25 },
      notifications: { room: 75, custom: 10 },
    }

    const result = applyPermissionLevels(current, {
      invite: 10,
      'events.m.room.name': 100,
      'notifications.room': 50,
    })

    expect(result).toEqual({
      invite: 10,
      events: { 'm.room.name': 100, 'm.room.topic': 25 },
      notifications: { room: 50, custom: 10 },
    })
    expect(current).toEqual({
      invite: 0,
      events: { 'm.room.name': 50, 'm.room.topic': 25 },
      notifications: { room: 75, custom: 10 },
    })
    expect(result.events).not.toBe(current.events)
    expect(result.notifications).not.toBe(current.notifications)
  })

  it('copies a represented permission to all of its aliases', () => {
    const fields: RolePermissionField[] = [
      {
        key: 'events.m.room.name',
        aliasKeys: ['events.m.room.topic', 'events.m.room.avatar'],
        label: 'Room details',
        description: 'Change room details',
        fallback: () => 50,
      },
      {
        key: 'invite',
        label: 'Invite',
        description: 'Invite members',
        fallback: () => 0,
      },
    ]

    expect(
      expandPermissionLevels(fields, {
        'events.m.room.name': 75,
        invite: 25,
      }),
    ).toEqual({
      'events.m.room.name': 75,
      'events.m.room.topic': 75,
      'events.m.room.avatar': 75,
      invite: 25,
    })
  })
})
