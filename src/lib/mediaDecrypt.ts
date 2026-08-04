import { MatrixClient } from 'matrix-js-sdk'
import { Attachment, EncryptedAttachment } from '@matrix-org/matrix-sdk-crypto-wasm'

// Pure module (no matrixService import) so both the React media hook and the matrix service's
// non-React send flows (e.g. re-sending a saved GIF) can share this without a circular import.
export async function downloadAndDecryptMedia(
  content: Record<string, any>,
  client: MatrixClient | undefined,
): Promise<{ blob: Blob; mimetype: string }> {
  const encrypted = content.file
  const uri = content.url ?? encrypted?.url ?? content['m.url'] ?? content['m.image']?.url
  if (!uri) throw new Error('Media is not available')
  const authenticated = client?.mxcUrlToHttp(
    uri,
    undefined,
    undefined,
    undefined,
    false,
    true,
    true,
  )
  const legacy = client?.mxcUrlToHttp(uri)
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
      const response = await fetch(legacy)
      if (response.ok) return response
    }
    throw new Error('Media download failed')
  }
  const response = await request()
  const data = await response.arrayBuffer()
  let bytes: ArrayBuffer = data
  if (encrypted?.url) {
    const attachment = new EncryptedAttachment(new Uint8Array(data), JSON.stringify(encrypted))
    const clear = Attachment.decrypt(attachment)
    attachment.free()
    bytes = clear.buffer.slice(clear.byteOffset, clear.byteOffset + clear.byteLength) as ArrayBuffer
  }
  const mimetype =
    content.info?.mimetype ?? response.headers.get('content-type') ?? 'application/octet-stream'
  return { blob: new Blob([bytes], { type: mimetype }), mimetype }
}
