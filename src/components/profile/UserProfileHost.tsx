import { UserProfileCard } from './UserProfileCard'
import { type UserProfileRequest } from '../../lib/userProfile'
import { clearUserProfileUrl, openUserProfileUrl, userProfileIdFromUrl } from '../../lib/urlState'
import { UserProfilePanel } from '../../styles'
import { useEffect, useRef, useState } from 'react'

const requestFromUrl = (): UserProfileRequest | undefined => {
  const userId = userProfileIdFromUrl()
  if (!userId) return undefined
  const stored = history.state?.foxchatUserProfile as UserProfileRequest | undefined
  if (stored?.userId === userId && stored.rect) return stored
  const centerX = window.innerWidth / 2
  const centerY = window.innerHeight / 2
  return {
    userId,
    rect: {
      left: centerX - 1,
      right: centerX,
      top: centerY,
      bottom: centerY + 1,
    },
  }
}

export function UserProfileHost() {
  const [request, setRequest] = useState<UserProfileRequest | undefined>(requestFromUrl)
  const requestRef = useRef<UserProfileRequest | undefined>(request)
  const panelRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const apply = (next: UserProfileRequest | undefined) => {
      requestRef.current = next
      setRequest(next)
    }
    const dismiss = (updateUrl = true) => {
      apply(undefined)
      if (updateUrl) clearUserProfileUrl()
    }
    const open = (event: Event) => {
      const next = (event as CustomEvent<UserProfileRequest>).detail
      const current = requestRef.current
      if (
        current?.userId === next.userId &&
        current.placement === next.placement &&
        current.rect.left === next.rect.left &&
        current.rect.top === next.rect.top
      ) {
        dismiss()
        return
      }
      apply(next)
      openUserProfileUrl(next.userId, next)
    }
    const navigate = () => apply(requestFromUrl())
    const dismissEvent = () => dismiss()
    const close = (event: MouseEvent) => {
      if (!panelRef.current?.contains(event.target as Node)) dismiss()
    }
    window.addEventListener('foxchat-user-profile', open)
    window.addEventListener('foxchat-close-user-profile', dismissEvent)
    window.addEventListener('popstate', navigate)
    // Close the profile before its target performs navigation.
    document.addEventListener('click', close, true)
    return () => {
      window.removeEventListener('foxchat-user-profile', open)
      window.removeEventListener('foxchat-close-user-profile', dismissEvent)
      window.removeEventListener('popstate', navigate)
      document.removeEventListener('click', close, true)
    }
  }, [])
  if (!request) return null
  if (request.placement === 'above') {
    const left = Math.max(12, Math.min(request.rect.left, window.innerWidth - 352))
    return (
      <UserProfilePanel
        ref={panelRef}
        style={{
          left,
          bottom: Math.max(12, window.innerHeight - request.rect.top + 8),
        }}
      >
        <UserProfileCard request={request} />
      </UserProfilePanel>
    )
  }
  const left = Math.min(request.rect.right + 8, window.innerWidth - 352)
  const top = Math.max(12, Math.min(request.rect.top, window.innerHeight - 612))
  return (
    <UserProfilePanel ref={panelRef} style={{ left: Math.max(12, left), top }}>
      <UserProfileCard request={request} />
    </UserProfilePanel>
  )
}
