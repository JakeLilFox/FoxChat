export type DmPresenceSnapshot = {
  available?: boolean
  presence?: string
  currentlyActive?: boolean
  lastActiveAt?: number
}

const elapsedLabel = (value: number, unit: string) =>
  `${value} ${unit}${value === 1 ? '' : 's'} ago`

export function dmPresenceLabel(snapshot: DmPresenceSnapshot | undefined, now = Date.now()) {
  if (!snapshot) return 'Checking presence…'
  if (snapshot.available === false) return 'Presence unavailable'
  if (snapshot.currentlyActive || snapshot.presence === 'online') return 'Online'

  if (snapshot.lastActiveAt && Number.isFinite(snapshot.lastActiveAt)) {
    const elapsedMs = Math.max(0, now - snapshot.lastActiveAt)
    const minutes = Math.floor(elapsedMs / 60_000)
    if (minutes < 1) return 'Last seen just now'
    if (minutes < 60) return `Last seen ${elapsedLabel(minutes, 'minute')}`
    const hours = Math.floor(minutes / 60)
    if (hours < 24) return `Last seen ${elapsedLabel(hours, 'hour')}`
    const days = Math.floor(hours / 24)
    if (days < 30) return `Last seen ${elapsedLabel(days, 'day')}`
    const months = Math.floor(days / 30)
    if (months < 12) return `Last seen ${elapsedLabel(months, 'month')}`
    return `Last seen ${elapsedLabel(Math.floor(days / 365), 'year')}`
  }

  if (snapshot.presence === 'unavailable') return 'Away'
  if (snapshot.presence === 'offline') return 'Offline'
  return 'Presence unavailable'
}
