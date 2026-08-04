import { readRecent, rememberRecent } from './emojiData'

const GATEWAY_URL = 'https://gifs.jakefox.de'.replace(/\/$/, '')
const CUSTOMER_ID_KEY = 'foxchat.gif.customerId'

export type GifFileVariant = { url: string; width: number; height: number; size: number }
export type GifFileFormat = 'gif' | 'webp' | 'jpg' | 'mp4' | 'webm'
export type GifFileSize = 'hd' | 'md' | 'sm' | 'xs'
export type KlipyGif = {
  id: number
  slug: string
  title: string
  tags: string[]
  type: string
  file: Record<GifFileSize, Partial<Record<GifFileFormat, GifFileVariant>>>
}
export type KlipyGifPage = {
  items: KlipyGif[]
  page: number
  hasNext: boolean
}
export type KlipyCategory = { category: string; query: string; previewUrl: string }

// Never derived from the Matrix user ID or any other account data — purely a random,
// locally generated identifier so Klipy sees no personal information about the user.
export function gifCustomerId(): string {
  let value = localStorage.getItem(CUSTOMER_ID_KEY)
  if (!value) {
    value = crypto.randomUUID()
    localStorage.setItem(CUSTOMER_ID_KEY, value)
  }
  return value
}

export function pickGifFile(
  gif: KlipyGif,
  size: GifFileSize,
  format: GifFileFormat,
): GifFileVariant | undefined {
  return gif.file[size]?.[format]
}

async function gatewayFetch<T>(path: string, params: Record<string, string | undefined>) {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) if (value) search.set(key, value)
  const response = await fetch(`${GATEWAY_URL}${path}?${search}`)
  if (!response.ok) throw new Error(`Gif search is unavailable (${response.status})`)
  const payload = await response.json()
  if (!payload?.result) throw new Error('Gif search is unavailable')
  return payload.data as T
}

const toGifPage = (data: {
  data: KlipyGif[]
  current_page: number
  has_next: boolean
}): KlipyGifPage => ({
  items: data.data ?? [],
  page: data.current_page ?? 1,
  hasNext: !!data.has_next,
})

export async function trendingGifs(page = 1): Promise<KlipyGifPage> {
  return toGifPage(
    await gatewayFetch('/gifs/trending', { page: String(page), customer_id: gifCustomerId() }),
  )
}

export async function searchGifs(query: string, page = 1): Promise<KlipyGifPage> {
  return toGifPage(
    await gatewayFetch('/gifs/search', {
      q: query,
      page: String(page),
      customer_id: gifCustomerId(),
    }),
  )
}

export async function gifCategories(): Promise<KlipyCategory[]> {
  const data = await gatewayFetch<{
    categories: Array<{ category: string; query: string; preview_url: string }>
  }>('/gifs/categories', {})
  return data.categories.map((category) => ({
    category: category.category,
    query: category.query,
    previewUrl: category.preview_url,
  }))
}

export async function gifItemsBySlug(slugs: string[]): Promise<KlipyGif[]> {
  if (!slugs.length) return []
  const data = await gatewayFetch<{ data: KlipyGif[] }>('/gifs/items', { slugs: slugs.join(',') })
  return data.data ?? []
}

export function triggerGifShare(slug: string, query: string) {
  void fetch(`${GATEWAY_URL}/gifs/share/${encodeURIComponent(slug)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ customer_id: gifCustomerId(), q: query }),
  }).catch(() => {
    // Analytics-only; a failure here must not affect sending the GIF.
  })
}

export const recentGifsStorage = 'foxchat-recent-gifs'
export const readRecentGifs = () => readRecent<KlipyGif>(recentGifsStorage)
export const rememberRecentGif = (gif: KlipyGif) =>
  rememberRecent(recentGifsStorage, gif, (item) => item.slug)
