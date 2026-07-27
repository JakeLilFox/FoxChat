import { useMediaUrl } from '../../lib/hooks'
import { LinkPreviewCard } from '../../styles'
import { useEffect, useState } from 'react'
import { MatrixClient } from 'matrix-js-sdk'
import { showImageViewer } from '../../lib/media'

const PREVIEW_CACHE_KEY = 'foxchat.linkPreviewMetadata.v1'
const PREVIEW_CACHE_LIMIT = 250
const previewCache = new Map<string, Record<string, unknown>>()
const PREVIEW_CACHE_FIELDS = new Set([
  'og:title',
  'og:site_name',
  'og:description',
  'og:url',
  'og:image',
  'og:image:width',
  'og:image:height',
  'twitter:image',
  'og:video',
  'og:video:url',
  'og:video:secure_url',
  'og:video:type',
  'og:video:width',
  'og:video:height',
])

try {
  const stored = JSON.parse(localStorage.getItem(PREVIEW_CACHE_KEY) ?? '[]') as Array<
    [string, Record<string, unknown>]
  >
  for (const [url, data] of stored.slice(-PREVIEW_CACHE_LIMIT)) previewCache.set(url, data)
} catch {
  // A malformed or unavailable cache should not prevent messages rendering.
}

const cachedPreview = (url: string) => previewCache.get(url) ?? {}
const cachePreview = (url: string, data: Record<string, unknown>) => {
  const compact = Object.fromEntries(
    Object.entries(data).filter(
      ([key, value]) =>
        PREVIEW_CACHE_FIELDS.has(key) && (typeof value === 'string' || typeof value === 'number'),
    ),
  )
  previewCache.delete(url)
  previewCache.set(url, compact)
  while (previewCache.size > PREVIEW_CACHE_LIMIT)
    previewCache.delete(previewCache.keys().next().value!)
  try {
    localStorage.setItem(PREVIEW_CACHE_KEY, JSON.stringify([...previewCache]))
  } catch {}
}

export function LinkPreview({
  url,
  client,
  timestamp,
  compact,
}: {
  url: string
  client?: MatrixClient
  timestamp: number
  compact?: boolean
}) {
  const [data, setData] = useState<Record<string, unknown>>(() => cachedPreview(url))
  useEffect(() => {
    let cancelled = false
    const cached = cachedPreview(url)
    setData(cached)
    if (!client) return
    void (async () => {
      const paths = [
        '/_matrix/media/r0/preview_url',
        '/_matrix/media/v3/preview_url',
        '/_matrix/client/v1/media/preview_url',
      ]
      for (const path of paths) {
        try {
          const endpoint = new URL(path, client.getHomeserverUrl())
          endpoint.searchParams.set('url', url)
          endpoint.searchParams.set('ts', String(timestamp))
          let response = await fetch(endpoint, {
            headers: client.getAccessToken()
              ? { Authorization: `Bearer ${client.getAccessToken()}` }
              : {},
          })
          if (!response.ok && path.startsWith('/_matrix/media/') && client.getAccessToken()) {
            endpoint.searchParams.set('access_token', client.getAccessToken()!)
            response = await fetch(endpoint)
          }
          if (!response.ok) continue
          const value = (await response.json()) as Record<string, unknown>
          cachePreview(url, value)
          if (!cancelled) setData(value)
          return
        } catch {
          /* Try the next endpoint. */
        }
      }
      try {
        const value = (await client.getUrlPreview(url, timestamp)) as Record<string, unknown>
        cachePreview(url, value)
        if (!cancelled) setData(value)
      } catch {
        /* A preview is optional. */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [url, client, timestamp])
  const image =
    typeof data?.['og:image'] === 'string'
      ? data['og:image']
      : typeof data?.['twitter:image'] === 'string'
        ? data['twitter:image']
        : undefined
  const downloadedImage = useMediaUrl({ url: image }, client)
  const imageUrl = image && /^https?:\/\//i.test(image) ? image : downloadedImage
  const imageWidth = Number(data?.['og:image:width']) || undefined
  const imageHeight = Number(data?.['og:image:height']) || undefined
  const video =
    typeof data?.['og:video:secure_url'] === 'string'
      ? data['og:video:secure_url']
      : typeof data?.['og:video:url'] === 'string'
        ? data['og:video:url']
        : typeof data?.['og:video'] === 'string'
          ? data['og:video']
          : undefined
  const videoType = typeof data?.['og:video:type'] === 'string' ? data['og:video:type'] : undefined
  const isPlayableVideo =
    !!video &&
    (videoType ? videoType.startsWith('video/') : /\.(mp4|webm|ogg|ogv|mov|m4v)(\?|$)/i.test(video))
  const downloadedVideo = useMediaUrl({ url: video }, client)
  const videoUrl =
    isPlayableVideo && video ? (/^https?:\/\//i.test(video) ? video : downloadedVideo) : undefined
  const videoWidth = Number(data?.['og:video:width']) || undefined
  const videoHeight = Number(data?.['og:video:height']) || undefined
  if (!data) return null
  let site = ''
  try {
    site = new URL(url).hostname
  } catch {
    site = url
  }
  const title = String(data['og:title'] || data['og:site_name'] || site).trim()
  const description = String(data['og:description'] || data['og:url'] || url).trim()
  return (
    <LinkPreviewCard
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(event) => event.stopPropagation()}
      $withImage={!compact && !!(image || video)}
    >
      <span className="previewText">
        <span className="previewSite">{String(data['og:site_name'] || site)}</span>
        <span className="previewTitle">{title}</span>
        {description && description !== title && (
          <span className="previewDescription">{description}</span>
        )}
      </span>
      {!compact && videoUrl ? (
        <video
          className="previewVideo"
          src={videoUrl}
          poster={imageUrl}
          controls
          preload="metadata"
          style={
            videoWidth && videoHeight ? { aspectRatio: `${videoWidth}/${videoHeight}` } : undefined
          }
          onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
          }}
        />
      ) : imageUrl ? (
        <img
          className="previewImage"
          src={imageUrl}
          alt=""
          loading="lazy"
          width={imageWidth}
          height={imageHeight}
          onLoad={(event) => {
            const next = {
              ...data,
              'og:image:width': event.currentTarget.naturalWidth,
              'og:image:height': event.currentTarget.naturalHeight,
            }
            cachePreview(url, next)
          }}
          onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            showImageViewer(imageUrl, title)
          }}
        />
      ) : !compact && (image || video) ? (
        <span className="previewMediaPlaceholder" aria-hidden="true" />
      ) : null}
    </LinkPreviewCard>
  )
}
