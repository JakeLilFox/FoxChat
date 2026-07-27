import { useEffect, useState } from 'react'
import { MatrixClient } from 'matrix-js-sdk'
import { Attachment, EncryptedAttachment } from '@matrix-org/matrix-sdk-crypto-wasm'
import { matrixService } from '../matrix/MatrixClientService'

type MediaDownload = { bytes: ArrayBuffer; mime?: string | null }
const mediaDownloads = new Map<string, Promise<MediaDownload>>()

export function useMediaUrl(input?: Record<string, any>, preferredClient?: MatrixClient) {
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
    const request = async () => {
      if (authenticated) {
        try {
          const response = await fetch(authenticated, {
            headers: client?.getAccessToken()
              ? { Authorization: `Bearer ${client.getAccessToken()}` }
              : {},
          })
          if (response.ok) return response
        } catch {
          /* try the legacy endpoint */
        }
      }
      if (legacy) {
        try {
          const response = await fetch(legacy)
          if (response.ok) return response
        } catch {
          /* retry below */
        }
      }
      throw new Error('Media download failed')
    }
    const download = () => {
      const key = `${authenticated ?? ''}|${legacy ?? ''}|${client?.getAccessToken() ?? ''}|${encrypted ? JSON.stringify(encrypted) : ''}`
      const existing = mediaDownloads.get(key)
      if (existing) return existing
      const pending = (async (): Promise<MediaDownload> => {
        const response = await request()
        const data = await response.arrayBuffer()
        let bytes: ArrayBuffer = data
        if (encrypted?.url) {
          const attachment = new EncryptedAttachment(
            new Uint8Array(data),
            JSON.stringify(encrypted),
          )
          const clear = Attachment.decrypt(attachment)
          attachment.free()
          bytes = clear.buffer.slice(
            clear.byteOffset,
            clear.byteOffset + clear.byteLength,
          ) as ArrayBuffer
        }
        return { bytes, mime: response.headers.get('content-type') }
      })()
      mediaDownloads.set(key, pending)
      void pending.finally(() => mediaDownloads.delete(key)).catch(() => {})
      return pending
    }
    const load = async (attempt: number) => {
      try {
        const { bytes, mime } = await download()
        const nextUrl = URL.createObjectURL(
          new Blob([bytes], {
            type: content.info?.mimetype ?? mime ?? 'application/octet-stream',
          }),
        )
        if (cancelled) {
          URL.revokeObjectURL(nextUrl)
          return
        }
        if (objectUrl) URL.revokeObjectURL(objectUrl)
        objectUrl = nextUrl
        setUrl(nextUrl)
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
  }, [client, authenticated, legacy, encrypted, content.info?.mimetype])
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
