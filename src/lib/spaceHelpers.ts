import { EventType, Room, RoomType } from 'matrix-js-sdk'
import { matrixService } from '../matrix/MatrixClientService'

export const LAST_SPACE_ROOMS_KEY = 'foxchat.spaceLastRooms'
export const lastSpaceRooms = (): Record<string, string> => {
  try {
    return JSON.parse(localStorage.getItem(LAST_SPACE_ROOMS_KEY) ?? '{}') as Record<string, string>
  } catch {
    return {}
  }
}
export const rememberSpaceRoom = (roomId: string) => {
  const spaces = containingSpacePath(roomId)
  if (!spaces.length) return
  const saved = lastSpaceRooms()
  for (const spaceId of spaces) saved[spaceId] = roomId
  localStorage.setItem(LAST_SPACE_ROOMS_KEY, JSON.stringify(saved))
}
export const containingSpacePath = (targetId: string, client = matrixService.matrixClient) => {
  const resolvedClient = client?.getRoom(targetId) ? client : matrixService.clientForRoom(targetId)
  if (!resolvedClient) return []
  const spaces = resolvedClient.getRooms().filter((room) => room.getType() === RoomType.Space)
  const parents = new Map<string, Room[]>()
  for (const space of spaces)
    for (const event of space.currentState.getStateEvents(EventType.SpaceChild)) {
      if (!Array.isArray(event.getContent().via)) continue
      const id = event.getStateKey()
      if (id) parents.set(id, [...(parents.get(id) ?? []), space])
    }
  const visit = (id: string, seen = new Set<string>()): string[] => {
    if (seen.has(id)) return []
    seen.add(id)
    for (const parent of parents.get(id) ?? []) {
      const prefix = visit(parent.roomId, seen)
      return [...prefix, parent.roomId]
    }
    return []
  }
  return visit(targetId)
}

export const spaceChildOrder = (space: Room, childId: string) => {
  const order = space.currentState.getStateEvents(EventType.SpaceChild, childId)?.getContent().order
  return typeof order === 'string' && order ? order : undefined
}
export const compareSpaceChildren = (
  space: Room,
  a: { roomId: string; name?: string },
  b: { roomId: string; name?: string },
) => {
  const left = spaceChildOrder(space, a.roomId)
  const right = spaceChildOrder(space, b.roomId)
  if (left !== right) {
    if (left === undefined) return 1
    if (right === undefined) return -1
    return left < right ? -1 : 1
  }
  return (a.name ?? '').localeCompare(b.name ?? '') || a.roomId.localeCompare(b.roomId)
}
