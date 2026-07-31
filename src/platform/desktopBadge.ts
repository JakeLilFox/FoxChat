const WINDOWS_USER_AGENT = /Windows/i
const BADGE_SIZE = 32

let lastUnreadCount: number | undefined

function badgePixels(label: string) {
  const canvas = document.createElement('canvas')
  canvas.width = BADGE_SIZE
  canvas.height = BADGE_SIZE
  const context = canvas.getContext('2d')
  if (!context) return undefined

  context.clearRect(0, 0, BADGE_SIZE, BADGE_SIZE)
  context.beginPath()
  context.arc(BADGE_SIZE / 2, BADGE_SIZE / 2, BADGE_SIZE / 2 - 1, 0, Math.PI * 2)
  context.fillStyle = '#e5484d'
  context.fill()
  context.lineWidth = 2
  context.strokeStyle = '#ffffff'
  context.stroke()
  context.fillStyle = '#ffffff'
  context.font = `700 ${label.length > 2 ? 13 : 17}px sans-serif`
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  context.fillText(label, BADGE_SIZE / 2, BADGE_SIZE / 2 + 1)
  return context.getImageData(0, 0, BADGE_SIZE, BADGE_SIZE).data
}

export async function updateDesktopUnreadBadge(unreadCount: number) {
  if (!window.__TAURI__) return
  const count = Math.max(0, Math.floor(unreadCount))
  if (count === lastUnreadCount) return

  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window')
    const currentWindow = getCurrentWindow()
    if (!WINDOWS_USER_AGENT.test(navigator.userAgent)) {
      await currentWindow.setBadgeCount(count || undefined)
      lastUnreadCount = count
      return
    }

    if (!count) {
      await currentWindow.setOverlayIcon(undefined)
      lastUnreadCount = count
      return
    }

    const pixels = badgePixels(count > 99 ? '99+' : String(count))
    if (!pixels) return
    const { Image } = await import('@tauri-apps/api/image')
    const image = await Image.new(Uint8Array.from(pixels), BADGE_SIZE, BADGE_SIZE)
    try {
      await currentWindow.setOverlayIcon(image)
      lastUnreadCount = count
    } finally {
      await image.close()
    }
  } catch (error) {
    console.warn('[desktop] Could not update the unread taskbar badge', error)
  }
}

export function resetDesktopUnreadBadgeForTests() {
  lastUnreadCount = undefined
}
