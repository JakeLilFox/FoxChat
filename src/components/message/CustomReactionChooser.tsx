import { MatrixEmoteImage } from './MatrixEmoteImage'
import {
  type MatrixEmote,
  type MatrixEmotePack,
  type NamedEmotePack,
  accountImagePackTypes,
  imagePackRoomsTypes,
} from '../../lib/emojiData'
import { EmojiGrid, PackCollection } from '../../styles'
import { useEffect, useState } from 'react'
import { Empty } from 'antd'
import { Room } from 'matrix-js-sdk'
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
        return (await matrixService.roomImagePacks(roomId, client)).map(
          ({ pack, stateKey }, index) => ({
            id: `favorite-${roomId}-${stateKey || index}`,
            label: `Favorite · ${pack.pack?.display_name || known?.name || roomId}`,
            pack,
            client,
          }),
        )
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
