import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Button, Modal, Slider, theme as antTheme } from 'antd'

type CropShape = 'circle' | 'banner'
type Point = { x: number; y: number }

const IMAGE_PADDING = 16
const MIN_CROP_SIZE = 10
const INITIAL_CROP_SIZE = 50
const BANNER_RATIO = 3

export function ImageCropModal({
  file,
  shape,
  open,
  busy,
  onCancel,
  onConfirm,
}: {
  file?: File
  shape: CropShape
  open: boolean
  busy?: boolean
  onCancel: () => void
  onConfirm: (file: File) => void | Promise<void>
}) {
  const { token } = antTheme.useToken()
  const stageRef = useRef<HTMLDivElement>(null)
  const pointers = useRef(new Map<number, Point>())
  const gesture = useRef<
    | {
        center: Point
        point?: Point
        distance?: number
        size: number
      }
    | undefined
  >(undefined)
  const [source, setSource] = useState<string>()
  const [naturalSize, setNaturalSize] = useState({ width: 0, height: 0 })
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 })
  const [center, setCenter] = useState<Point>({ x: 0.5, y: 0.5 })
  const [cropSize, setCropSize] = useState(INITIAL_CROP_SIZE)

  useEffect(() => {
    if (!file) {
      setSource(undefined)
      setNaturalSize({ width: 0, height: 0 })
      return
    }
    const url = URL.createObjectURL(file)
    setSource(url)
    setNaturalSize({ width: 0, height: 0 })
    setCenter({ x: 0.5, y: 0.5 })
    setCropSize(INITIAL_CROP_SIZE)
    return () => URL.revokeObjectURL(url)
  }, [file])

  useLayoutEffect(() => {
    if (!open || !stageRef.current) return
    const update = () => {
      const box = stageRef.current?.getBoundingClientRect()
      if (box) setStageSize({ width: box.width, height: box.height })
    }
    const observer = new ResizeObserver(update)
    observer.observe(stageRef.current)
    update()
    return () => observer.disconnect()
  }, [open])

  const fitScale =
    naturalSize.width && naturalSize.height && stageSize.width && stageSize.height
      ? Math.min(
          Math.max(0, stageSize.width - IMAGE_PADDING * 2) / naturalSize.width,
          Math.max(0, stageSize.height - IMAGE_PADDING * 2) / naturalSize.height,
        )
      : 0
  const imageSize = {
    width: naturalSize.width * fitScale,
    height: naturalSize.height * fitScale,
  }
  const ratio = shape === 'circle' ? 1 : BANNER_RATIO
  const maximumCrop =
    imageSize.width / imageSize.height > ratio
      ? { width: imageSize.height * ratio, height: imageSize.height }
      : { width: imageSize.width, height: imageSize.width / ratio }
  const crop = {
    width: maximumCrop.width * (cropSize / 100),
    height: maximumCrop.height * (cropSize / 100),
  }

  const clampCenter = (value: Point, nextSize = cropSize): Point => {
    if (!imageSize.width || !imageSize.height) return { x: 0.5, y: 0.5 }
    const halfWidth = (maximumCrop.width * (nextSize / 100)) / imageSize.width / 2
    const halfHeight = (maximumCrop.height * (nextSize / 100)) / imageSize.height / 2
    return {
      x: Math.max(halfWidth, Math.min(1 - halfWidth, value.x)),
      y: Math.max(halfHeight, Math.min(1 - halfHeight, value.y)),
    }
  }

  const changeSize = (value: number) => {
    const next = Math.max(MIN_CROP_SIZE, Math.min(100, value))
    setCropSize(next)
    setCenter((current) => clampCenter(current, next))
  }

  useEffect(() => {
    setCenter((current) => clampCenter(current))
    // Reposition after the fitted image dimensions or crop shape changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageSize.width, imageSize.height, maximumCrop.width, maximumCrop.height])

  const pointerDistance = (values: Point[]) =>
    values.length < 2 ? 0 : Math.hypot(values[0].x - values[1].x, values[0].y - values[1].y)

  const finish = async () => {
    if (!file || !source || !naturalSize.width || !imageSize.width) return
    const output = shape === 'circle' ? { width: 512, height: 512 } : { width: 1500, height: 500 }
    const naturalMaximum =
      naturalSize.width / naturalSize.height > ratio
        ? { width: naturalSize.height * ratio, height: naturalSize.height }
        : {
            width: naturalSize.width,
            height: naturalSize.width / ratio,
          }
    const sourceWidth = naturalMaximum.width * (cropSize / 100)
    const sourceHeight = naturalMaximum.height * (cropSize / 100)
    const sourceX = naturalSize.width * center.x - sourceWidth / 2
    const sourceY = naturalSize.height * center.y - sourceHeight / 2
    const image = new Image()
    image.src = source
    await image.decode()
    const canvas = document.createElement('canvas')
    canvas.width = output.width
    canvas.height = output.height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Image cropping is unavailable')
    context.drawImage(
      image,
      sourceX,
      sourceY,
      sourceWidth,
      sourceHeight,
      0,
      0,
      output.width,
      output.height,
    )
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (value) => (value ? resolve(value) : reject(new Error('Could not crop image'))),
        'image/webp',
        0.9,
      ),
    )
    const stem = file.name.replace(/\.[^.]+$/, '') || 'profile-image'
    await onConfirm(new File([blob], `${stem}-cropped.webp`, { type: blob.type }))
  }

  return (
    <Modal
      open={open}
      title={shape === 'circle' ? 'Crop profile picture' : 'Crop profile banner'}
      onCancel={onCancel}
      destroyOnHidden
      width={760}
      footer={[
        <Button key="cancel" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>,
        <Button key="save" type="primary" loading={busy} onClick={() => void finish()}>
          Use this crop
        </Button>,
      ]}
    >
      <p style={{ marginTop: 0, color: token.colorTextSecondary }}>
        Drag the selection to position it. Scroll, pinch, or use the slider to resize it.
      </p>
      <div
        ref={stageRef}
        style={{
          position: 'relative',
          width: '100%',
          height: 'min(58dvh,520px)',
          minHeight: 280,
          overflow: 'hidden',
          borderRadius: 12,
          boxShadow: `inset 0 0 0 1px ${token.colorBorder}`,
        }}
      >
        {source && (
          <img
            src={source}
            alt=""
            draggable={false}
            onLoad={(event) => {
              const stageBox = stageRef.current?.getBoundingClientRect()
              if (stageBox) {
                setStageSize({
                  width: stageBox.width,
                  height: stageBox.height,
                })
              }
              setNaturalSize({
                width: event.currentTarget.naturalWidth,
                height: event.currentTarget.naturalHeight,
              })
            }}
            style={{
              position: 'absolute',
              left: '50%',
              top: '50%',
              width: 'auto',
              height: 'auto',
              maxWidth: `calc(100% - ${IMAGE_PADDING * 2}px)`,
              maxHeight: `calc(100% - ${IMAGE_PADDING * 2}px)`,
              transform: 'translate(-50%,-50%)',
              display: imageSize.width ? 'none' : 'block',
              userSelect: 'none',
              pointerEvents: 'none',
            }}
          />
        )}
        {source && !!imageSize.width && !!imageSize.height && (
          <div
            onWheel={(event) => {
              event.preventDefault()
              changeSize(cropSize + (event.deltaY > 0 ? 3 : -3))
            }}
            onPointerDown={(event) => {
              event.currentTarget.setPointerCapture(event.pointerId)
              pointers.current.set(event.pointerId, {
                x: event.clientX,
                y: event.clientY,
              })
              const values = [...pointers.current.values()]
              gesture.current = {
                center,
                point: values.length === 1 ? values[0] : undefined,
                distance: pointerDistance(values) || undefined,
                size: cropSize,
              }
            }}
            onPointerMove={(event) => {
              if (!pointers.current.has(event.pointerId)) return
              pointers.current.set(event.pointerId, {
                x: event.clientX,
                y: event.clientY,
              })
              const values = [...pointers.current.values()]
              const start = gesture.current
              if (!start) return
              if (values.length >= 2 && start.distance) {
                changeSize(start.size * (pointerDistance(values) / start.distance))
              } else if (
                values.length === 1 &&
                start.point &&
                imageSize.width &&
                imageSize.height
              ) {
                setCenter(
                  clampCenter({
                    x: start.center.x + (values[0].x - start.point.x) / imageSize.width,
                    y: start.center.y + (values[0].y - start.point.y) / imageSize.height,
                  }),
                )
              }
            }}
            onPointerUp={(event) => {
              pointers.current.delete(event.pointerId)
              if (event.currentTarget.hasPointerCapture(event.pointerId))
                event.currentTarget.releasePointerCapture(event.pointerId)
              const values = [...pointers.current.values()]
              gesture.current = values.length
                ? { center, point: values[0], size: cropSize }
                : undefined
            }}
            onPointerCancel={(event) => {
              pointers.current.delete(event.pointerId)
              gesture.current = undefined
            }}
            style={{
              position: 'absolute',
              left: '50%',
              top: '50%',
              width: imageSize.width,
              height: imageSize.height,
              transform: 'translate(-50%,-50%)',
              touchAction: 'none',
              cursor: 'move',
            }}
          >
            <img
              src={source}
              alt=""
              draggable={false}
              style={{
                display: 'block',
                width: '100%',
                height: '100%',
                userSelect: 'none',
                pointerEvents: 'none',
              }}
            />
            {!!crop.width && (
              <div
                aria-label="Movable image crop area"
                style={{
                  position: 'absolute',
                  left: `${center.x * 100}%`,
                  top: `${center.y * 100}%`,
                  width: crop.width,
                  height: crop.height,
                  boxSizing: 'border-box',
                  borderRadius: shape === 'circle' ? '50%' : 8,
                  border: `3px solid ${token.colorPrimary}`,
                  transform: 'translate(-50%,-50%)',
                  boxShadow: '0 0 0 9999px rgba(0,0,0,.38)',
                  pointerEvents: 'none',
                }}
              />
            )}
          </div>
        )}
      </div>
      <div style={{ maxWidth: 480, margin: '14px auto 0' }}>
        <Slider
          min={MIN_CROP_SIZE}
          max={100}
          step={1}
          value={cropSize}
          onChange={changeSize}
          aria-label="Crop area size"
        />
      </div>
    </Modal>
  )
}
