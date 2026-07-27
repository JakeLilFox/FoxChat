export type RolePermissionField = {
  key: string
  aliasKeys?: string[]
  label: string
  description: string
  fallback: (power: Record<string, unknown>) => number
}

const splitPath = (key: string): [string, string] | undefined => {
  const dot = key.indexOf('.')
  if (dot === -1) return undefined
  const prefix = key.slice(0, dot)
  if (prefix !== 'events' && prefix !== 'notifications') return undefined
  return [prefix, key.slice(dot + 1)]
}

export const readPermissionLevel = (
  power: Record<string, unknown>,
  key: string,
): number | undefined => {
  const path = splitPath(key)
  if (!path) {
    const value = power[key]
    return typeof value === 'number' ? value : undefined
  }
  const [prefix, type] = path
  const bucket = power[prefix] as Record<string, unknown> | undefined
  const value = bucket?.[type]
  return typeof value === 'number' ? value : undefined
}

export const applyPermissionLevels = (
  current: Record<string, unknown>,
  permissionLevels: Record<string, number>,
): Record<string, unknown> => {
  const next: Record<string, unknown> = { ...current }
  let events: Record<string, unknown> | undefined
  let notifications: Record<string, unknown> | undefined
  for (const [key, value] of Object.entries(permissionLevels)) {
    const path = splitPath(key)
    if (!path) {
      next[key] = value
      continue
    }
    const [prefix, type] = path
    if (prefix === 'events') {
      events ??= { ...((current.events as Record<string, unknown>) ?? {}) }
      events[type] = value
    } else {
      notifications ??= {
        ...((current.notifications as Record<string, unknown>) ?? {}),
      }
      notifications[type] = value
    }
  }
  if (events) next.events = events
  if (notifications) next.notifications = notifications
  return next
}

export const expandPermissionLevels = (
  fields: readonly RolePermissionField[],
  permissions: Record<string, number>,
): Record<string, number> => {
  const expanded = { ...permissions }
  for (const field of fields) {
    const value = permissions[field.key]
    if (value === undefined) continue
    for (const alias of field.aliasKeys ?? []) expanded[alias] = value
  }
  return expanded
}
