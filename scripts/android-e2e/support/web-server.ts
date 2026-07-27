import { preview, type PreviewServer } from 'vite'

export type BrowserWebServer = {
  stop: () => Promise<void>
}

export async function startBrowserWebServer(
  baseUrl: string,
  skip: boolean,
): Promise<BrowserWebServer | undefined> {
  if (skip) return undefined

  const url = new URL(baseUrl)
  if (url.protocol !== 'http:')
    throw new Error(
      `The local Android e2e preview server requires an http E2E_BASE_URL, got ${baseUrl}`,
    )
  if (url.pathname !== '/' || url.search || url.hash)
    throw new Error(
      `The local Android e2e preview server requires an origin-only E2E_BASE_URL, got ${baseUrl}`,
    )

  try {
    const existing = await fetch(url, {
      signal: AbortSignal.timeout(3_000),
    })
    const html = existing.ok ? await existing.text() : ''
    if (existing.ok && /<title>\s*FoxChat\s*<\/title>/i.test(html)) return undefined
    if (existing.ok) throw new Error(`${baseUrl} is already serving a different application`)
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === `${baseUrl} is already serving a different application`
    )
      throw error
  }

  const server: PreviewServer = await preview({
    logLevel: 'warn',
    preview: {
      host: url.hostname,
      port: Number(url.port || 80),
      strictPort: true,
    },
  })
  return {
    stop: () =>
      new Promise<void>((resolve, reject) => {
        server.httpServer.close((error) => {
          if (error) reject(error)
          else resolve()
        })
      }),
  }
}
