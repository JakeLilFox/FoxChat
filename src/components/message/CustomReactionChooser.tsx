import { MatrixEmoteImage } from './MatrixEmoteImage'
import {
  type MatrixEmote,
  type MatrixEmotePack,
  type NamedEmotePack,
  accountImagePackTypes,
  imagePackRoomsTypes,
  roomImagePackTypes,
} from '../../lib/emojiData'
import { containingSpacePath } from '../../lib/spaceHelpers'
import { EmojiGrid, PackCollection } from '../../styles'
import { useEffect, useState } from 'react'
import { Empty } from 'antd'
import { EventType, Room } from 'matrix-js-sdk'
import { matrixService } from '../../matrix/MatrixClientService'

export function CustomReactionChooser({
  room,
  onSelect,
}: {
  room: Room
  onSelect: (emote: MatrixEmote) => void
}) {
  const client = matrixService.clientForRoomInstance(room)
  const [remotePacks, setRemotePacks] = useState<NamedEmotePack[]>([])
  const favoriteRooms = client
    ? Object.assign(
        {},
        ...imagePackRoomsTypes.map(
          (type) =>
            client.getAccountData(type as never)?.getContent<{
              rooms?: Record<string, Record<string, unknown>>
            }>().rooms ?? {},
        ),
      )
    : {}
  const favoriteKey = JSON.stringify(favoriteRooms)
  useEffect(() => {
    let cancelled = false
    if (!client) {
      setRemotePacks([])
      return
    }
    const config = JSON.parse(favoriteKey) as Record<string, Record<string, unknown>>
    void Promise.allSettled(
      Object.keys(config).map(async (roomId) => {
        const known = client.getRoom(roomId)
        const configuredKeys = Object.keys(config[roomId] ?? {})
        const accepts = (key: string | undefined) =>
          !configuredKeys.length || configuredKeys.includes(key ?? '')
        const local = roomImagePackTypes
          .flatMap((type) => known?.currentState.getStateEvents(type) ?? [])
          .filter((event) => accepts(event.getStateKey()))
        if (local.length)
          return local.map((event, index) => ({
            id: `favorite-${roomId}-${event.getStateKey() || index}`,
            label: `Favorite · ${event.getContent<MatrixEmotePack>().pack?.display_name || known?.name || roomId}`,
            pack: event.getContent<MatrixEmotePack>(),
            client,
          }))
        const state = await client.roomState(roomId)
        const roomName = String(
          state.find((event) => event.type === EventType.RoomName)?.content.name ||
            known?.name ||
            roomId,
        )
        return state
          .filter(
            (event) =>
              roomImagePackTypes.includes(event.type as (typeof roomImagePackTypes)[number]) &&
              accepts(event.state_key),
          )
          .map((event, index) => ({
            id: `favorite-${roomId}-${event.state_key || index}`,
            label: `Favorite · ${event.content.pack?.display_name || roomName}`,
            pack: event.content as MatrixEmotePack,
            client,
          }))
      }),
    ).then((results) => {
      if (!cancelled)
        setRemotePacks(
          results.flatMap((result) => (result.status === 'fulfilled' ? result.value : [])),
        )
    })
    return () => {
      cancelled = true
    }
  }, [client, favoriteKey])
  if (!client)
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No custom emoji available" />
  const rooms = [
    ...containingSpacePath(room.roomId, client)
      .map((id) => client.getRoom(id))
      .filter((value): value is Room => !!value),
    client.getRoom(room.roomId) ?? room,
  ]
  const packs: NamedEmotePack[] = [
    ...accountImagePackTypes.flatMap((type) => {
      const pack = client.getAccountData(type as never)?.getContent<MatrixEmotePack>()
      return pack?.images
        ? [
            {
              id: `account-${type}`,
              label: pack.pack?.display_name || 'Homeserver default',
              pack,
              client,
            },
          ]
        : []
    }),
    ...remotePacks,
    ...rooms.flatMap((source) =>
      roomImagePackTypes.flatMap((type) =>
        source.currentState.getStateEvents(type).map((event, index) => {
          const pack = event.getContent<MatrixEmotePack>()
          return {
            id: `${source.roomId}-${type}-${event.getStateKey() || index}`,
            label: pack.pack?.display_name || source.name,
            pack,
            client,
          }
        }),
      ),
    ),
  ]
  const groups = packs
    .map((source) => ({
      ...source,
      items: Object.entries(source.pack.images ?? {}).flatMap(([name, item]) =>
        item.url && (!item.usage || item.usage.includes('emoticon'))
          ? [
              {
                name,
                body: item.body || name,
                url: item.url,
                info: item.info,
                usage: item.usage,
                client,
              },
            ]
          : [],
      ),
    }))
    .filter((group) => group.items.length)
  return groups.length ? (
    <PackCollection>
      {groups.map((group) => (
        <div className="pack" key={group.id}>
          <div className="packTitle">
            {group.label} · {group.items.length}
          </div>
          <EmojiGrid>
            {group.items.map((emote) => (
              <button
                key={`${emote.name}:${emote.url}`}
                type="button"
                title={emote.body}
                onClick={() => onSelect(emote)}
              >
                <MatrixEmoteImage emote={emote} />
              </button>
            ))}
          </EmojiGrid>
        </div>
      ))}
    </PackCollection>
  ) : (
    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No custom emoji available" />
  )
}
