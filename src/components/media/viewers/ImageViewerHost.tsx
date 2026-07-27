import { ImageViewer } from './ImageViewer'
import { type ViewerImage } from '../../../lib/media'
import { useEffect, useRef, useState } from 'react'

export function ImageViewerHost() {
  const [image, setImage] = useState<ViewerImage>()
  const imageRef = useRef<ViewerImage | undefined>(undefined)
  const multiTouchRef = useRef(false)
  useEffect(() => {
    imageRef.current = image
  }, [image])
  useEffect(() => {
    const open = (event: Event) => {
      const next = (event as CustomEvent<ViewerImage>).detail
      if (!imageRef.current) history.pushState({ ...history.state, foxchatImageViewer: true }, '')
      setImage(next)
    }
    const back = () => {
      if (!imageRef.current) return
      if (multiTouchRef.current) {
        // Ignore Android history events during pinch gestures.
        history.pushState({ ...history.state, foxchatImageViewer: true }, '')
        return
      }
      setImage(undefined)
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
    else setImage(undefined)
  }
  return image ? (
    <ImageViewer
      image={image}
      onClose={close}
      onMultiTouchChange={(active) => {
        multiTouchRef.current = active
      }}
    />
  ) : null
}
