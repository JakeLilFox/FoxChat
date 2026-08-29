import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { MatrixClient, MatrixEventEvent, type MatrixEvent } from 'matrix-js-sdk'
import { matrixService } from '../matrix/MatrixClientService'
import { getCachedMedia, putCachedMedia, type MediaCacheCategory } from './mediaCache'
import { downloadAndDecryptMedia } from './mediaDecrypt'

const mediaDownloads = new Map<string, Promise<{ blob: Blob; mimetype: string }>>()

export function useMatrixEventStatus(event: MatrixEvent) {
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      event.on(MatrixEventEvent.Status, onStoreChange)
      return () => event.off(MatrixEventEvent.Status, onStoreChange)
    },
    [event],
  )
  const getSnapshot = useCallback(() => event.status, [event])
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

export type MediaCacheHint = {
  category: MediaCacheCategory
  roomId?: string
  timestamp?: number
}

export function useMediaUrl(
  input?: Record<string, any>,
  preferredClient?: MatrixClient,
  cacheHint?: MediaCacheHint,
) {
  const content = input ?? {}
  const encrypted = content.file
  const uri = content.url ?? encrypted?.url ?? content['m.url'] ?? content['m.image']?.url
  const client = preferredClient ?? matrixService.clientForMedia(uri)
  const authenticated = uri
    ? client?.mxcUrlToHttp(uri, undefined, undefined, undefined, false, true, true)
    : undefined
  const legacy = uri ? client?.mxcUrlToHttp(uri) : undefined
  const [url, setUrl] = useState<string>()
  useEffect(() => {
    setUrl(undefined)
    if (!authenticated && !legacy) return
    let objectUrl: string | undefined
    let retryTimer: number | undefined
    let cancelled = false
    const retryDelays = [0, 1000, 3000, 10000, 30000]
    const download = () => {
      const key = `${authenticated ?? ''}|${legacy ?? ''}|${client?.getAccessToken() ?? ''}|${encrypted ? JSON.stringify(encrypted) : ''}`
      const existing = mediaDownloads.get(key)
      if (existing) return existing
      const pending = downloadAndDecryptMedia(
        { url: uri, file: encrypted, info: { mimetype: content.info?.mimetype } },
        client,
      )
      mediaDownloads.set(key, pending)
      void pending.finally(() => mediaDownloads.delete(key)).catch(() => {})
      return pending
    }
    const cacheCategory = cacheHint?.category
    const cacheRoomId = cacheHint?.roomId
    const cacheTimestamp = cacheHint?.timestamp
    const cacheKey = cacheCategory && uri ? `${cacheCategory}:${uri}` : undefined
    const load = async (attempt: number) => {
      try {
        if (cacheKey && attempt === 0) {
          const cached = await getCachedMedia(cacheKey)
          if (cached) {
            if (cancelled) return
            const nextUrl = URL.createObjectURL(cached.blob)
            if (objectUrl) URL.revokeObjectURL(objectUrl)
            objectUrl = nextUrl
            setUrl(nextUrl)
            return
          }
        }
        const { blob, mimetype } = await download()
        const nextUrl = URL.createObjectURL(blob)
        if (cancelled) {
          URL.revokeObjectURL(nextUrl)
          return
        }
        if (objectUrl) URL.revokeObjectURL(objectUrl)
        objectUrl = nextUrl
        setUrl(nextUrl)
        if (cacheKey && cacheCategory)
          void putCachedMedia({
            key: cacheKey,
            category: cacheCategory,
            blob,
            mimetype,
            roomId: cacheRoomId,
            timestamp: cacheTimestamp,
          })
      } catch {
        if (cancelled) return
        const nextAttempt = attempt + 1
        if (nextAttempt < retryDelays.length)
          retryTimer = window.setTimeout(() => void load(nextAttempt), retryDelays[nextAttempt])
        else if (!encrypted) setUrl(legacy ?? undefined)
      }
    }
    void load(0)
    return () => {
      cancelled = true
      if (retryTimer !== undefined) window.clearTimeout(retryTimer)
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [
    client,
    authenticated,
    legacy,
    encrypted,
    content.info?.mimetype,
    uri,
    cacheHint?.category,
    cacheHint?.roomId,
    cacheHint?.timestamp,
  ])
  return url
}

export function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches)
  useEffect(() => {
    const media = window.matchMedia(query)
    let frame: number | undefined
    const changed = () => setMatches(media.matches)
    const schedule = () => {
      if (frame !== undefined) cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        frame = undefined
        changed()
      })
    }
    changed()
    media.addEventListener('change', changed)
    window.visualViewport?.addEventListener('resize', schedule)
    window.addEventListener('resize', schedule)
    window.addEventListener('orientationchange', schedule)
    return () => {
      if (frame !== undefined) cancelAnimationFrame(frame)
      media.removeEventListener('change', changed)
      window.visualViewport?.removeEventListener('resize', schedule)
      window.removeEventListener('resize', schedule)
      window.removeEventListener('orientationchange', schedule)
    }
  }, [query])
  return matches
}
