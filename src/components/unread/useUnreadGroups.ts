import { containingSpacePath } from '../../lib/spaceHelpers'
import { matrixService } from '../../matrix/MatrixClientService'
import { useEffect, useState } from 'react'
import { type MatrixEvent, type Room, RoomType } from 'matrix-js-sdk'

export type UnreadRoom = { room: Room; events: MatrixEvent[] }
export type UnreadGroup = { id: string; name: string; rooms: UnreadRoom[] }

const isUnreadRoom = (room: Room) =>
  room.getType() !== RoomType.Space &&
  room.getMyMembership() === 'join' &&
  (matrixService.effectiveUnreadCount(room.roomId) > 0 || room.hasThreadUnreadNotification())

const groupUnreadRooms = (loaded: UnreadRoom[]) => {
  const groups = new Map<string, UnreadGroup>()
  for (const item of loaded) {
    if (!item.events.length) continue
    const client = matrixService.clientForRoom(item.room.roomId)
    const path = containingSpacePath(item.room.roomId, client)
    const space = path.length ? client?.getRoom(path[0]) : undefined
    const id = space?.roomId ?? 'unspaced'
    const group = groups.get(id) ?? {
      id,
      name: space?.name ?? 'Direct messages and other rooms',
      rooms: [],
    }
    group.rooms.push(item)
    groups.set(id, group)
  }
  return [...groups.values()]
    .map((group) => ({
      ...group,
      rooms: group.rooms.sort((a, b) => a.room.name.localeCompare(b.room.name)),
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

export function useUnreadGroups(rooms: Room[], revision: number) {
  const [groups, setGroups] = useState<UnreadGroup[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    setLoading(true)
    void Promise.all(
      rooms.filter(isUnreadRoom).map(async (room) => ({
        room,
        events: await matrixService.unreadMessages(room).catch(() => []),
      })),
    ).then((loaded) => {
      if (!active) return
      setGroups(groupUnreadRooms(loaded))
      setLoading(false)
    })
    return () => {
      active = false
    }
  }, [rooms, revision])

  return { groups, loading }
}
