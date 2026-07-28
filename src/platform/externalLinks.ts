import { isDesktopApp } from './desktopUpdates'

const EXTERNAL_PROTOCOLS = new Set(['http:', 'https:', 'mailto:', 'tel:'])

export function isExternalUrl(value: string) {
  if (!/^[a-z][a-z\d+.-]*:/i.test(value.trim())) return false
  try {
    return EXTERNAL_PROTOCOLS.has(new URL(value, window.location.href).protocol)
  } catch {
    return false
  }
}

export async function openExternalUrl(value: string) {
  if (!isExternalUrl(value)) throw new Error('FoxChat refused to open an unsafe external URL.')

  if (isDesktopApp()) {
    const { openUrl } = await import('@tauri-apps/plugin-opener')
    await openUrl(value)
    return
  }

  window.open(value, '_blank', 'noopener,noreferrer')
}

export function listenForDesktopExternalLinks(target: Document = document) {
  if (!isDesktopApp()) return () => undefined

  const openLink = (event: MouseEvent) => {
    if (event.defaultPrevented || event.button !== 0) return
    const element = event.target instanceof Element ? event.target : undefined
    const anchor = element?.closest<HTMLAnchorElement>('a[href]')
    if (!anchor || anchor.hasAttribute('download') || !isExternalUrl(anchor.href)) return

    event.preventDefault()
    void openExternalUrl(anchor.href).catch((error) => {
      console.error('FoxChat could not open the external link', error)
    })
  }

  target.addEventListener('click', openLink)
  return () => target.removeEventListener('click', openLink)
}
