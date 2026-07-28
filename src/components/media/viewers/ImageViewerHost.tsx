import { ImageViewer } from './ImageViewer'
import { type ViewerGallery } from '../../../lib/media'
import { useEffect, useRef, useState } from 'react'

export function ImageViewerHost() {
  const [gallery, setGallery] = useState<ViewerGallery>()
  const galleryRef = useRef<ViewerGallery | undefined>(undefined)
  const multiTouchRef = useRef(false)
  useEffect(() => {
    galleryRef.current = gallery
  }, [gallery])
  useEffect(() => {
    const open = (event: Event) => {
      const next = (event as CustomEvent<ViewerGallery>).detail
      if (!galleryRef.current) history.pushState({ ...history.state, foxchatImageViewer: true }, '')
      setGallery(next)
    }
    const back = () => {
      if (!galleryRef.current) return
      if (multiTouchRef.current) {
        // Ignore Android history events during pinch gestures.
        history.pushState({ ...history.state, foxchatImageViewer: true }, '')
        return
      }
      setGallery(undefined)
    }
    window.addEventListener('foxchat-image-viewer', open)
    window.addEventListener('popstate', back)
    return () => {
      window.removeEventListener('foxchat-image-viewer', open)
      window.removeEventListener('popstate', back)
    }
  }, [])
  const close = () => {
    if (history.state?.foxchatImageViewer) history.back()
    else setGallery(undefined)
  }
  const image = gallery?.images[gallery.index]
  return gallery && image ? (
    <ImageViewer
      image={image}
      index={gallery.index}
      total={gallery.images.length}
      onNavigate={(index) => setGallery((current) => (current ? { ...current, index } : current))}
      onClose={close}
      onMultiTouchChange={(active) => {
        multiTouchRef.current = active
      }}
    />
  ) : null
}
