import { MemberAvatar } from '../profile'
import { FollowingBar } from '../../styles'
import { useEffect, useState } from 'react'
import { Tooltip } from 'antd'

export type ChatFollower = { userId: string; name: string; avatarUrl?: string }
export function FollowingChatHost() {
  const [followers, setFollowers] = useState<ChatFollower[]>([])
  const [detailsWidth, setDetailsWidth] = useState(0)
  const [callViewOpen, setCallViewOpen] = useState(false)
  useEffect(() => {
    const update = (event: Event) => setFollowers((event as CustomEvent<ChatFollower[]>).detail)
    window.addEventListener('foxchat-followers', update)
    return () => window.removeEventListener('foxchat-followers', update)
  }, [])
  useEffect(() => {
    const callViewChanged = (event: Event) =>
      setCallViewOpen((event as CustomEvent<boolean>).detail)
    window.addEventListener('foxchat-call-view-changed', callViewChanged)
    return () => window.removeEventListener('foxchat-call-view-changed', callViewChanged)
  }, [])
  useEffect(() => {
    let frame = 0
    const detect = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        if (window.innerWidth <= 1100) {
          setDetailsWidth(0)
          return
        }
        const width =
          [
            ...document.querySelectorAll<HTMLElement>(
              '.ant-drawer-right .ant-drawer-content-wrapper',
            ),
          ]
            .map((panel) => panel.getBoundingClientRect())
            .find(
              (bounds) => bounds.width > 0 && bounds.left < window.innerWidth && bounds.right > 0,
            )?.width ?? 0
        setDetailsWidth(width)
      })
    }
    const observer = new MutationObserver(detect)
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['class', 'style'],
    })
    window.addEventListener('resize', detect)
    detect()
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      window.removeEventListener('resize', detect)
    }
  }, [])
  if (!followers.length || callViewOpen) return null
  return (
    <FollowingBar $detailsWidth={detailsWidth} aria-label="People following this chat">
      <span className="label">Following</span>
      {followers.slice(0, 8).map((follower) => (
        <Tooltip key={follower.userId} title={follower.name}>
          <span className="follower">
            <MemberAvatar
              userId={follower.userId}
              name={follower.name}
              url={follower.avatarUrl}
              size={23}
              showPresenceTooltip={false}
            />
          </span>
        </Tooltip>
      ))}
    </FollowingBar>
  )
}
