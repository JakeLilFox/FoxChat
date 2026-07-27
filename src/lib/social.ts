export type SocialLink = { img?: string; link: string; title: string }
export const socialLinksFrom = (value: unknown): SocialLink[] =>
  Array.isArray(value)
    ? value.flatMap((item) => {
        if (!item || typeof item !== 'object') return []
        const link = typeof item.link === 'string' ? item.link.trim() : ''
        const title = typeof item.title === 'string' ? item.title.trim() : ''
        const img = typeof item.img === 'string' && item.img.trim() ? item.img.trim() : undefined
        let safe = false
        try {
          safe = ['http:', 'https:'].includes(new URL(link).protocol)
        } catch {
          /* invalid URL */
        }
        return safe && title ? [{ link, title, img }] : []
      })
    : []
export const socialKind = (link: string) => {
  try {
    const host = new URL(link).hostname.toLowerCase()
    if (
      host === 'twitter.com' ||
      host.endsWith('.twitter.com') ||
      host === 'x.com' ||
      host.endsWith('.x.com')
    )
      return 'twitter'
    if (host === 'bsky.app' || host.endsWith('.bsky.app')) return 'bsky'
    if (host === 'discord.com' || host.endsWith('.discord.com') || host === 'discord.gg')
      return 'discord'
    if (
      host.includes('mastodon') ||
      host === 'mstdn.social' ||
      host === 'fosstodon.org' ||
      host === 'hachyderm.io'
    )
      return 'mastodon'
  } catch {
    /* generic link */
  }
  return 'other'
}
