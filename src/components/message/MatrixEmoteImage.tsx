import { type MatrixEmote } from '../../lib/emojiData'
import { useMediaUrl } from '../../lib/hooks'
import { type CSSProperties, useEffect, useRef, useState } from 'react'
import { Spin } from 'antd'

export function MatrixEmoteImage({
  emote,
  lazy = false,
  style,
}: {
  emote: MatrixEmote
  lazy?: boolean
  style?: CSSProperties
}) {
  const placeholderRef = useRef<HTMLSpanElement>(null)
  const [visible, setVisible] = useState(!lazy || typeof IntersectionObserver === 'undefined')
  const shouldLoad = !lazy || visible
  useEffect(() => {
    if (shouldLoad) return
    const placeholder = placeholderRef.current
    if (!placeholder) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return
        setVisible(true)
        observer.disconnect()
      },
      { rootMargin: '160px' },
    )
    observer.observe(placeholder)
    return () => observer.disconnect()
  }, [shouldLoad])
  const url = useMediaUrl(
    shouldLoad ? { url: emote.url, info: emote.info } : undefined,
    emote.client,
    {
      category: emote.mine ? 'my-stickers' : 'other-stickers',
    },
  )
  return url ? (
    <img src={url} alt={emote.body} style={style} />
  ) : (
    <span ref={placeholderRef}>
      <Spin size="small" />
    </span>
  )
}
