import { type ElementCallMedia } from './elementCallMedia'
import { useEffect, useRef } from 'react'

export function ElementCallVideo({
  media,
  videoRef,
}: {
  media: ElementCallMedia
  videoRef?: React.RefObject<HTMLVideoElement | null>
}) {
  const ownRef = useRef<HTMLVideoElement>(null)
  const ref = videoRef ?? ownRef
  useEffect(() => {
    const video = ref.current
    if (!video) return
    video.srcObject = media.stream
    void video.play().catch(() => undefined)
    return () => {
      video.srcObject = null
    }
  }, [media.stream, ref])
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '100%',
        height: '100%',
        background: '#090a0d',
      }}
    >
      <video
        ref={ref}
        autoPlay
        playsInline
        muted={media.muted}
        style={{
          display: 'block',
          width: '100%',
          height: '100%',
          objectFit: media.screen ? 'contain' : 'cover',
          boxSizing: 'border-box',
          border: media.screen ? '1px solid rgba(255,255,255,.1)' : undefined,
        }}
      />
    </div>
  )
}
