import { MatrixEmoteImage } from './message'
import { type MatrixEmotePack, uniquePackName } from '../lib/emojiData'
import { IconBtn, PackEditorWrap } from '../styles'
import { useRef, useState } from 'react'
import { Button, Empty, Input, Segmented, App as AntApp } from 'antd'
import { DeleteOutlined, FileZipOutlined, UploadOutlined } from '@ant-design/icons'
import { type ImageInfo } from 'matrix-js-sdk/lib/@types/media'
import { type MatrixClient } from 'matrix-js-sdk'
import JSZip from 'jszip'
import { matrixService } from '../matrix/MatrixClientService'

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
const filesFromZip = async (file: File) => {
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
  const [name, setName] = useState(
    pack?.pack?.display_name ??
      defaultName ??
      (roomId ? 'Room stickers and emoji' : 'Personal stickers'),
  )
  const [items, setItems] = useState<PackItem[]>(() =>
    Object.entries(pack?.images ?? {}).flatMap(([name, item]) =>
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
  const save = async () => {
    setBusy(true)
    try {
      const used = new Set<string>()
      const images = Object.fromEntries(
        items.map((item) => {
          const name = uniquePackName(item.name, used)
          return [name, { body: name, url: item.url, info: item.info, usage: item.usage }]
        }),
      )
      const content = {
        pack: {
          display_name: name.trim() || (roomId ? 'Room stickers and emoji' : 'Personal stickers'),
        },
        images,
      }
      if (roomId) await matrixService.saveRoomImagePack(roomId, content, stateKey)
      else await matrixService.savePersonalImagePack(content)
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
        <Button type="primary" loading={busy} onClick={() => void save()}>
          Save all changes
        </Button>
        <span className="hint">
          Files are uploaded together and named from their filenames. A zip is unpacked and every
          PNG, GIF, JPEG or WebP inside is added as a sticker.
        </span>
      </div>
      <div className="packList">
        {items.map((item) => (
          <div className="packItem" key={item.id}>
            <div className="packImage">
              <MatrixEmoteImage emote={{ ...item, client }} />
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
              onClick={() => setItems((current) => current.filter((value) => value.id !== item.id))}
            />
          </div>
        ))}
        {!items.length && (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No images in this pack" />
        )}
      </div>
    </PackEditorWrap>
  )
}
