import { type ViewerVideo } from '../../../lib/media'
import { VideoViewerLayer } from '../../../styles'
import { useState } from 'react'
import { App as AntApp } from 'antd'
import { CloseOutlined, DownloadOutlined } from '@ant-design/icons'

export function VideoViewer({ video, onClose }: { video: ViewerVideo; onClose: () => void }) {
  const [closing, setClosing] = useState(false)
  const { message } = AntApp.useApp()
  const dismiss = () => {
    if (closing) return
    setClosing(true)
    setTimeout(onClose, 180)
  }
  const download = async () => {
    try {
      const response = await fetch(video.url)
      if (!response.ok) throw new Error('Could not load video')
      const blob = await response.blob()
      const extension = blob.type.split('/')[1] || 'mp4'
      const base =
        [...video.alt]
          .map((char) => (char.charCodeAt(0) < 32 || '<>:"/\\|?*'.includes(char) ? '_' : char))
          .join('')
          .trim() || 'video'
      const filename = /\.[a-z0-9]{2,5}$/i.test(base) ? base : `${base}.${extension}`
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = filename
      anchor.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (error) {
      message.error(error instanceof Error ? error.message : 'Could not download video')
    }
  }
  return (
    <VideoViewerLayer
      className={closing ? 'closing' : undefined}
      role="dialog"
      aria-modal="true"
      aria-label="Video viewer"
      onClick={(event) => {
        if (event.target === event.currentTarget) dismiss()
      }}
    >
      <video className="viewerVideo" src={video.url} controls autoPlay playsInline />
      <button className="viewerClose" aria-label="Close video" onClick={dismiss}>
        <CloseOutlined />
      </button>
      <button
        className="viewerClose"
        aria-label="Download video"
        style={{ right: 66 }}
        onClick={() => void download()}
      >
        <DownloadOutlined />
      </button>
    </VideoViewerLayer>
  )
}
