import { useMediaUrl } from '../../lib/hooks'

export function InlineMatrixEmote({
  src,
  alt,
  title,
}: {
  src: string
  alt: string
  title?: string
}) {
  const url = useMediaUrl({ url: src }, undefined, { category: 'other-stickers' })
  return url ? (
    <img
      className="matrix-inline-emote"
      data-mx-emoticon
      src={url}
      alt={alt}
      title={title || alt}
      style={{
        display: 'inline-block',
        width: '2em',
        height: '2em',
        minWidth: 0,
        minHeight: 0,
        maxWidth: '2em',
        maxHeight: '2em',
        objectFit: 'contain',
        objectPosition: 'center',
        verticalAlign: '-.15em',
        margin: '0 .08em',
      }}
    />
  ) : (
    <>{alt}</>
  )
}
