import { type ChatBackground, currentChatBackground } from '../../../lib/chatBackground'
import { formatFileSize } from '../../../lib/format'
import { useMediaUrl } from '../../../lib/hooks'
import { Preview } from '../../../styles'
import { useRef, useState } from 'react'
import { Button, Divider, App as AntApp } from 'antd'
import { UploadOutlined } from '@ant-design/icons'
import { matrixService } from '../../../matrix/MatrixClientService'

export function ChatBackgroundSettings() {
  const { message } = AntApp.useApp()
  const input = useRef<HTMLInputElement>(null)
  const [background, setBackground] = useState<ChatBackground | undefined>(currentChatBackground)
  const [busy, setBusy] = useState(false)
  const preview = useMediaUrl(background ?? {})
  const upload = async (file?: File) => {
    if (!file) return
    setBusy(true)
    try {
      const next = await matrixService.setChatBackground(file)
      setBackground(next)
      window.dispatchEvent(new CustomEvent('foxchat-chat-background', { detail: next }))
      message.success('Chat background updated')
    } catch (error) {
      message.error(error instanceof Error ? error.message : 'Could not update background')
    } finally {
      setBusy(false)
      if (input.current) input.current.value = ''
    }
  }
  const remove = async () => {
    setBusy(true)
    try {
      await matrixService.setChatBackground()
      setBackground(undefined)
      window.dispatchEvent(new CustomEvent('foxchat-chat-background'))
      message.success('Chat background removed')
    } catch (error) {
      message.error(error instanceof Error ? error.message : 'Could not remove background')
    } finally {
      setBusy(false)
    }
  }
  return (
    <div>
      <Divider />
      <h3>Chat background</h3>
      <p>
        The image is uploaded to Matrix media and its MXC address is stored in your account data. It
        is shown only behind messages.
      </p>
      {preview && (
        <div
          style={{
            height: 170,
            borderRadius: 12,
            backgroundImage: `url("${preview}")`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            marginBottom: 12,
          }}
        />
      )}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <input
          ref={input}
          hidden
          style={{ display: 'none' }}
          type="file"
          accept="image/*"
          onChange={(event) => void upload(event.target.files?.[0])}
        />
        <Button icon={<UploadOutlined />} loading={busy} onClick={() => input.current?.click()}>
          {background ? 'Replace background' : 'Upload background'}
        </Button>
        {background && (
          <Button danger loading={busy} onClick={() => void remove()}>
            Remove background
          </Button>
        )}
      </div>
      {background?.name && (
        <Preview style={{ marginTop: 8 }}>
          {background.name}
          {background.info?.size ? ` · ${formatFileSize(background.info.size)}` : ''}
        </Preview>
      )}
    </div>
  )
}
