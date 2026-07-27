import { MemberAvatar } from './MemberAvatar'
import { SocialLinkIcon } from './SocialLinkIcon'
import { useMediaUrl } from '../../lib/hooks'
import { showImageViewer } from '../../lib/media'
import { socialLinksFrom } from '../../lib/social'
import { containingSpacePath } from '../../lib/spaceHelpers'
import { type UserProfileRequest, profileLocalTime } from '../../lib/userProfile'
import { IconBtn } from '../../styles'
import { useEffect, useState } from 'react'
import { App as AntApp, Tooltip } from 'antd'
import { MessageOutlined } from '@ant-design/icons'
import { RoomType } from 'matrix-js-sdk'
import { matrixService } from '../../matrix/MatrixClientService'

export function UserProfileCard({ request }: { request: UserProfileRequest }) {
  const { message } = AntApp.useApp()
  const client = matrixService.matrixClient
  const [profile, setProfile] = useState<Record<string, unknown>>()
  const [now, setNow] = useState(() => new Date())
  const [dmBusy, setDmBusy] = useState(false)
  const isSelf = matrixService
    .availableAccounts()
    .some((account) => account.userId === request.userId)
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30000)
    return () => window.clearInterval(timer)
  }, [])
  useEffect(() => {
    let active = true
    void client
      ?.getProfileInfo(request.userId)
      .then((value) => {
        if (active) setProfile(value as Record<string, unknown>)
      })
      .catch(() => undefined)
    return () => {
      active = false
    }
  }, [client, request.userId])
  const user = client?.getUser(request.userId)
  const status = user?.presenceStatusMsg?.trim()
  const pronouns =
    typeof profile?.['foxchat.pronouns'] === 'string' ? profile['foxchat.pronouns'].trim() : ''
  const name = String(profile?.displayname || request.name || user?.displayName || request.userId)
  const avatarUrl =
    String(profile?.avatar_url || request.avatarUrl || user?.avatarUrl || '') || undefined
  const banner =
    typeof profile?.['chat.commet.profile_banner'] === 'string'
      ? profile['chat.commet.profile_banner']
      : undefined
  const bannerUrl = useMediaUrl({ url: banner })
  const resolvedAvatarUrl = useMediaUrl({ url: avatarUrl })
  const bioValue = profile?.['chat.commet.profile_bio']
  const bio =
    typeof bioValue === 'string'
      ? bioValue
      : typeof bioValue === 'object' && bioValue && 'body' in bioValue
        ? String((bioValue as { body?: unknown }).body ?? '')
        : ''
  const localTime = profileLocalTime(profile?.['m.tz'], now)
  const socialLinks = socialLinksFrom(profile?.['foxchat.social_links'])
  const joined =
    client?.getRooms().filter((room) => room.getMember(request.userId)?.membership === 'join') ?? []
  const mutualSpaces = new Map<string, string>()
  const mutualChannels: { id: string; label: string }[] = []
  for (const room of joined) {
    if (room.getType() === RoomType.Space) {
      mutualSpaces.set(room.roomId, room.name)
      continue
    }
    const path = containingSpacePath(room.roomId, client)
    if (path.length) {
      const root = client?.getRoom(path[0])
      if (root) mutualSpaces.set(root.roomId, root.name)
    } else mutualChannels.push({ id: room.roomId, label: room.name })
  }
  const openMutual = (id: string) => {
    window.dispatchEvent(new Event('foxchat-close-user-profile'))
    window.dispatchEvent(new CustomEvent('foxchat-open-room', { detail: id }))
  }
  const openDM = async () => {
    if (isSelf || dmBusy) return
    setDmBusy(true)
    try {
      const room = await matrixService.openOrCreateDMWith(request.userId)
      openMutual(room.roomId)
    } catch (error) {
      message.error(error instanceof Error ? error.message : 'Could not start a DM')
    } finally {
      setDmBusy(false)
    }
  }
  const server = request.userId.includes(':')
    ? request.userId.slice(request.userId.indexOf(':') + 1)
    : 'Unknown'
  return (
    <>
      {bannerUrl && (
        <div
          className="profileBanner"
          role="button"
          tabIndex={0}
          aria-label={`View ${name}'s profile banner`}
          title="View profile banner"
          onClick={() => showImageViewer(bannerUrl, `${name}'s profile banner`)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault()
              showImageViewer(bannerUrl, `${name}'s profile banner`)
            }
          }}
          style={{ cursor: 'zoom-in' }}
        >
          <img src={bannerUrl} alt={`${name}'s profile banner`} />
        </div>
      )}
      <div className="profileBody">
        <div className="profileHead">
          {resolvedAvatarUrl ? (
            <button
              type="button"
              aria-label={`View ${name}'s profile picture`}
              title="View profile picture"
              onClick={() => showImageViewer(resolvedAvatarUrl, `${name}'s profile picture`)}
              style={{
                appearance: 'none',
                display: 'flex',
                flex: 'none',
                padding: 0,
                border: 0,
                borderRadius: '50%',
                background: 'transparent',
                color: 'inherit',
                cursor: 'zoom-in',
              }}
            >
              <MemberAvatar userId={request.userId} name={name} url={avatarUrl} size={48} />
            </button>
          ) : (
            <MemberAvatar userId={request.userId} name={name} url={avatarUrl} size={48} />
          )}
          <div>
            <div className="profileName">{name}</div>
            {pronouns && <div className="profilePronouns">{pronouns}</div>}
            <div className="mxid">{request.userId}</div>
          </div>
          <Tooltip title={isSelf ? 'This is you' : 'Message'}>
            <IconBtn
              aria-label="Send a direct message"
              shape="circle"
              icon={<MessageOutlined />}
              disabled={isSelf}
              loading={dmBusy}
              onClick={openDM}
              style={{
                position: 'absolute',
                top: '50%',
                right: 0,
                transform: 'translateY(-50%)',
              }}
            />
          </Tooltip>
        </div>
        {status && <div className="profileStatus">{status}</div>}
        {bio && <div className="profileBio">{bio}</div>}
        <div className="server">Homeserver · {server}</div>
        {localTime && (
          <div className="server">
            Local time · {localTime.label} · {localTime.timezone}
          </div>
        )}
        {socialLinks.length > 0 && (
          <>
            <div className="groupTitle">Social links</div>
            <div className="socialLinks">
              {socialLinks.map((item, index) => (
                <a
                  className="socialLink"
                  key={`${item.link}-${index}`}
                  href={item.link}
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  <SocialLinkIcon item={item} client={client} />
                  <span>{item.title}</span>
                </a>
              ))}
            </div>
          </>
        )}
        <div className="groupTitle">Mutual Spaces · {mutualSpaces.size}</div>
        {[...mutualSpaces].map(([id, label]) => (
          <div
            className="mutual"
            role="link"
            tabIndex={0}
            key={id}
            onClick={() => openMutual(id)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                openMutual(id)
              }
            }}
          >
            ◆ {label}
          </div>
        ))}
        {!mutualSpaces.size && <div className="server">No mutual Spaces</div>}
        <div className="groupTitle">Mutual channels · {mutualChannels.length}</div>
        {mutualChannels.map((channel) => (
          <div
            className="mutual"
            role="link"
            tabIndex={0}
            key={channel.id}
            onClick={() => openMutual(channel.id)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                openMutual(channel.id)
              }
            }}
          >
            # {channel.label}
          </div>
        ))}
        {!mutualChannels.length && <div className="server">No standalone mutual channels</div>}
      </div>
    </>
  )
}
