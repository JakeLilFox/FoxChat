import { type ViewerImage } from '../../../lib/media'
import { ImageViewerLayer, ViewerContextMenu } from '../../../styles'
import { type TouchList, useRef, useState } from 'react'
import { App as AntApp } from 'antd'
import { CloseOutlined } from '@ant-design/icons'

export function ImageViewer({
  image,
  onClose,
  onMultiTouchChange,
}: {
  image: ViewerImage
  onClose: () => void
  onMultiTouchChange: (active: boolean) => void
}) {
  const [view, setView] = useState({ scale: 1, x: 0, y: 0 })
  const [closing, setClosing] = useState(false)
  const [context, setContext] = useState<{ x: number; y: number }>()
  const { message } = AntApp.useApp()
  const viewRef = useRef(view)
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const pointerTouchActive = useRef(false)
  const suppressClickUntil = useRef(0)
  const gesture = useRef<{
    scale: number
    x: number
    y: number
    distance?: number
    midX?: number
    midY?: number
    startX?: number
    startY?: number
    moved: boolean
  }>({ scale: 1, x: 0, y: 0, moved: false })
  const touchGesture = useRef<
    | {
        scale: number
        x: number
        y: number
        startX: number
        startY: number
        distance?: number
        midX?: number
        midY?: number
        moved: boolean
        multi: boolean
      }
    | undefined
  >(undefined)
  const update = (next: { scale: number; x: number; y: number }) => {
    viewRef.current = next
    setView(next)
  }
  const reset = () => update({ scale: 1, x: 0, y: 0 })
  const transformed = () =>
    Math.abs(viewRef.current.scale - 1) > 0.01 ||
    Math.abs(viewRef.current.x) > 1 ||
    Math.abs(viewRef.current.y) > 1
  const dismiss = () => {
    if (closing) return
    setClosing(true)
    setTimeout(onClose, 180)
  }
  const suppressGestureClick = () => {
    // Ignore clicks synthesized after Android multi-touch.
    suppressClickUntil.current = Date.now() + 700
  }
  const releaseGestureClickSuppression = () => {
    // Release the guard after the synthesized click window.
    setTimeout(() => {
      suppressClickUntil.current = 0
    }, 50)
  }
  const activate = () => {
    if (Date.now() < suppressClickUntil.current) return
    if (context) {
      setContext(undefined)
      return
    }
    if (transformed()) reset()
    else dismiss()
  }
  const begin = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    if (event.pointerType === 'touch') {
      pointerTouchActive.current = true
      event.preventDefault()
    }
    if (context) {
      setContext(undefined)
      suppressGestureClick()
      return
    }
    event.currentTarget.setPointerCapture(event.pointerId)
    pointers.current.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY,
    })
    const current = viewRef.current
    if (pointers.current.size === 1)
      gesture.current = {
        ...current,
        startX: event.clientX,
        startY: event.clientY,
        moved: false,
      }
    else {
      suppressGestureClick()
      onMultiTouchChange(true)
      const points = [...pointers.current.values()]
      gesture.current = {
        ...current,
        distance: Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y),
        midX: (points[0].x + points[1].x) / 2,
        midY: (points[0].y + points[1].y) / 2,
        moved: false,
      }
    }
  }
  const move = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(event.pointerId)) return
    if (event.pointerType === 'touch') event.preventDefault()
    pointers.current.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY,
    })
    const points = [...pointers.current.values()]
    const start = gesture.current
    if (points.length >= 2 && start.distance) {
      const distance = Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y)
      const midX = (points[0].x + points[1].x) / 2
      const midY = (points[0].y + points[1].y) / 2
      const scale = Math.min(10, Math.max(1, (start.scale * distance) / start.distance))
      if (Math.abs(distance - start.distance) > 3) {
        start.moved = true
        suppressGestureClick()
      }
      update({
        scale,
        x: start.x + midX - (start.midX ?? midX),
        y: start.y + midY - (start.midY ?? midY),
      })
    } else if (points.length === 1 && start.startX !== undefined && start.startY !== undefined) {
      const dx = points[0].x - start.startX
      const dy = points[0].y - start.startY
      if (Math.hypot(dx, dy) > 4) {
        start.moved = true
        suppressGestureClick()
      }
      update({ scale: start.scale, x: start.x + dx, y: start.y + dy })
    }
  }
  const end = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'touch') event.preventDefault()
    const wasTouchTap =
      event.pointerType === 'touch' && !gesture.current.moved && pointers.current.size === 1
    pointers.current.delete(event.pointerId)
    if (pointers.current.size === 1) {
      const point = [...pointers.current.values()][0]
      const current = viewRef.current
      gesture.current = {
        ...current,
        startX: point.x,
        startY: point.y,
        moved: true,
      }
    }
    if (!pointers.current.size) {
      pointerTouchActive.current = false
      onMultiTouchChange(false)
      if (wasTouchTap) {
        activate()
        // Suppress the matching compatibility click.
        suppressGestureClick()
      }
      releaseGestureClickSuppression()
    }
  }
  const wheel = (event: React.WheelEvent<HTMLDivElement>) => {
    event.preventDefault()
    const current = viewRef.current
    const scale = Math.min(10, Math.max(1, current.scale * Math.exp(-event.deltaY * 0.0015)))
    const cx = event.clientX - innerWidth / 2
    const cy = event.clientY - innerHeight / 2
    const ratio = scale / current.scale
    update({
      scale,
      x: cx - (cx - current.x) * ratio,
      y: cy - (cy - current.y) * ratio,
    })
  }
  const touchDistance = (touches: TouchList) =>
    touches.length < 2
      ? 0
      : Math.hypot(touches[1].clientX - touches[0].clientX, touches[1].clientY - touches[0].clientY)
  const touchStart = (event: React.TouchEvent<HTMLDivElement>) => {
    event.preventDefault()
    if (pointerTouchActive.current) return
    if (context) {
      setContext(undefined)
      suppressGestureClick()
      return
    }
    const current = viewRef.current
    if (event.touches.length >= 2) {
      suppressGestureClick()
      onMultiTouchChange(true)
      const first = event.touches[0]
      const second = event.touches[1]
      touchGesture.current = {
        ...current,
        startX: first.clientX,
        startY: first.clientY,
        distance: touchDistance(event.touches),
        midX: (first.clientX + second.clientX) / 2,
        midY: (first.clientY + second.clientY) / 2,
        moved: true,
        multi: true,
      }
    } else if (event.touches.length === 1) {
      const touch = event.touches[0]
      touchGesture.current = {
        ...current,
        startX: touch.clientX,
        startY: touch.clientY,
        moved: false,
        multi: false,
      }
    }
  }
  const touchMove = (event: React.TouchEvent<HTMLDivElement>) => {
    event.preventDefault()
    if (pointerTouchActive.current) return
    const start = touchGesture.current
    if (!start) return
    if (event.touches.length >= 2 && start.distance) {
      const first = event.touches[0]
      const second = event.touches[1]
      const distance = touchDistance(event.touches)
      const midX = (first.clientX + second.clientX) / 2
      const midY = (first.clientY + second.clientY) / 2
      const scale = Math.min(10, Math.max(1, (start.scale * distance) / start.distance))
      start.moved = true
      start.multi = true
      suppressGestureClick()
      update({
        scale,
        x: start.x + midX - (start.midX ?? midX),
        y: start.y + midY - (start.midY ?? midY),
      })
    } else if (event.touches.length === 1) {
      const touch = event.touches[0]
      const dx = touch.clientX - start.startX
      const dy = touch.clientY - start.startY
      if (Math.hypot(dx, dy) > 4) {
        start.moved = true
        suppressGestureClick()
      }
      update({ scale: start.scale, x: start.x + dx, y: start.y + dy })
    }
  }
  const touchEnd = (event: React.TouchEvent<HTMLDivElement>) => {
    event.preventDefault()
    if (pointerTouchActive.current) return
    const start = touchGesture.current
    if (!start) return
    if (event.touches.length === 1) {
      const touch = event.touches[0]
      const current = viewRef.current
      touchGesture.current = {
        ...current,
        startX: touch.clientX,
        startY: touch.clientY,
        moved: true,
        multi: true,
      }
      return
    }
    touchGesture.current = undefined
    onMultiTouchChange(false)
    if (!start.moved && !start.multi) {
      activate()
      suppressGestureClick()
    }
    releaseGestureClickSuppression()
  }
  const sourceBlob = async () => {
    const response = await fetch(image.url)
    if (!response.ok) throw new Error('Could not load image')
    return response.blob()
  }
  const copy = async () => {
    setContext(undefined)
    try {
      if (typeof ClipboardItem === 'undefined' || !navigator.clipboard?.write)
        throw new Error('Image copying is not supported on this platform')
      const source = await sourceBlob()
      let png = source
      if (source.type !== 'image/png') {
        const bitmap = await createImageBitmap(source)
        const canvas = document.createElement('canvas')
        canvas.width = bitmap.width
        canvas.height = bitmap.height
        canvas.getContext('2d')?.drawImage(bitmap, 0, 0)
        bitmap.close()
        png = await new Promise<Blob>((resolve, reject) =>
          canvas.toBlob(
            (value) => (value ? resolve(value) : reject(new Error('Could not convert image'))),
            'image/png',
          ),
        )
      }
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })])
      message.success('Image copied')
    } catch (error) {
      message.error(error instanceof Error ? error.message : 'Could not copy image')
    }
  }
  const download = async () => {
    setContext(undefined)
    try {
      const blob = await sourceBlob()
      const extension = blob.type.split('/')[1]?.replace('jpeg', 'jpg') || 'png'
      const base =
        [...image.alt]
          .map((char) => (char.charCodeAt(0) < 32 || '<>:"/\\|?*'.includes(char) ? '_' : char))
          .join('')
          .trim() || 'image'
      const filename = /\.[a-z0-9]{2,5}$/i.test(base) ? base : `${base}.${extension}`
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = filename
      anchor.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (error) {
      message.error(error instanceof Error ? error.message : 'Could not download image')
    }
  }
  return (
    <ImageViewerLayer
      className={closing ? 'closing' : undefined}
      role="dialog"
      aria-modal="true"
      aria-label="Image viewer"
      onClick={activate}
      onWheel={wheel}
      onContextMenu={(event) => {
        event.preventDefault()
        event.stopPropagation()
        pointers.current.clear()
        setContext({
          x: Math.min(event.clientX, window.innerWidth - 180),
          y: Math.min(event.clientY, window.innerHeight - 90),
        })
      }}
      onPointerDown={begin}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={(event) => {
        pointers.current.delete(event.pointerId)
        if (!pointers.current.size) {
          pointerTouchActive.current = false
          onMultiTouchChange(false)
          releaseGestureClickSuppression()
        }
      }}
      onTouchStart={touchStart}
      onTouchMove={touchMove}
      onTouchEnd={touchEnd}
      onTouchCancel={() => {
        touchGesture.current = undefined
        onMultiTouchChange(false)
        releaseGestureClickSuppression()
      }}
    >
      <img
        className="viewerImage"
        src={image.url}
        alt={image.alt}
        draggable={false}
        style={{
          transform: `translate(-50%,-50%) translate(${view.x}px,${view.y}px) scale(${view.scale})`,
        }}
      />
      <button
        className="viewerClose"
        aria-label="Close image"
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation()
          dismiss()
        }}
      >
        <CloseOutlined />
      </button>
      <div className="viewerHint">
        Pinch or scroll to zoom · drag to move · tap to reset or close
      </div>
      {context && (
        <ViewerContextMenu
          style={{ left: Math.max(6, context.x), top: Math.max(6, context.y) }}
          onPointerDown={(event) => event.stopPropagation()}
          onPointerUp={(event) => event.stopPropagation()}
        >
          <button type="button" onClick={() => void copy()}>
            Copy image
          </button>
          <button type="button" onClick={() => void download()}>
            Download image
          </button>
        </ViewerContextMenu>
      )}
    </ImageViewerLayer>
  )
}
