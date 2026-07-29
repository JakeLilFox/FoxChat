import { useEffect, useState } from 'react'
import { Spin } from 'antd'
import { MatrixClient } from 'matrix-js-sdk'
import { matrixService } from '../../matrix/MatrixClientService'
import { getCachedMedia, putCachedMedia } from '../../lib/mediaCache'

export function ReactionImage({
  reactionKey,
  label,
  client,
}: {
  reactionKey: string
  label?: string
  client?: MatrixClient
}) {
  const [url, setUrl] = useState<string>()
  useEffect(() => {
    let cancelled = false
    let objectUrl: string | undefined
    setUrl(undefined)
    const clients = [
      client,
      ...matrixService.availableAccounts().map((account) => account.client),
      matrixService.clientForMedia(reactionKey),
    ].filter(
      (value, index, list): value is MatrixClient => !!value && list.indexOf(value) === index,
    )
    const candidates = clients.flatMap((mediaClient) => [
      {
        url: mediaClient.mxcUrlToHttp(
          reactionKey,
          undefined,
          undefined,
          undefined,
          false,
          true,
          true,
        ),
        token: mediaClient.getAccessToken(),
      },
      { url: mediaClient.mxcUrlToHttp(reactionKey), token: undefined },
    ])
    const match = /^mxc:\/\/([^/]+)\/(.+)$/.exec(reactionKey)
    if (match)
      candidates.push({
        url: `https://${match[1]}/_matrix/media/v3/download/${encodeURIComponent(match[1])}/${encodeURIComponent(match[2])}`,
        token: undefined,
      })
    const cacheKey = `other-stickers:${reactionKey}`
    void (async () => {
      const cached = await getCachedMedia(cacheKey)
      if (cached) {
        if (cancelled) return
        objectUrl = URL.createObjectURL(cached.blob)
        setUrl(objectUrl)
        return
      }
      for (const candidate of candidates) {
        if (!candidate.url) continue
        try {
          const response = await fetch(candidate.url, {
            headers: candidate.token ? { Authorization: `Bearer ${candidate.token}` } : undefined,
          })
          if (!response.ok) continue
          const blob = await response.blob()
          objectUrl = URL.createObjectURL(blob)
          if (cancelled) URL.revokeObjectURL(objectUrl)
          else setUrl(objectUrl)
          void putCachedMedia({
            key: cacheKey,
            category: 'other-stickers',
            blob,
            mimetype: blob.type || 'application/octet-stream',
          })
          return
        } catch {
          /* try the next media repository */
        }
      }
    })()
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [reactionKey, client])
  return url ? (
    <img
      className="reactionImage"
      src={url}
      alt=""
      aria-label={label || 'Custom emoji'}
      title={label}
      style={{
        display: 'block',
        width: 18,
        height: 18,
        objectFit: 'contain',
        flex: 'none',
      }}
    />
  ) : (
    <Spin size="small" />
  )
}
