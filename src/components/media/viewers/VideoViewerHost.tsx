import { VideoViewer } from './VideoViewer'
import { type ViewerVideo } from '../../../lib/media'
import { useEffect, useRef, useState } from 'react'

export function VideoViewerHost() {
  const [video, setVideo] = useState<ViewerVideo>()
  const videoRef = useRef<ViewerVideo | undefined>(undefined)
  useEffect(() => {
    videoRef.current = video
  }, [video])
  useEffect(() => {
    const open = (event: Event) => {
      const next = (event as CustomEvent<ViewerVideo>).detail
      if (!videoRef.current) history.pushState({ ...history.state, foxchatVideoViewer: true }, '')
      setVideo(next)
    }
    const back = () => {
      if (videoRef.current) setVideo(undefined)
    }
    window.addEventListener('foxchat-video-viewer', open)
    window.addEventListener('popstate', back)
    return () => {
      window.removeEventListener('foxchat-video-viewer', open)
      window.removeEventListener('popstate', back)
    }
  }, [])
  const close = () => {
    if (history.state?.foxchatVideoViewer) history.back()
    else setVideo(undefined)
  }
  return video ? <VideoViewer video={video} onClose={close} /> : null
}
