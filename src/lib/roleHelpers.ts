import { containingSpacePath } from './spaceHelpers'
import { EventType, Room } from 'matrix-js-sdk'
import { matrixService } from '../matrix/MatrixClientService'

export type RoomRank = { name: string; color?: string; icon?: string; level: number }
export const normalizedPowerLevel = (value: unknown) =>
  value === null
    ? Number.MAX_SAFE_INTEGER
    : typeof value === 'number' && Number.isFinite(value)
      ? value
      : 0
export const isInfiniteRoomCreator = (room: Room, userId: string) => {
  const create = room.currentState.getStateEvents(EventType.RoomCreate, '')
  const version = String(create?.getContent().room_version ?? room.getVersion())
  if (!/^\d+$/.test(version) || Number(version) < 12) return false
  const additional = create?.getContent().additional_creators
  return (
    create?.getSender() === userId || (Array.isArray(additional) && additional.includes(userId))
  )
}
export const effectivePowerLevel = (room: Room, userId: string) =>
  isInfiniteRoomCreator(room, userId)
    ? Number.MAX_SAFE_INTEGER
    : normalizedPowerLevel(room.getMember(userId)?.powerLevel)

export const roomRank = (room: Room, userId: string): RoomRank => {
  const client = matrixService.matrixClient
  const spaces = containingSpacePath(room.roomId, client)
    .map((id) => client?.getRoom(id))
    .filter((item): item is Room => !!item)
  const definitionRooms = [...spaces, room]
  const tags: Record<string, { name?: unknown; color?: unknown; icon?: { key?: unknown } }> = {}
  for (const source of definitionRooms) {
    const content = source.currentState
      .getStateEvents('in.cinny.room.power_level_tags', '')
      ?.getContent() as typeof tags | undefined
    for (const [level, definition] of Object.entries(content ?? {}))
      if (!tags[level]) tags[level] = definition
  }
  const level = Math.max(
    effectivePowerLevel(room, userId),
    ...spaces.map((space) => effectivePowerLevel(space, userId)),
  )
  const tag = tags[String(level)]
  const customName = typeof tag?.name === 'string' && tag.name.trim() ? tag.name.trim() : undefined
  const color =
    typeof tag?.color === 'string' && /^#[0-9a-f]{3,8}$/i.test(tag.color) ? tag.color : undefined
  const icon =
    typeof tag?.icon?.key === 'string' && tag.icon.key.startsWith('mxc://')
      ? tag.icon.key
      : undefined
  return {
    level,
    name: customName ?? (level >= 100 ? 'Admin' : level >= 50 ? 'Moderator' : 'Member'),
    color,
    icon,
  }
}

export type EditableRole = {
  id: string
  level: number
  name: string
  color: string
  icon?: string
}

export type { RolePermissionField } from './powerLevelPaths'
export {
  readPermissionLevel,
  applyPermissionLevels,
  expandPermissionLevels,
} from './powerLevelPaths'

export type RoleAssignRequest = {
  userId: string
  name?: string
  avatarUrl?: string
  room: Room
  x: number
  y: number
}
export const assignableRoles = (room: Room) => {
  const tags = room.currentState
    .getStateEvents('in.cinny.room.power_level_tags', '')
    ?.getContent() as Record<string, { name?: string; color?: string }> | undefined
  const levels = new Set([
    0,
    ...Object.keys(tags ?? {})
      .map(Number)
      .filter(Number.isFinite),
  ])
  return [...levels]
    .sort((a, b) => b - a)
    .map((level) => ({
      level,
      name: tags?.[level]?.name || (level >= 100 ? 'Admin' : level >= 50 ? 'Moderator' : 'Member'),
      color: tags?.[level]?.color,
    }))
}
