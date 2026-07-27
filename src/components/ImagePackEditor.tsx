import { MatrixEmoteImage } from './message'
import { type MatrixEmotePack, uniquePackName } from '../lib/emojiData'
import { IconBtn, PackEditorWrap } from '../styles'
import { useRef, useState } from 'react'
import { Button, Empty, Input, Segmented, App as AntApp } from 'antd'
import { DeleteOutlined, UploadOutlined } from '@ant-design/icons'
import { type ImageInfo } from 'matrix-js-sdk/lib/@types/media'
import { type MatrixClient } from 'matrix-js-sdk'
import { matrixService } from '../matrix/MatrixClientService'

type PackItem = {
  id: string
  name: string
  body: string
  url: string
  info?: ImageInfo
  usage: string[]
}
export function ImagePackEditor({
  pack,
  roomId,
  stateKey,
  onSaved,
}: {
  pack?: MatrixEmotePack
  roomId?: string
  stateKey?: string
  onSaved?: () => void
}) {
  const { message } = AntApp.useApp()
  const client: MatrixClient | undefined = roomId
    ? matrixService.clientForRoom(roomId)
    : matrixService.matrixClient
  const input = useRef<HTMLInputElement>(null)
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
  const upload = async (files: FileList | null) => {
    if (!files?.length) return
    setBusy(true)
    try {
      const uploaded = await matrixService.uploadImagePackFiles([...files])
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
          display_name:
            pack?.pack?.display_name ?? (roomId ? 'Room stickers and emoji' : 'Personal stickers'),
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
      onSaved?.()
    } catch (error) {
      message.error(error instanceof Error ? error.message : 'Could not save image pack')
    } finally {
      setBusy(false)
    }
  }
  return (
    <PackEditorWrap>
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
        <Button type="primary" loading={busy} onClick={() => void save()}>
          Save all changes
        </Button>
        <span className="hint">Files are uploaded together and named from their filenames.</span>
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
