import { MatrixEmoteImage } from '../message'
import {
  type MatrixEmote,
  type MatrixEmotePack,
  type NamedEmotePack,
  type StoredEmote,
  accountImagePackTypes,
  deduplicateFavoritePacks,
  imagePackAccounts,
  imagePackRoomsTypes,
  recentStorage,
  rememberRecent,
  roomImagePackTypes,
  unicodeCategories,
  useAllAccountImagePacks,
  useRecents,
} from '../../lib/emojiData'
import { containingSpacePath } from '../../lib/spaceHelpers'
import { closeEmojiUrl, emojiOpenFromUrl, openEmojiUrl } from '../../lib/urlState'
import { EmojiGrid, EmojiPanel, IconBtn, PackCollection } from '../../styles'
import { useEffect, useRef, useState } from 'react'
import { Empty, Popover, Tabs, Tooltip } from 'antd'
import { SmileOutlined } from '@ant-design/icons'
import { EventType, Room, RoomType } from 'matrix-js-sdk'
import { type ImageInfo } from 'matrix-js-sdk/lib/@types/media'
import { matrixService } from '../../matrix/MatrixClientService'

export function EmojiButton({
  room,
  onUnicode,
  onEmote,
  onSticker,
}: {
  room: Room
  onUnicode: (emoji: string) => void
  onEmote: (emote: MatrixEmote) => void
  onSticker: (emote: MatrixEmote) => void
}) {
  const [open, setOpen] = useState(() => emojiOpenFromUrl())
  const triggerRef = useRef<HTMLSpanElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const sync = () => setOpen(emojiOpenFromUrl())
    window.addEventListener('popstate', sync)
    return () => window.removeEventListener('popstate', sync)
  }, [])
  const close = () => {
    closeEmojiUrl()
    setOpen(false)
  }
  // Android WebView needs explicit outside tap handling.
  useEffect(() => {
    if (!open) return
    const outside = (event: PointerEvent) => {
      const target = event.target as Node
      if (triggerRef.current?.contains(target)) return
      if (panelRef.current?.contains(target)) return
      close()
    }
    document.addEventListener('pointerdown', outside, true)
    return () => document.removeEventListener('pointerdown', outside, true)
  }, [open])
  const recentUnicode = useRecents<string>(recentStorage.unicode)
  const recentEmojis = useRecents<StoredEmote>(recentStorage.emojis)
  const recentStickers = useRecents<StoredEmote>(recentStorage.stickers)
  const allAccountPacksEnabled = useAllAccountImagePacks()
  const [remoteFavoritePacks, setRemoteFavoritePacks] = useState<NamedEmotePack[]>([])
  const client = matrixService.clientForRoom(room.roomId)
  const availableAccounts = matrixService.availableAccounts()
  const selectedPackAccounts = imagePackAccounts(
    availableAccounts,
    client,
    matrixService.combinedAccountsEnabled(),
    allAccountPacksEnabled,
  )
  const packAccounts = selectedPackAccounts.length
    ? selectedPackAccounts
    : client
      ? [
          {
            id: 'selected',
            userId: client.getSafeUserId(),
            client,
          },
        ]
      : []
  const mergingAccounts = packAccounts.length > 1
  const accountPacks: NamedEmotePack[] = packAccounts.flatMap((account) =>
    accountImagePackTypes.flatMap((type) => {
      const pack = account.client.getAccountData(type as never)?.getContent<MatrixEmotePack>()
      return pack?.images
        ? [
            {
              id: `account-${account.id}-${type}`,
              label: [
                pack.pack?.display_name || 'Homeserver default',
                ...(mergingAccounts ? [account.userId] : []),
              ].join(' · '),
              pack,
              client: account.client,
            },
          ]
        : []
    }),
  )
  const contextualRooms = client
    ? [
        ...containingSpacePath(room.roomId, client)
          .map((id) => client.getRoom(id))
          .filter((value): value is Room => !!value),
        client.getRoom(room.roomId) ?? room,
      ]
    : [room]
  const contextualPacks: NamedEmotePack[] = client
    ? contextualRooms.flatMap((contextRoom) =>
        roomImagePackTypes.flatMap((eventType) =>
          contextRoom.currentState.getStateEvents(eventType).map((event, index) => {
            const pack = event.getContent<MatrixEmotePack>()
            return {
              id: `context-${contextRoom.roomId}-${eventType}-${event.getStateKey() || index}`,
              label:
                pack.pack?.display_name ||
                `${contextRoom.name} ${contextRoom.getType() === RoomType.Space ? 'Space' : 'channel'}`,
              pack,
              client,
            }
          }),
        ),
      )
    : []
  const favoriteRoomKey = JSON.stringify(
    packAccounts.map((account) => ({
      id: account.id,
      rooms: Object.assign(
        {},
        ...imagePackRoomsTypes.map(
          (type) =>
            account.client.getAccountData(type as never)?.getContent<{
              rooms?: Record<string, Record<string, unknown>>
            }>().rooms ?? {},
        ),
      ),
    })),
  )
  useEffect(() => {
    let cancelled = false
    const configs = JSON.parse(favoriteRoomKey) as Array<{
      id: string
      rooms: Record<string, Record<string, unknown>>
    }>
    const accounts = matrixService.availableAccounts()
    const favoriteSources = configs.flatMap((config) => {
      const account =
        accounts.find((candidate) => candidate.id === config.id) ??
        (config.id === 'selected' && client
          ? {
              id: config.id,
              userId: client.getSafeUserId(),
              client,
            }
          : undefined)
      return account ? [{ ...account, rooms: config.rooms }] : []
    })
    if (!favoriteSources.length) {
      setRemoteFavoritePacks([])
      return
    }
    void Promise.allSettled(
      favoriteSources.flatMap((source) =>
        Object.keys(source.rooms).map(async (roomId) => {
          const favoriteConfig = source.rooms
          const known = source.client.getRoom(roomId)
          const configuredKeys = Object.keys(favoriteConfig[roomId] ?? {})
          const accepts = (key: string | undefined) =>
            !configuredKeys.length || configuredKeys.includes(key ?? '')
          const localEvents = roomImagePackTypes
            .flatMap((type) => known?.currentState.getStateEvents(type) ?? [])
            .filter((event) => accepts(event.getStateKey()))
          if (localEvents.length)
            return localEvents.map((event, index) => {
              const pack = event.getContent<MatrixEmotePack>()
              const stateKey = event.getStateKey() ?? ''
              return {
                id: `favorite-${roomId}-${stateKey || index}`,
                favoriteKey: `${roomId}\u0000${stateKey}`,
                label: `Favorite · ${pack.pack?.display_name || known?.name || roomId}`,
                pack,
                client: source.client,
              }
            })
          const state = await source.client.roomState(roomId)
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
            .map((event, index) => {
              const pack = event.content as MatrixEmotePack
              const stateKey = event.state_key ?? ''
              return {
                id: `favorite-${roomId}-${stateKey || index}`,
                favoriteKey: `${roomId}\u0000${stateKey}`,
                label: `Favorite · ${pack.pack?.display_name || roomName}`,
                pack,
                client: source.client,
              }
            })
        }),
      ),
    ).then((results) => {
      if (cancelled) return
      const packs = results.flatMap((result) => (result.status === 'fulfilled' ? result.value : []))
      setRemoteFavoritePacks(deduplicateFavoritePacks(packs, client))
    })
    return () => {
      cancelled = true
    }
  }, [client, favoriteRoomKey, mergingAccounts])
  const namedPacks = [...accountPacks, ...remoteFavoritePacks, ...contextualPacks]
  const groups = namedPacks
    .map((source) => {
      const items = [
        ...new Map(
          Object.entries(source.pack.images ?? {})
            .filter(
              (
                entry,
              ): entry is [
                string,
                {
                  body?: string
                  url: string
                  info?: ImageInfo
                  usage?: string[]
                },
              ] => !!entry[1].url,
            )
            .map(([name, item]) => {
              const emote: MatrixEmote = {
                name,
                body: item.body || name,
                url: item.url,
                info: item.info,
                usage: item.usage,
                client: source.client,
              }
              return [`${name}:${item.url}`, emote]
            }),
        ).values(),
      ]
      return { ...source, items }
    })
    .filter((group) => group.items.length)
  const allCustom = groups.flatMap((group) => group.items)
  const packGrid = (usage: 'emoticon' | 'sticker', empty: string) => {
    const visible = groups
      .map((group) => ({
        ...group,
        items: group.items.filter((emote) => !emote.usage || emote.usage.includes(usage)),
      }))
      .filter((group) => group.items.length)
    return visible.length ? (
      <PackCollection>
        {visible.map((group) => (
          <div className="pack" key={group.id}>
            <div className="packTitle">
              {group.label} · {group.items.length}
            </div>
            <EmojiGrid $stickers={usage === 'sticker'}>
              {group.items.map((emote) => (
                <button
                  key={`${emote.name}:${emote.url}`}
                  type="button"
                  title={`${emote.body} · ${group.label}`}
                  onClick={() => {
                    rememberRecent(
                      usage === 'emoticon' ? recentStorage.emojis : recentStorage.stickers,
                      {
                        name: emote.name,
                        body: emote.body,
                        url: emote.url,
                        info: emote.info,
                        usage: emote.usage,
                      },
                      (item) => item.url,
                    )
                    ;(usage === 'emoticon' ? onEmote : onSticker)(emote)
                    close()
                  }}
                >
                  <MatrixEmoteImage emote={emote} />
                </button>
              ))}
            </EmojiGrid>
          </div>
        ))}
      </PackCollection>
    ) : (
      <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={empty} />
    )
  }
  const emojiCount = allCustom.filter(
    (emote) => !emote.usage || emote.usage.includes('emoticon'),
  ).length
  const stickerCount = allCustom.filter(
    (emote) => !emote.usage || emote.usage.includes('sticker'),
  ).length
  const unicodeTabs = (
    <Tabs
      size="small"
      items={[
        ...(recentUnicode.length
          ? [
              {
                key: 'recent',
                label: 'Recent',
                children: (
                  <EmojiGrid>
                    {recentUnicode.map((emoji) => (
                      <button
                        key={emoji}
                        type="button"
                        title={emoji}
                        onClick={() => {
                          rememberRecent(recentStorage.unicode, emoji, (item) => item)
                          onUnicode(emoji)
                          close()
                        }}
                      >
                        {emoji}
                      </button>
                    ))}
                  </EmojiGrid>
                ),
              },
            ]
          : []),
        ...unicodeCategories.map((category) => ({
          key: category.key,
          label: <Tooltip title={category.title}>{category.label}</Tooltip>,
          children: (
            <EmojiGrid>
              {category.items.map((emoji, index) => (
                <button
                  key={`${emoji}-${index}`}
                  type="button"
                  title={emoji}
                  onClick={() => {
                    rememberRecent(recentStorage.unicode, emoji, (item) => item)
                    onUnicode(emoji)
                    close()
                  }}
                >
                  {emoji}
                </button>
              ))}
            </EmojiGrid>
          ),
        })),
      ]}
    />
  )
  const recentGrid = (
    items: StoredEmote[],
    select: (emote: MatrixEmote) => void,
    stickers = false,
  ) => (
    <EmojiGrid $stickers={stickers}>
      {items.map((item) => {
        const emote = { ...item, client }
        return (
          <button
            key={item.url}
            type="button"
            title={item.body}
            onClick={() => {
              rememberRecent(
                select === onEmote ? recentStorage.emojis : recentStorage.stickers,
                item,
                (value) => value.url,
              )
              select(emote)
              close()
            }}
          >
            <MatrixEmoteImage emote={emote} />
          </button>
        )
      })}
    </EmojiGrid>
  )
  const matrixTabs = (
    <Tabs
      size="small"
      items={[
        {
          key: 'emoticon',
          label: `Emoji (${emojiCount})`,
          children: (
            <>
              {recentEmojis.length > 0 && (
                <>
                  <div className="packTitle">Recently used</div>
                  {recentGrid(recentEmojis, onEmote)}
                </>
              )}
              {packGrid('emoticon', 'No Matrix emoji packs')}
            </>
          ),
        },
        {
          key: 'sticker',
          label: `Stickers (${stickerCount})`,
          children: (
            <>
              {recentStickers.length > 0 && (
                <>
                  <div className="packTitle">Recently used</div>
                  {recentGrid(recentStickers, onSticker, true)}
                </>
              )}
              {packGrid('sticker', 'No Matrix sticker packs')}
            </>
          ),
        },
      ]}
    />
  )
  const content = (
    <EmojiPanel ref={panelRef}>
      <Tabs
        size="small"
        items={[
          { key: 'unicode', label: 'Unicode', children: unicodeTabs },
          {
            key: 'matrix',
            label: `Matrix (${allCustom.length})`,
            children: matrixTabs,
          },
        ]}
      />
    </EmojiPanel>
  )
  return (
    <Popover
      rootClassName="foxchat-emoji-popover"
      open={open}
      onOpenChange={(next) => {
        if (next) {
          openEmojiUrl()
          setOpen(true)
        } else {
          close()
        }
      }}
      trigger="click"
      placement={window.innerWidth <= 760 ? 'top' : 'topRight'}
      align={window.innerWidth <= 760 ? { offset: [0, -18] } : undefined}
      content={content}
    >
      <span ref={triggerRef}>
        <IconBtn shape="circle" title="Emoji and stickers" icon={<SmileOutlined />} />
      </span>
    </Popover>
  )
}
