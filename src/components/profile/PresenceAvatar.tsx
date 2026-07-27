import { PresenceDot, PresenceWrap } from '../../styles'
import { Tooltip } from 'antd'
import { matrixService } from '../../matrix/MatrixClientService'
import { useEffect, useState } from 'react'
import { UserEvent } from 'matrix-js-sdk'

export function PresenceAvatar({
  userId,
  children,
  showTooltip = true,
}: {
  userId?: string
  children: React.ReactNode
  showTooltip?: boolean
}) {
  const [, render] = useState(0)
  const accountKey = matrixService
    .availableAccounts()
    .map((account) => account.id)
    .join('\u0000')
  useEffect(() => {
    if (!userId) return
    const users = [
      ...new Set(
        matrixService
          .availableAccounts()
          .map((account) => account.client.getUser(userId))
          .filter((user) => !!user),
      ),
    ]
    const refresh = () => render((value) => value + 1)
    for (const user of users) user.on(UserEvent.Presence, refresh)
    window.addEventListener('foxchat-presence-mode-changed', refresh)
    window.addEventListener('foxchat-presence-state-changed', refresh)
    return () => {
      for (const user of users) user.off(UserEvent.Presence, refresh)
      window.removeEventListener('foxchat-presence-mode-changed', refresh)
      window.removeEventListener('foxchat-presence-state-changed', refresh)
    }
  }, [userId, accountKey])
  const presence = matrixService.userPresence(userId)
  const state =
    presence === 'online'
      ? { color: '#35c978', label: 'Online' }
      : presence === 'unavailable'
        ? { color: '#e8b84a', label: 'Away' }
        : { color: '#9299aa', label: 'Offline' }
  if (!userId) return children
  const avatar = (
    <PresenceWrap>
      {children}
      <PresenceDot $color={state.color} />
    </PresenceWrap>
  )
  return showTooltip ? <Tooltip title={state.label}>{avatar}</Tooltip> : avatar
}
