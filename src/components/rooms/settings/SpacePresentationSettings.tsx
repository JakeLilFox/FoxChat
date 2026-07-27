import { ROOM_BANNER_EVENT_TYPE, roomBannerContent } from '../../../lib/roomBanner'
import { useRef, useState } from 'react'
import { Button, Divider, App as AntApp } from 'antd'
import { UploadOutlined } from '@ant-design/icons'
import { Room } from 'matrix-js-sdk'
import { matrixService } from '../../../matrix/MatrixClientService'

export function SpacePresentationSettings({ space }: { space: Room }) {
  const { message } = AntApp.useApp()
  const client = matrixService.clientForRoom(space.roomId)
  const userId = client?.getUserId()
  const canBanner = !!userId && space.currentState.maySendStateEvent(ROOM_BANNER_EVENT_TYPE, userId)
  const [busy, setBusy] = useState(false)
  const bannerInput = useRef<HTMLInputElement>(null)
  const sendState = (type: string, content: Record<string, unknown>) => {
    if (!client) throw new Error('Space account is unavailable')
    return (
      client.sendStateEvent as unknown as (
        roomId: string,
        type: string,
        content: Record<string, unknown>,
        stateKey: string,
      ) => Promise<unknown>
    )(space.roomId, type, content, '')
  }
  const uploadBanner = async (file?: File) => {
    if (!file || !client) return
    setBusy(true)
    try {
      const upload = await client.uploadContent(file, {
        name: file.name,
        type: file.type,
      })
      await sendState(ROOM_BANNER_EVENT_TYPE, {
        url: upload.content_uri,
        name: file.name,
        info: { mimetype: file.type, size: file.size },
      })
      message.success('Space banner updated')
    } catch (error) {
      message.error(error instanceof Error ? error.message : 'Could not update banner')
    } finally {
      setBusy(false)
      if (bannerInput.current) bannerInput.current.value = ''
    }
  }
  const removeBanner = async () => {
    setBusy(true)
    try {
      await sendState(ROOM_BANNER_EVENT_TYPE, {})
      message.success('Space banner removed')
    } catch (error) {
      message.error(error instanceof Error ? error.message : 'Could not remove banner')
    } finally {
      setBusy(false)
    }
  }
  if (!canBanner) return null
  return (
    <>
      <Divider />
      <h3>Space presentation</h3>
      <div>
        <div style={{ fontWeight: 700, marginBottom: 7 }}>Custom banner</div>
        <input
          ref={bannerInput}
          hidden
          style={{ display: 'none' }}
          type="file"
          accept="image/*"
          onChange={(event) => void uploadBanner(event.target.files?.[0])}
        />
        <div style={{ display: 'flex', gap: 8 }}>
          <Button
            icon={<UploadOutlined />}
            loading={busy}
            onClick={() => bannerInput.current?.click()}
          >
            Upload banner
          </Button>
          {roomBannerContent(space).url && (
            <Button danger loading={busy} onClick={() => void removeBanner()}>
              Remove banner
            </Button>
          )}
        </div>
      </div>
    </>
  )
}
