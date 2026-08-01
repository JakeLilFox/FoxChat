import { MatrixEmoteImage } from '../message'
import {
  type MatrixEmote,
  type MatrixEmotePack,
  type NamedEmotePack,
  type RoomImagePackLocation,
  type StoredEmote,
  accountImagePackTypes,
  deduplicateFavoritePacks,
  deduplicateRoomPacks,
  imagePackAccounts,
  imagePackRoomsTypes,
  matchesPickerSearch,
  moveImagePackOrder,
  orderedImageEntries,
  orderImagePacks,
  pinnedStorage,
  recentStorage,
  rememberRecent,
  togglePinned,
  unicodeCategories,
  useAllAccountImagePacks,
  usePinned,
  useRecents,
} from '../../lib/emojiData'
import {
  emojiPickerSourceTab,
  matrixPickerContentTab,
  setEmojiPickerSourceTab,
  setMatrixPickerContentTab,
} from '../../lib/uiPreferences'
import { closeEmojiUrl, emojiOpenFromUrl, openEmojiUrl } from '../../lib/urlState'
import { itemWindowAround } from '../../lib/virtualWindow'
import { EmojiGrid, EmojiPanel, IconBtn, PackCollection, PackJumpBar } from '../../styles'
import { useEffect, useRef, useState } from 'react'
import { App as AntApp, Dropdown, Empty, Input, Popover, Tabs, Tooltip } from 'antd'
import { PushpinOutlined, SearchOutlined, SmileOutlined } from '@ant-design/icons'
import { Room } from 'matrix-js-sdk'
import { type ImageInfo } from 'matrix-js-sdk/lib/@types/media'
import { matrixService } from '../../matrix/MatrixClientService'

type PickerPack = {
  id: string
  orderKey: string
  label: string
  items: MatrixEmote[]
}

const LONG_PRESS_MS = 550
const PICKER_IMAGE_OVERSCAN = 100

function PinnablePickerItem({
  pinned,
  title,
  onSelect,
  onTogglePin,
  itemIndex,
  children,
}: {
  pinned: boolean
  title: string
  onSelect: () => void
  onTogglePin: () => void
  itemIndex?: number
  children: React.ReactNode
}) {
  const timer = useRef(0)
  const start = useRef({ x: 0, y: 0 })
  const suppressClick = useRef(false)
  const pointerType = useRef('')
  const clearTimer = () => window.clearTimeout(timer.current)
  useEffect(() => clearTimer, [])
  return (
    <Dropdown
      trigger={['contextMenu']}
      rootClassName="foxchat-emoji-item-menu"
      getPopupContainer={(trigger) =>
        trigger.closest<HTMLElement>('.foxchat-emoji-panel') ?? document.body
      }
      menu={{
        items: [
          {
            key: 'pin',
            icon: <PushpinOutlined />,
            label: pinned ? 'Unpin' : 'Pin',
            onClick: onTogglePin,
          },
        ],
      }}
    >
      <button
        type="button"
        data-picker-index={itemIndex}
        title={title}
        onPointerDown={(event) => {
          clearTimer()
          suppressClick.current = false
          pointerType.current = event.pointerType
          if (event.pointerType !== 'touch' && event.pointerType !== 'pen') return
          start.current = { x: event.clientX, y: event.clientY }
          const target = event.currentTarget
          const { clientX, clientY } = event
          timer.current = window.setTimeout(() => {
            suppressClick.current = true
            target.dispatchEvent(
              new MouseEvent('contextmenu', {
                bubbles: true,
                cancelable: true,
                button: 2,
                clientX,
                clientY,
              }),
            )
          }, LONG_PRESS_MS)
        }}
        onPointerMove={(event) => {
          if (
            Math.abs(event.clientX - start.current.x) > 8 ||
            Math.abs(event.clientY - start.current.y) > 8
          )
            clearTimer()
        }}
        onPointerUp={clearTimer}
        onPointerCancel={clearTimer}
        onPointerLeave={clearTimer}
        onContextMenu={() => {
          clearTimer()
          if (pointerType.current === 'touch' || pointerType.current === 'pen')
            suppressClick.current = true
        }}
        onClick={(event) => {
          if (suppressClick.current) {
            event.preventDefault()
            suppressClick.current = false
            return
          }
          onSelect()
        }}
      >
        {children}
      </button>
    </Dropdown>
  )
}

function MatrixPackBrowser({
  usage,
  groups,
  pinned,
  recent,
  client,
  empty,
  search,
  onSelect,
  onTogglePin,
  onMovePack,
}: {
  usage: 'emoticon' | 'sticker'
  groups: PickerPack[]
  pinned: StoredEmote[]
  recent: StoredEmote[]
  client: ReturnType<typeof matrixService.clientForRoom>
  empty: string
  search: string
  onSelect: (emote: MatrixEmote) => void
  onTogglePin: (emote: MatrixEmote) => void
  onMovePack: (source: string, target: string, edge: 'before' | 'after') => void
}) {
  const collectionRef = useRef<HTMLDivElement>(null)
  const packRefs = useRef(new Map<string, HTMLDivElement>())
  const [drag, setDrag] = useState<{
    source: string
    target?: string
    edge?: 'before' | 'after'
  }>()
  const searching = !!search.trim()
  const availableItems = groups.flatMap((group) => group.items)
  const restoreStoredItem = (item: StoredEmote): MatrixEmote =>
    availableItems.find((emote) => emote.url === item.url) ?? { ...item, client }
  const packs: Array<PickerPack & { reorderable: boolean }> = [
    ...(pinned.length
      ? [
          {
            id: 'pinned',
            orderKey: 'pinned',
            label: 'Pinned',
            items: pinned.map(restoreStoredItem),
            reorderable: false,
          },
        ]
      : []),
    ...(recent.length
      ? [
          {
            id: 'recent',
            orderKey: 'recent',
            label: 'Recently used',
            items: recent.map(restoreStoredItem),
            reorderable: false,
          },
        ]
      : []),
    ...groups
      .map((group) => ({
        ...group,
        items: group.items.filter((emote) => !emote.usage || emote.usage.includes(usage)),
        reorderable: !searching,
      }))
      .filter((group) => group.items.length),
  ]
    .map((pack) => {
      if (!searching) return pack
      const packMatches = matchesPickerSearch(search, pack.label)
      return {
        ...pack,
        items: packMatches
          ? pack.items
          : pack.items.filter((emote) => matchesPickerSearch(search, emote.name, emote.body)),
      }
    })
    .filter((pack) => pack.items.length)
  let totalItems = 0
  const packsWithOffsets = packs.map((pack) => {
    const offset = totalItems
    totalItems += pack.items.length
    return { pack, offset }
  })
  const layoutKey = packs.map((pack) => `${pack.id}:${pack.items.length}`).join('\u0000')
  const [imageWindow, setImageWindow] = useState(() =>
    itemWindowAround([], totalItems, PICKER_IMAGE_OVERSCAN),
  )
  useEffect(() => {
    const collection = collectionRef.current
    setImageWindow(itemWindowAround([], totalItems, PICKER_IMAGE_OVERSCAN))
    if (!collection) return
    if (typeof IntersectionObserver === 'undefined') {
      setImageWindow({ start: 0, end: totalItems - 1 })
      return
    }
    const visibleIndices = new Set<number>()
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const index = Number((entry.target as HTMLElement).dataset.pickerIndex)
          if (!Number.isInteger(index)) continue
          if (entry.isIntersecting) visibleIndices.add(index)
          else visibleIndices.delete(index)
        }
        if (visibleIndices.size)
          setImageWindow(itemWindowAround(visibleIndices, totalItems, PICKER_IMAGE_OVERSCAN))
      },
      { root: collection },
    )
    collection
      .querySelectorAll<HTMLElement>('[data-picker-index]')
      .forEach((item) => observer.observe(item))
    return () => observer.disconnect()
  }, [layoutKey, totalItems])
  if (!packs.length)
    return (
      <Empty
        image={Empty.PRESENTED_IMAGE_SIMPLE}
        description={
          searching ? `No matching Matrix ${usage === 'sticker' ? 'stickers' : 'emoji'}` : empty
        }
      />
    )

  const jumpToPack = (packId: string) => {
    const collection = collectionRef.current
    const target = packRefs.current.get(packId)
    if (!collection || !target) return
    const behavior = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      ? 'auto'
      : 'smooth'
    if (collection.scrollHeight > collection.clientHeight + 1) {
      collection.scrollTo({
        top:
          collection.scrollTop +
          target.getBoundingClientRect().top -
          collection.getBoundingClientRect().top,
        behavior,
      })
    } else {
      target.scrollIntoView({ behavior, block: 'start' })
    }
  }

  return (
    <div>
      <PackJumpBar
        role="navigation"
        aria-label={usage === 'sticker' ? 'Sticker packs' : 'Emoji packs'}
      >
        {packs.map((pack) => (
          <button
            key={pack.id}
            type="button"
            className={[
              drag?.source === pack.orderKey ? 'dragging' : '',
              drag?.target === pack.orderKey && drag.edge ? `drop-${drag.edge}` : '',
            ]
              .filter(Boolean)
              .join(' ')}
            draggable={pack.reorderable}
            title={pack.label}
            aria-label={`Jump to ${pack.label}`}
            onClick={() => jumpToPack(pack.id)}
            onDragStart={(event) => {
              if (!pack.reorderable) return
              setDrag({ source: pack.orderKey })
              event.dataTransfer.effectAllowed = 'move'
              event.dataTransfer.setData('text/plain', pack.orderKey)
            }}
            onDragEnd={() => setDrag(undefined)}
            onDragOver={(event) => {
              if (!pack.reorderable || !drag?.source || drag.source === pack.orderKey) return
              event.preventDefault()
              event.dataTransfer.dropEffect = 'move'
              const bounds = event.currentTarget.getBoundingClientRect()
              const edge = event.clientX < bounds.left + bounds.width / 2 ? 'before' : 'after'
              setDrag((current) =>
                current?.target === pack.orderKey && current.edge === edge
                  ? current
                  : { source: drag.source, target: pack.orderKey, edge },
              )
            }}
            onDrop={(event) => {
              event.preventDefault()
              if (drag?.source && drag.source !== pack.orderKey) {
                onMovePack(drag.source, pack.orderKey, drag.edge ?? 'before')
              }
              setDrag(undefined)
            }}
          >
            <MatrixEmoteImage emote={pack.items[0]} lazy />
          </button>
        ))}
      </PackJumpBar>
      <PackCollection ref={collectionRef}>
        {packsWithOffsets.map(({ pack, offset }) => (
          <div
            className="pack"
            key={pack.id}
            ref={(node) => {
              if (node) packRefs.current.set(pack.id, node)
              else packRefs.current.delete(pack.id)
            }}
          >
            <div className="packTitle">
              {pack.label} · {pack.items.length}
            </div>
            <EmojiGrid $stickers={usage === 'sticker'}>
              {pack.items.map((emote, itemIndex) => {
                const globalIndex = offset + itemIndex
                return (
                  <PinnablePickerItem
                    key={`${emote.name}:${emote.url}`}
                    title={`${emote.body} · ${pack.label}`}
                    pinned={pinned.some((item) => item.url === emote.url)}
                    onSelect={() => onSelect(emote)}
                    onTogglePin={() => onTogglePin(emote)}
                    itemIndex={globalIndex}
                  >
                    {globalIndex >= imageWindow.start && globalIndex <= imageWindow.end ? (
                      <MatrixEmoteImage emote={emote} lazy />
                    ) : null}
                  </PinnablePickerItem>
                )
              })}
            </EmojiGrid>
          </div>
        ))}
      </PackCollection>
    </div>
  )
}

export function EmojiButton({
  room,
  onUnicode,
  onEmote,
  onSticker,
  onAvailableEmotes,
}: {
  room: Room
  onUnicode: (emoji: string) => void
  onEmote: (emote: MatrixEmote) => void
  onSticker: (emote: MatrixEmote) => void
  onAvailableEmotes?: (emotes: MatrixEmote[]) => void
}) {
  const { message } = AntApp.useApp()
  const [open, setOpen] = useState(() => emojiOpenFromUrl())
  const [search, setSearch] = useState('')
  const [sourceTab, setSourceTab] = useState(emojiPickerSourceTab)
  const [matrixContentTab, setMatrixContentTab] = useState(matrixPickerContentTab)
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
    setSearch('')
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
  const pinnedUnicode = usePinned<string>(pinnedStorage.unicode)
  const pinnedEmojis = usePinned<StoredEmote>(pinnedStorage.emojis)
  const pinnedStickers = usePinned<StoredEmote>(pinnedStorage.stickers)
  const allAccountPacksEnabled = useAllAccountImagePacks()
  const [remoteFavoritePacks, setRemoteFavoritePacks] = useState<NamedEmotePack[]>([])
  const client = matrixService.clientForRoom(room.roomId)
  const [packOrder, setPackOrder] = useState(() => matrixService.imagePackOrder(client))
  const packOrderRef = useRef(packOrder)
  useEffect(() => {
    const next = matrixService.imagePackOrder(client)
    packOrderRef.current = next
    setPackOrder(next)
  }, [client])
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
              orderKey: `account\u0000${account.id}\u0000${type}`,
              label: [
                pack.pack?.display_name || 'Homeserver default',
                ...(mergingAccounts ? [account.userId] : []),
              ].join(' · '),
              pack,
              client: account.client,
              mine: true,
            },
          ]
        : []
    }),
  )
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
    if (!open && !onAvailableEmotes) return
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
          const known = source.client.getRoom(roomId)
          const packs: RoomImagePackLocation[] = await matrixService.roomImagePacks(
            roomId,
            source.client,
          )
          return packs.map(({ pack, stateKey }, index) => {
            return {
              id: `favorite-${roomId}-${stateKey || index}`,
              favoriteKey: `${roomId}\u0000${stateKey}`,
              roomPackKey: `${roomId}\u0000${stateKey}`,
              orderKey: `room\u0000${roomId}\u0000${stateKey}`,
              label: `Favorite · ${pack.pack?.display_name || known?.name || roomId}`,
              pack,
              client: source.client,
              mine: true,
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
  }, [open, client, favoriteRoomKey, mergingAccounts, onAvailableEmotes])
  const namedPacks = orderImagePacks(
    deduplicateRoomPacks([...accountPacks, ...remoteFavoritePacks]),
    packOrder,
  )
  const groups = namedPacks
    .map((source) => {
      const items = [
        ...new Map(
          orderedImageEntries(source.pack)
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
                mine: source.mine,
              }
              return [`${name}:${item.url}`, emote]
            }),
        ).values(),
      ]
      return { ...source, orderKey: source.orderKey ?? source.id, items }
    })
    .filter((group) => group.items.length)
  const movePack = (source: string, target: string, edge: 'before' | 'after') => {
    if (!client) return
    const previous = packOrderRef.current
    const next = moveImagePackOrder(
      previous,
      groups.map((group) => group.orderKey),
      source,
      target,
      edge,
    )
    if (next.length === previous.length && next.every((key, index) => key === previous[index]))
      return
    packOrderRef.current = next
    setPackOrder(next)
    void matrixService.setImagePackOrder(next, client).catch((error) => {
      if (packOrderRef.current === next) {
        packOrderRef.current = previous
        setPackOrder(previous)
      }
      message.error(error instanceof Error ? error.message : 'Could not save pack order')
    })
  }
  const allCustom = groups.flatMap((group) => group.items)
  const availableEmotes = allCustom.filter(
    (emote) => !emote.usage || emote.usage.includes('emoticon'),
  )
  const availableEmotesKey = [
    room.roomId,
    ...availableEmotes.map(
      (emote) => `${emote.client?.getUserId() ?? ''}\u0000${emote.name}\u0000${emote.url}`,
    ),
  ].join('\u0001')
  const reportedAvailableEmotes = useRef<
    | {
        key: string
        callback: typeof onAvailableEmotes
      }
    | undefined
  >(undefined)
  useEffect(() => {
    if (
      reportedAvailableEmotes.current?.key === availableEmotesKey &&
      reportedAvailableEmotes.current.callback === onAvailableEmotes
    )
      return
    reportedAvailableEmotes.current = { key: availableEmotesKey, callback: onAvailableEmotes }
    onAvailableEmotes?.(availableEmotes)
  }, [availableEmotes, availableEmotesKey, onAvailableEmotes])
  const emojiCount = allCustom.filter(
    (emote) => !emote.usage || emote.usage.includes('emoticon'),
  ).length
  const stickerCount = allCustom.filter(
    (emote) => !emote.usage || emote.usage.includes('sticker'),
  ).length
  const selectUnicode = (emoji: string) => {
    rememberRecent(recentStorage.unicode, emoji, (item) => item)
    onUnicode(emoji)
    close()
  }
  const unicodePickerItem = (emoji: string, key: string) => (
    <PinnablePickerItem
      key={key}
      title={emoji}
      pinned={pinnedUnicode.includes(emoji)}
      onSelect={() => selectUnicode(emoji)}
      onTogglePin={() => togglePinned(pinnedStorage.unicode, emoji, (item) => item)}
    >
      {emoji}
    </PinnablePickerItem>
  )
  const unicodeSearchResults = [
    ...new Set(
      unicodeCategories.flatMap((category) =>
        matchesPickerSearch(search, category.key, category.title)
          ? category.items
          : category.items.filter((emoji) => matchesPickerSearch(search, emoji)),
      ),
    ),
  ]
  const unicodeContent = search.trim() ? (
    unicodeSearchResults.length ? (
      <EmojiGrid>
        {unicodeSearchResults.map((emoji, index) => unicodePickerItem(emoji, `${emoji}-${index}`))}
      </EmojiGrid>
    ) : (
      <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No matching Unicode emoji" />
    )
  ) : (
    <Tabs
      size="small"
      items={[
        ...(pinnedUnicode.length
          ? [
              {
                key: 'pinned',
                label: 'Pinned',
                children: (
                  <EmojiGrid>
                    {pinnedUnicode.map((emoji) => unicodePickerItem(emoji, emoji))}
                  </EmojiGrid>
                ),
              },
            ]
          : []),
        ...(recentUnicode.length
          ? [
              {
                key: 'recent',
                label: 'Recent',
                children: (
                  <EmojiGrid>
                    {recentUnicode.map((emoji) => unicodePickerItem(emoji, emoji))}
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
              {category.items.map((emoji, index) => unicodePickerItem(emoji, `${emoji}-${index}`))}
            </EmojiGrid>
          ),
        })),
      ]}
    />
  )
  const storedMatrixItem = (emote: MatrixEmote): StoredEmote => ({
    name: emote.name,
    body: emote.body,
    url: emote.url,
    info: emote.info,
    usage: emote.usage,
  })
  const toggleMatrixItemPin = (usage: 'emoticon' | 'sticker', emote: MatrixEmote) =>
    togglePinned(
      usage === 'emoticon' ? pinnedStorage.emojis : pinnedStorage.stickers,
      storedMatrixItem(emote),
      (item) => item.url,
    )
  const selectMatrixItem = (usage: 'emoticon' | 'sticker', emote: MatrixEmote) => {
    rememberRecent(
      usage === 'emoticon' ? recentStorage.emojis : recentStorage.stickers,
      storedMatrixItem(emote),
      (item) => item.url,
    )
    ;(usage === 'emoticon' ? onEmote : onSticker)(emote)
    close()
  }
  const matrixTabs = (
    <Tabs
      size="small"
      activeKey={matrixContentTab}
      onChange={(tab) => {
        if (tab !== 'emoticon' && tab !== 'sticker') return
        setMatrixContentTab(tab)
        setMatrixPickerContentTab(tab)
      }}
      items={[
        {
          key: 'emoticon',
          label: `Emoji (${emojiCount})`,
          children: (
            <MatrixPackBrowser
              usage="emoticon"
              groups={groups}
              pinned={pinnedEmojis}
              recent={recentEmojis}
              client={client}
              empty="No Matrix emoji packs"
              search={search}
              onSelect={(emote) => selectMatrixItem('emoticon', emote)}
              onTogglePin={(emote) => toggleMatrixItemPin('emoticon', emote)}
              onMovePack={movePack}
            />
          ),
        },
        {
          key: 'sticker',
          label: `Stickers (${stickerCount})`,
          children: (
            <MatrixPackBrowser
              usage="sticker"
              groups={groups}
              pinned={pinnedStickers}
              recent={recentStickers}
              client={client}
              empty="No Matrix sticker packs"
              search={search}
              onSelect={(emote) => selectMatrixItem('sticker', emote)}
              onTogglePin={(emote) => toggleMatrixItemPin('sticker', emote)}
              onMovePack={movePack}
            />
          ),
        },
      ]}
    />
  )
  const content = (
    <EmojiPanel ref={panelRef} className="foxchat-emoji-panel">
      <Input
        className="emojiSearch"
        type="search"
        value={search}
        allowClear
        prefix={<SearchOutlined />}
        placeholder="Search emoji and stickers"
        aria-label="Search emoji and stickers"
        onChange={(event) => setSearch(event.target.value)}
      />
      <Tabs
        size="small"
        activeKey={sourceTab}
        onChange={(tab) => {
          if (tab !== 'unicode' && tab !== 'matrix') return
          setSourceTab(tab)
          setEmojiPickerSourceTab(tab)
        }}
        items={[
          { key: 'unicode', label: 'Unicode', children: unicodeContent },
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
