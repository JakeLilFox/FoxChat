export type UserProfileRequest = {
  userId: string
  name?: string
  avatarUrl?: string
  placement?: 'right' | 'above'
  rect: { left: number; right: number; top: number; bottom: number }
}
export const showUserProfile = (
  userId: string,
  target: HTMLElement,
  name?: string,
  avatarUrl?: string,
  placement: 'right' | 'above' = 'right',
) => {
  const rect = target.getBoundingClientRect()
  window.dispatchEvent(
    new CustomEvent<UserProfileRequest>('foxchat-user-profile', {
      detail: {
        userId,
        name,
        avatarUrl,
        placement,
        rect: {
          left: rect.left,
          right: rect.right,
          top: rect.top,
          bottom: rect.bottom,
        },
      },
    }),
  )
}
export const profileLocalTime = (timezone: unknown, now: Date) => {
  if (typeof timezone !== 'string' || !timezone.trim()) return undefined
  try {
    return {
      timezone,
      label: new Intl.DateTimeFormat(undefined, {
        timeZone: timezone,
        weekday: 'short',
        hour: '2-digit',
        minute: '2-digit',
      }).format(now),
    }
  } catch {
    return undefined
  }
}
