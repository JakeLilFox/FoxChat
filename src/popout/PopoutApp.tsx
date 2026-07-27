import { useEffect, useRef, useState } from 'react'

type FpsOption = 15 | 30 | 60
type FrameMessage = { type: 'frame'; bitmap: ImageBitmap }
type ClosedMessage = { type: 'closed' }
type PopoutMessage = FrameMessage | ClosedMessage | { type: string }

const params = new URLSearchParams(window.location.search)
const channelName = params.get('channel') ?? ''
const title = params.get('title') ?? 'Screen share'

export function PopoutApp() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [fps, setFps] = useState<FpsOption>(15)
  const [connected, setConnected] = useState(false)
  const [ended, setEnded] = useState(false)

  useEffect(() => {
    document.title = `${title} · FoxChat`
  }, [])

  useEffect(() => {
    if (!channelName) return
    const channel = new BroadcastChannel(channelName)
    const context = canvasRef.current?.getContext('2d')
    channel.onmessage = (event) => {
      const data = event.data as PopoutMessage
      if (data.type === 'frame') {
        const { bitmap } = data as FrameMessage
        setConnected(true)
        const canvas = canvasRef.current
        if (canvas && context) {
          if (canvas.width !== bitmap.width || canvas.height !== bitmap.height) {
            canvas.width = bitmap.width
            canvas.height = bitmap.height
          }
          context.drawImage(bitmap, 0, 0)
        }
        bitmap.close()
      } else if (data.type === 'closed') {
        setEnded(true)
      }
    }
    const notifyClosed = () => channel.postMessage({ type: 'closed' })
    window.addEventListener('beforeunload', notifyClosed)
    return () => {
      window.removeEventListener('beforeunload', notifyClosed)
      notifyClosed()
      channel.close()
    }
  }, [])

  const changeFps = (next: FpsOption) => {
    setFps(next)
    if (channelName) new BroadcastChannel(channelName).postMessage({ type: 'fps', fps: next })
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: '#0a0b0d',
        display: 'flex',
        flexDirection: 'column',
        color: '#e6e6e6',
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      <div style={{ flex: 1, position: 'relative', minHeight: 0 }}>
        <canvas
          ref={canvasRef}
          style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}
        />
        {!connected && !ended && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'grid',
              placeItems: 'center',
              opacity: 0.7,
            }}
          >
            Connecting…
          </div>
        )}
        {ended && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'grid',
              placeItems: 'center',
              opacity: 0.7,
            }}
          >
            Screen share ended
          </div>
        )}
      </div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '6px 10px',
          background: 'rgba(255,255,255,.06)',
          fontSize: 12,
        }}
      >
        <span style={{ opacity: 0.7 }}>{title}</span>
        <div style={{ flex: 1 }} />
        <span style={{ opacity: 0.7 }}>FPS</span>
        {([15, 30, 60] as FpsOption[]).map((option) => (
          <button
            key={option}
            onClick={() => changeFps(option)}
            style={{
              padding: '2px 8px',
              borderRadius: 6,
              border: '1px solid rgba(255,255,255,.2)',
              background: fps === option ? '#7357e8' : 'transparent',
              color: 'inherit',
              cursor: 'pointer',
            }}
          >
            {option}
          </button>
        ))}
      </div>
    </div>
  )
}
