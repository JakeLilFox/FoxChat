import { MatrixEmoteImage } from './message'
import {
  type MatrixEmotePack,
  type StoredEmote,
  forgetRecents,
  orderedImageEntries,
  recentStorage,
  serializeImagePackItems,
  uniquePackName,
} from '../lib/emojiData'
import { IconBtn, PackEditorWrap } from '../styles'
import { useRef, useState } from 'react'
import { Button, Empty, Input, Modal, Segmented, App as AntApp } from 'antd'
import {
  CloudDownloadOutlined,
  DeleteOutlined,
  FileZipOutlined,
  HolderOutlined,
  UploadOutlined,
} from '@ant-design/icons'
import { type ImageInfo } from 'matrix-js-sdk/lib/@types/media'
import { type MatrixClient } from 'matrix-js-sdk'
import JSZip from 'jszip'
import { matrixService } from '../matrix/MatrixClientService'

const TELEGRAM_DOWNLOAD_ENDPOINT = 'https://sticker.zenzon.net/download'
const telegramPackName = (url: string) => {
  try {
    return new URL(url).pathname.split('/').filter(Boolean).pop()
  } catch {
    return url.split('/').filter(Boolean).pop()
  }
}

type PackItem = {
  id: string
  name: string
  body: string
  url: string
  info?: ImageInfo
  usage: string[]
}
const zipImageExtension = /\.(png|gif|jpe?g|webp)$/i
const mimeFromName = (name: string) => {
  const extension = name.split('.').pop()?.toLowerCase()
  switch (extension) {
    case 'png':
      return 'image/png'
    case 'gif':
      return 'image/gif'
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg'
    case 'webp':
      return 'image/webp'
    default:
      return 'application/octet-stream'
  }
}
const filesFromZip = async (file: Blob) => {
  const zip = await JSZip.loadAsync(file)
  const entries = Object.values(zip.files).filter((entry) => {
    const base = entry.name.split('/').pop() ?? ''
    return (
      !entry.dir &&
      !entry.name.startsWith('__MACOSX/') &&
      !base.startsWith('.') &&
      zipImageExtension.test(base)
    )
  })
  return Promise.all(
    entries.map(async (entry) => {
      const base = entry.name.split('/').pop()!
      const blob = await entry.async('blob')
      return new File([blob], base, { type: mimeFromName(base) })
    }),
  )
}
export function ImagePackEditor({
  pack,
  roomId,
  stateKey,
  defaultName,
  onSaved,
}: {
  pack?: MatrixEmotePack
  roomId?: string
  stateKey?: string
  defaultName?: string
  onSaved?: (content: MatrixEmotePack) => void
}) {
  const { message } = AntApp.useApp()
  const client: MatrixClient | undefined = roomId
    ? matrixService.clientForRoom(roomId)
    : matrixService.matrixClient
  const input = useRef<HTMLInputElement>(null)
  const zipInput = useRef<HTMLInputElement>(null)
  const savedUrls = useRef(
    new Set(Object.values(pack?.images ?? {}).flatMap((item) => (item.url ? [item.url] : []))),
  )
  const [name, setName] = useState(
    pack?.pack?.display_name ??
      defaultName ??
      (roomId ? 'Room stickers and emoji' : 'Personal stickers'),
  )
  const [items, setItems] = useState<PackItem[]>(() =>
    orderedImageEntries(pack).flatMap(([name, item]) =>
      item.url
        ? [
            {
              id: item.url,
              name,
              body: item.body || name,
              url: item.url,
              info: item.info,
              usage: item.usage?.length ? item.usage : ['sticker'],
            },
          ]
        : [],
    ),
  )
  const [busy, setBusy] = useState(false)
  const [drag, setDrag] = useState<{
    source: string
    target?: string
    edge?: 'before' | 'after'
  }>()
  const [telegramModalOpen, setTelegramModalOpen] = useState(false)
  const [telegramUrl, setTelegramUrl] = useState('')
  const addUploaded = (uploaded: { body: string; url: string; info?: unknown }[]) => {
    setItems((current) => {
      const used = new Set(current.map((item) => item.name))
      return [
        ...current,
        ...uploaded.map((item, index) => {
          const name = uniquePackName(item.body, used)
          return {
            id: `${item.url}-${index}`,
            name,
            body: name,
            url: item.url,
            info: item.info as ImageInfo,
            usage: ['sticker'],
          }
        }),
      ]
    })
  }
  const upload = async (files: FileList | null) => {
    if (!files?.length) return
    setBusy(true)
    try {
      const uploaded = await matrixService.uploadImagePackFiles([...files])
      addUploaded(uploaded)
      message.success(
        `${files.length} image${files.length === 1 ? '' : 's'} uploaded, review the names, then save`,
      )
    } catch (error) {
      message.error(error instanceof Error ? error.message : 'Could not upload images')
    } finally {
      setBusy(false)
      if (input.current) input.current.value = ''
    }
  }
  const importZip = async (files: FileList | null) => {
    const file = files?.[0]
    if (!file) return
    setBusy(true)
    try {
      const extracted = await filesFromZip(file)
      if (!extracted.length) {
        message.warning('No PNG, GIF, JPEG or WebP images found in that zip')
        return
      }
      const uploaded = await matrixService.uploadImagePackFiles(extracted)
      addUploaded(uploaded)
      message.success(
        `${extracted.length} image${extracted.length === 1 ? '' : 's'} imported from the zip, review the names, then save`,
      )
    } catch (error) {
      message.error(error instanceof Error ? error.message : 'Could not import that zip file')
    } finally {
      setBusy(false)
      if (zipInput.current) zipInput.current.value = ''
    }
  }
  const importFromTelegram = async () => {
    const url = telegramUrl.trim()
    if (!url) return
    setBusy(true)
    try {
      const response = await fetch(`${TELEGRAM_DOWNLOAD_ENDPOINT}?url=${encodeURIComponent(url)}`)
      if (!response.ok) throw new Error(`Could not download that sticker pack (${response.status})`)
      const extracted = await filesFromZip(await response.blob())
      if (!extracted.length) {
        message.warning('No PNG, GIF, JPEG or WebP images found in that sticker pack')
        return
      }
      const uploaded = await matrixService.uploadImagePackFiles(extracted)
      addUploaded(uploaded)
      const packName = telegramPackName(url)
      if (packName) setName(packName)
      message.success(
        `${extracted.length} image${extracted.length === 1 ? '' : 's'} imported from Telegram, review the names, then save`,
      )
      setTelegramModalOpen(false)
      setTelegramUrl('')
    } catch (error) {
      message.error(
        error instanceof Error ? error.message : 'Could not import that Telegram sticker pack',
      )
    } finally {
      setBusy(false)
    }
  }
  const dropItem = (targetId: string, edge: 'before' | 'after') => {
    const sourceId = drag?.source
    setDrag(undefined)
    if (!sourceId || sourceId === targetId) return
    setItems((current) => {
      const source = current.find((item) => item.id === sourceId)
      const next = current.filter((item) => item.id !== sourceId)
      const targetIndex = next.findIndex((item) => item.id === targetId)
      if (!source || targetIndex < 0) return current
      next.splice(targetIndex + (edge === 'after' ? 1 : 0), 0, source)
      return next
    })
  }
  const save = async () => {
    setBusy(true)
    try {
      const images = serializeImagePackItems(items)
      const content = {
        pack: {
          display_name: name.trim() || (roomId ? 'Room stickers and emoji' : 'Personal stickers'),
        },
        images,
      }
      if (roomId) await matrixService.saveRoomImagePack(roomId, content, stateKey)
      else await matrixService.savePersonalImagePack(content)
      const currentUrls = new Set(items.map((item) => item.url))
      const removedUrls = new Set([...savedUrls.current].filter((url) => !currentUrls.has(url)))
      if (removedUrls.size) {
        const wasRemoved = (item: StoredEmote) => removedUrls.has(item.url)
        forgetRecents<StoredEmote>(recentStorage.emojis, wasRemoved)
        forgetRecents<StoredEmote>(recentStorage.stickers, wasRemoved)
      }
      savedUrls.current = currentUrls
      setItems((current) =>
        current.map((item, index) => ({
          ...item,
          name: Object.keys(images)[index] ?? item.name,
          body: Object.keys(images)[index] ?? item.body,
        })),
      )
      message.success('Image pack saved')
      onSaved?.(content)
    } catch (error) {
      message.error(error instanceof Error ? error.message : 'Could not save image pack')
    } finally {
      setBusy(false)
    }
  }
  return (
    <PackEditorWrap>
      <Input
        className="packNameInput"
        aria-label="Pack name"
        placeholder="Pack name"
        value={name}
        onChange={(event) => setName(event.target.value)}
      />
      <div className="packActions">
        <input
          ref={input}
          hidden
          type="file"
          accept="image/*"
          multiple
          onChange={(event) => void upload(event.target.files)}
        />
        <Button icon={<UploadOutlined />} loading={busy} onClick={() => input.current?.click()}>
          Upload images
        </Button>
        <input
          ref={zipInput}
          hidden
          type="file"
          accept=".zip,application/zip,application/x-zip-compressed"
          onChange={(event) => void importZip(event.target.files)}
        />
        <Button icon={<FileZipOutlined />} loading={busy} onClick={() => zipInput.current?.click()}>
          Import zip
        </Button>
        <Button
          icon={<CloudDownloadOutlined />}
          loading={busy}
          onClick={() => setTelegramModalOpen(true)}
        >
          Import from Telegram
        </Button>
        <Button type="primary" loading={busy} onClick={() => void save()}>
          Save all changes
        </Button>
        <span className="hint">
          Files are uploaded together and named from their filenames. A zip is unpacked and every
          PNG, GIF, JPEG or WebP inside is added as a sticker. Drag images to change their order.
        </span>
      </div>
      <Modal
        title="Import from Telegram"
        open={telegramModalOpen}
        okText="Import"
        confirmLoading={busy}
        onOk={() => void importFromTelegram()}
        onCancel={() => setTelegramModalOpen(false)}
      >
        <p>
          Paste a Telegram sticker pack link, e.g. <code>https://t.me/addstickers/foxflea</code>.
          The pack name is taken from the end of the link.
        </p>
        <Input
          aria-label="Telegram sticker pack link"
          placeholder="https://t.me/addstickers/foxflea"
          value={telegramUrl}
          onChange={(event) => setTelegramUrl(event.target.value)}
          onPressEnter={() => void importFromTelegram()}
          autoFocus
        />
      </Modal>
      <div className="packList">
        {items.map((item) => {
          const edge = drag?.target === item.id ? drag.edge : undefined
          return (
            <div
              className="packItem"
              key={item.id}
              onDragOver={(event) => {
                if (!drag?.source || drag.source === item.id) return
                event.preventDefault()
                event.dataTransfer.dropEffect = 'move'
                const bounds = event.currentTarget.getBoundingClientRect()
                const nextEdge = event.clientY < bounds.top + bounds.height / 2 ? 'before' : 'after'
                setDrag((current) =>
                  current?.target === item.id && current.edge === nextEdge
                    ? current
                    : { source: drag.source, target: item.id, edge: nextEdge },
                )
              }}
              onDrop={(event) => {
                event.preventDefault()
                dropItem(item.id, edge ?? 'before')
              }}
              style={{
                borderTop: edge === 'before' ? '3px solid #7357e8' : undefined,
                borderBottom: edge === 'after' ? '3px solid #7357e8' : undefined,
                opacity: drag?.source === item.id ? 0.45 : 1,
              }}
            >
              <button
                className="dragHandle"
                type="button"
                draggable={!busy}
                disabled={busy}
                title={`Reorder ${item.name}`}
                aria-label={`Reorder ${item.name}`}
                onDragStart={(event) => {
                  setDrag({ source: item.id })
                  event.dataTransfer.effectAllowed = 'move'
                  event.dataTransfer.setData('text/plain', item.id)
                }}
                onDragEnd={() => setDrag(undefined)}
              >
                <HolderOutlined />
              </button>
              <div className="packImage">
                <MatrixEmoteImage emote={{ ...item, client, mine: true }} />
              </div>
              <Input
                value={item.name}
                aria-label="Sticker name"
                onChange={(event) =>
                  setItems((current) =>
                    current.map((value) =>
                      value.id === item.id ? { ...value, name: event.target.value } : value,
                    ),
                  )
                }
              />
              <Segmented
                className="usage"
                size="small"
                value={
                  item.usage.includes('sticker') && item.usage.includes('emoticon')
                    ? 'both'
                    : item.usage.includes('emoticon')
                      ? 'emoji'
                      : 'sticker'
                }
                options={[
                  { label: 'Sticker', value: 'sticker' },
                  { label: 'Emoji', value: 'emoji' },
                  { label: 'Both', value: 'both' },
                ]}
                onChange={(value) =>
                  setItems((current) =>
                    current.map((entry) =>
                      entry.id === item.id
                        ? {
                            ...entry,
                            usage:
                              value === 'both'
                                ? ['sticker', 'emoticon']
                                : value === 'emoji'
                                  ? ['emoticon']
                                  : ['sticker'],
                          }
                        : entry,
                    ),
                  )
                }
              />
              <IconBtn
                danger
                shape="circle"
                title="Remove"
                icon={<DeleteOutlined />}
                onClick={() =>
                  setItems((current) => current.filter((value) => value.id !== item.id))
                }
              />
            </div>
          )
        })}
        {!items.length && (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No images in this pack" />
        )}
      </div>
    </PackEditorWrap>
  )
}
