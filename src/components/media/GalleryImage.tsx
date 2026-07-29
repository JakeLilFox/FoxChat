import { useMediaUrl } from '../../lib/hooks'
import { showImageViewer } from '../../lib/media'
import { Spin } from 'antd'
import { MatrixClient, MatrixEvent } from 'matrix-js-sdk'

export function GalleryImage({ event, client }: { event: MatrixEvent; client?: MatrixClient }) {
  const content = event.getContent()
  const url = useMediaUrl(content, client, {
    category: 'message-image',
    roomId: event.getRoomId() ?? undefined,
    timestamp: event.getTs(),
  })
  const label = String(content.body || 'Room image')
  return (
    <button
      className="galleryImage"
      type="button"
      title={label}
      onClick={() => {
        if (url) showImageViewer(url, label)
      }}
    >
      {url ? <img src={url} alt={label} loading="lazy" /> : <Spin size="small" />}
    </button>
  )
}
