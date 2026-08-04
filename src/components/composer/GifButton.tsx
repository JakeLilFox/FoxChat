import {
  type KlipyGif,
  type KlipyGifPage,
  pickGifFile,
  recentGifsStorage,
  rememberRecentGif,
  searchGifs,
  trendingGifs,
} from '../../lib/gifs'
import { useRecents } from '../../lib/emojiData'
import { useMediaUrl } from '../../lib/hooks'
import { closeGifUrl, gifOpenFromUrl, openGifUrl } from '../../lib/urlState'
import { EmojiPanel, GifGrid, IconBtn } from '../../styles'
import { useEffect, useRef, useState } from 'react'
import { App as AntApp, Dropdown, Empty, Input, Popover, Spin, Tabs } from 'antd'
import { DeleteOutlined, StarFilled, StarOutlined } from '@ant-design/icons'
import { MatrixClient, Room } from 'matrix-js-sdk'
import { matrixService, type SavedGifItem } from '../../matrix/MatrixClientService'

const LONG_PRESS_MS = 550

export type GifSelection =
  | { type: 'live'; gif: KlipyGif; query: string }
  | { type: 'saved'; item: SavedGifItem }

const savedGifKey = (item: SavedGifItem) => (item.source === 'klipy' ? item.slug : item.url)

function LongPressButton({
  title,
  className,
  onSelect,
  menuItems,
  children,
}: {
  title: string
  className?: string
  onSelect: () => void
  menuItems: { key: string; icon: React.ReactNode; label: string; onClick: () => void }[]
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
      rootClassName="foxchat-gif-item-menu"
      getPopupContainer={(trigger) =>
        trigger.closest<HTMLElement>('.foxchat-gif-panel, .foxchat-emoji-panel') ?? document.body
      }
      menu={{ items: menuItems }}
    >
      <button
        type="button"
        className={className}
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

function GifResultTile({
  gif,
  saved,
  onSelect,
  onToggleSave,
}: {
  gif: KlipyGif
  saved: boolean
  onSelect: () => void
  onToggleSave: () => void
}) {
  const thumb =
    pickGifFile(gif, 'sm', 'webp') ??
    pickGifFile(gif, 'xs', 'webp') ??
    pickGifFile(gif, 'sm', 'gif')
  return (
    <LongPressButton
      title={gif.title || gif.slug}
      onSelect={onSelect}
      menuItems={[
        {
          key: 'save',
          icon: saved ? <StarFilled /> : <StarOutlined />,
          label: saved ? 'Remove from saved' : 'Save GIF',
          onClick: onToggleSave,
        },
      ]}
    >
      {thumb ? (
        <img src={thumb.url} alt={gif.title || 'GIF'} loading="lazy" />
      ) : (
        <Spin size="small" />
      )}
      {saved && (
        <span className="gifSavedBadge">
          <StarFilled />
        </span>
      )}
    </LongPressButton>
  )
}

function SavedGifTile({
  item,
  client,
  onSelect,
  onRemove,
}: {
  item: SavedGifItem
  client?: MatrixClient
  onSelect: () => void
  onRemove: () => void
}) {
  const matrixUrl = useMediaUrl(
    item.source === 'matrix' ? { url: item.url, file: item.file, info: item.info } : undefined,
    client,
  )
  const thumb = item.source === 'klipy' ? item.preview : matrixUrl
  const label = item.source === 'klipy' ? item.title || item.slug : item.body || 'Saved GIF'
  return (
    <LongPressButton
      title={label}
      onSelect={onSelect}
      menuItems={[
        { key: 'remove', icon: <DeleteOutlined />, label: 'Remove from saved', onClick: onRemove },
      ]}
    >
      {thumb ? <img src={thumb} alt={label} loading="lazy" /> : <Spin size="small" />}
    </LongPressButton>
  )
}

// The search + tabbed grid, without any popover/trigger chrome, so it can be embedded either as
// GifButton's own popover content (desktop/tablet) or as a tab inside EmojiButton's picker
// (small screens, where a separate composer button would eat too much toolbar space).
export function GifPickerPanel({
  room,
  onSelect,
}: {
  room: Room
  onSelect: (selection: GifSelection) => void
}) {
  const { message } = AntApp.useApp()
  const [search, setSearch] = useState('')
  const [tab, setTab] = useState<'browse' | 'saved' | 'recent'>('browse')
  const [page, setPage] = useState<KlipyGifPage>()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>()
  const [, forceUpdate] = useState(0)
  const requestId = useRef(0)
  const loadMoreRef = useRef<HTMLDivElement>(null)
  const client = matrixService.clientForRoom(room.roomId)
  const recentGifs = useRecents<KlipyGif>(recentGifsStorage)

  const runQuery = (query: string, pageNum: number, append: boolean) => {
    const id = ++requestId.current
    setLoading(true)
    setError(undefined)
    const fetcher = query.trim() ? searchGifs(query.trim(), pageNum) : trendingGifs(pageNum)
    fetcher
      .then((result) => {
        if (requestId.current !== id) return
        setPage((current) =>
          append && current ? { ...result, items: [...current.items, ...result.items] } : result,
        )
      })
      .catch((fetchError) => {
        if (requestId.current !== id) return
        setError(fetchError instanceof Error ? fetchError.message : 'Could not load GIFs')
      })
      .finally(() => {
        if (requestId.current === id) setLoading(false)
      })
  }
  useEffect(() => {
    if (tab !== 'browse') return
    const delay = search.trim() ? 350 : 0
    const handle = window.setTimeout(() => runQuery(search, 1, false), delay)
    return () => window.clearTimeout(handle)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, search])
  // Auto-load the next page as the sentinel below the grid scrolls into view, instead of a
  // "Load more" button. Re-runs whenever the page/loading state changes so it immediately keeps
  // loading if the sentinel is still on screen once a fetch finishes (e.g. a tall viewport).
  useEffect(() => {
    const node = loadMoreRef.current
    if (tab !== 'browse' || !node || loading || !page?.hasNext) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) runQuery(search, (page.page ?? 1) + 1, true)
      },
      { rootMargin: '200px' },
    )
    observer.observe(node)
    return () => observer.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, page, loading, search])

  const savedItems = matrixService.savedGifs(client)
  const isSavedKlipy = (slug: string) => savedItems.some((item) => savedGifKey(item) === slug)
  const refresh = () => forceUpdate((value) => value + 1)
  const showError = (thrown: unknown) =>
    message.error(thrown instanceof Error ? thrown.message : 'Could not update saved GIFs')

  const toggleSaveKlipy = (gif: KlipyGif) => {
    if (isSavedKlipy(gif.slug)) {
      void matrixService.removeSavedGifItem(gif.slug, client).then(refresh).catch(showError)
      return
    }
    const preview =
      pickGifFile(gif, 'sm', 'webp')?.url ??
      pickGifFile(gif, 'xs', 'webp')?.url ??
      pickGifFile(gif, 'sm', 'gif')?.url ??
      ''
    void matrixService
      .saveGifItem(
        { source: 'klipy', slug: gif.slug, title: gif.title, preview, savedAt: Date.now() },
        client,
      )
      .then(refresh)
      .catch(showError)
  }
  const removeSaved = (item: SavedGifItem) => {
    void matrixService.removeSavedGifItem(savedGifKey(item), client).then(refresh).catch(showError)
  }
  const selectLive = (gif: KlipyGif) => {
    rememberRecentGif(gif)
    onSelect({ type: 'live', gif, query: search.trim() })
  }
  const selectSaved = (item: SavedGifItem) => {
    onSelect({ type: 'saved', item })
  }

  const browseContent = error ? (
    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={error} />
  ) : !loading && !page?.items.length ? (
    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No GIFs found" />
  ) : (
    <GifGrid>
      {page?.items.map((gif) => (
        <GifResultTile
          key={gif.slug}
          gif={gif}
          saved={isSavedKlipy(gif.slug)}
          onSelect={() => selectLive(gif)}
          onToggleSave={() => toggleSaveKlipy(gif)}
        />
      ))}
      {loading && !page?.items.length && (
        <Spin size="small" style={{ gridColumn: '1 / -1', margin: '20px auto' }} />
      )}
      {page?.hasNext && (
        <div ref={loadMoreRef} className="gifLoadMore">
          {loading && page.items.length > 0 && <Spin size="small" />}
        </div>
      )}
    </GifGrid>
  )

  const savedContent = savedItems.length ? (
    <GifGrid>
      {savedItems.map((item) => (
        <SavedGifTile
          key={savedGifKey(item)}
          item={item}
          client={client}
          onSelect={() => selectSaved(item)}
          onRemove={() => removeSaved(item)}
        />
      ))}
    </GifGrid>
  ) : (
    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No saved GIFs yet" />
  )

  const recentContent = recentGifs.length ? (
    <GifGrid>
      {recentGifs.map((gif) => (
        <GifResultTile
          key={gif.slug}
          gif={gif}
          saved={isSavedKlipy(gif.slug)}
          onSelect={() => selectLive(gif)}
          onToggleSave={() => toggleSaveKlipy(gif)}
        />
      ))}
    </GifGrid>
  ) : (
    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No recent GIFs" />
  )

  return (
    <>
      <Input
        className="emojiSearch"
        type="search"
        value={search}
        allowClear
        placeholder="Search KLIPY"
        aria-label="Search KLIPY"
        onChange={(event) => {
          setSearch(event.target.value)
          setTab('browse')
        }}
      />
      <Tabs
        size="small"
        activeKey={tab}
        onChange={(key) => {
          if (key !== 'browse' && key !== 'saved' && key !== 'recent') return
          setTab(key)
        }}
        items={[
          { key: 'browse', label: search.trim() ? 'Search' : 'Trending', children: browseContent },
          { key: 'saved', label: `Saved (${savedItems.length})`, children: savedContent },
          { key: 'recent', label: `Recent (${recentGifs.length})`, children: recentContent },
        ]}
      />
    </>
  )
}

export function GifButton({
  room,
  onSelect,
}: {
  room: Room
  onSelect: (selection: GifSelection) => void
}) {
  const [open, setOpen] = useState(() => gifOpenFromUrl())
  const triggerRef = useRef<HTMLSpanElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const sync = () => setOpen(gifOpenFromUrl())
    window.addEventListener('popstate', sync)
    return () => window.removeEventListener('popstate', sync)
  }, [])
  const close = () => {
    closeGifUrl()
    setOpen(false)
  }
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

  const content = (
    <EmojiPanel ref={panelRef} className="foxchat-gif-panel">
      <GifPickerPanel
        room={room}
        onSelect={(selection) => {
          onSelect(selection)
          close()
        }}
      />
    </EmojiPanel>
  )

  return (
    <Popover
      rootClassName="foxchat-gif-popover"
      open={open}
      onOpenChange={(next) => {
        if (next) {
          openGifUrl()
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
        <IconBtn
          title="Send a GIF"
          aria-label="Send a GIF"
          style={{ fontWeight: 800, fontSize: 11 }}
        >
          GIF
        </IconBtn>
      </span>
    </Popover>
  )
}
