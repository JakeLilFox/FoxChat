import { MemberAvatar } from '../profile'
import { RoomAvatar } from './RoomAvatar'
import { RoomNotificationModeIcon } from './RoomNotificationModeIcon'
import { SpaceChannelRow } from '../spaces'
import { VoiceParticipantList } from '../calls/VoiceParticipantList'
import { isVoiceChannel, voicePresenceLabel } from '../calls/voiceRoom'
import { type ThemeMode } from '../../lib/constants'
import { eventBody, isVisibleMessageEvent } from '../../lib/eventHelpers'
import { useMediaUrl } from '../../lib/hooks'
import { roomBannerContent } from '../../lib/roomBanner'
import { SelectiveCache } from '../../lib/selectiveCache'
import { showRoomDevTools, showRoomSettings } from '../../lib/roomSettingsHelpers'
import { compareSpaceChildren, containingSpacePath } from '../../lib/spaceHelpers'
import {
  roomHasTyping,
  roomLatestTs,
  roomUnreadCount,
  typingPreview,
} from '../../lib/timelineHelpers'
import { openRoomDirectoryUrl, openSearchUrl, setRoomActionUrl } from '../../lib/urlState'
import { showUserProfile } from '../../lib/userProfile'
import {
  Brand,
  FilterRow,
  IconBtn,
  List,
  Logo,
  Name,
  Preview,
  Profile,
  RoomListReadMark,
  Row,
  SearchWrap,
  Section,
  SideHeader,
  Sidebar,
  SidebarBanner,
  VoiceChannelGroup,
  VoiceDockSlot,
} from '../../styles'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Avatar,
  Badge,
  Button,
  Dropdown,
  Empty,
  Input,
  Tooltip,
  App as AntApp,
  type MenuProps,
} from 'antd'
import {
  ArrowLeftOutlined,
  BellOutlined,
  CheckCircleFilled,
  CheckOutlined,
  ClockCircleFilled,
  CodeOutlined,
  CompassOutlined,
  InfoCircleOutlined,
  LockOutlined,
  LoginOutlined,
  LogoutOutlined,
  MinusCircleFilled,
  MoonOutlined,
  MoreOutlined,
  PlusOutlined,
  PushpinOutlined,
  ReadOutlined,
  SearchOutlined,
  SettingOutlined,
  SunOutlined,
  SyncOutlined,
  TagOutlined,
  TeamOutlined,
  UserAddOutlined,
} from '@ant-design/icons'
import { EventType, MatrixEvent, Room, RoomType } from 'matrix-js-sdk'
import { matrixService, type PresenceMode } from '../../matrix/MatrixClientService'

export function RoomList({
  rooms,
  allRooms,
  allChildIds,
  revision,
  changedRoomIds,
  selected,
  onSelect: selectRoom,
  onSpaceOverview,
  spaceOverview = false,
  mode,
  onMode,
  onSettings,
  onUnreadInbox,
  mobile = false,
}: {
  rooms: Room[]
  allRooms: Room[]
  allChildIds: Set<string>
  revision: number
  changedRoomIds: ReadonlySet<string>
  selected?: string
  onSelect: (id: string) => void
  onSpaceOverview?: (room: Room) => void
  spaceOverview?: boolean
  mode: ThemeMode
  onMode: () => void
  onSettings: () => void
  onUnreadInbox: () => void
  mobile?: boolean
}) {
  const { message, modal } = AntApp.useApp()
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('All')
  const [spacePath, setSpacePath] = useState<string[]>([])
  const [inviteBusy, setInviteBusy] = useState<string>()
  const [, refreshPins] = useState(0)
  const [, refreshPresence] = useState(0)
  const [dragState, setDragState] = useState<{
    source: string
    target?: string
    edge?: 'before' | 'after'
  }>()
  const draggedRoom = useRef<string | undefined>(undefined)
  const profileAnchor = useRef<HTMLDivElement | null>(null)
  const spaceSwipeStart = useRef<{ x: number; y: number } | undefined>(undefined)
  const activeSpace = matrixService.room(spacePath.at(-1) ?? '')
  const client = activeSpace
    ? matrixService.clientForRoom(activeSpace.roomId)
    : matrixService.matrixClient
  const activeAccountClient = matrixService.activeAccountClient()
  useEffect(() => {
    const refresh = () => refreshPresence((value) => value + 1)
    window.addEventListener('foxchat-presence-mode-changed', refresh)
    window.addEventListener('foxchat-presence-state-changed', refresh)
    return () => {
      window.removeEventListener('foxchat-presence-mode-changed', refresh)
      window.removeEventListener('foxchat-presence-state-changed', refresh)
    }
  }, [])
  const direct = useMemo(() => {
    void revision
    return Object.assign(
      {},
      ...matrixService
        .availableAccounts()
        .map(
          (account) =>
            account.client
              .getAccountData(EventType.Direct)
              ?.getContent<Record<string, string[]>>() ?? {},
        ),
    ) as Record<string, string[]>
  }, [revision])
  const dmIds = useMemo(() => {
    return new Set([
      ...Object.values(direct).flat(),
      ...allRooms
        .filter((room) => !!matrixService.directRoomMember(room))
        .map((room) => room.roomId),
    ])
  }, [allRooms, direct])
  const spaceChildren = useMemo(() => {
    void revision
    const children =
      activeSpace?.currentState
        .getStateEvents(EventType.SpaceChild)
        .filter((event) => Array.isArray(event.getContent().via))
        .map(
          (event) =>
            client?.getRoom(event.getStateKey() ?? '') ??
            matrixService.room(event.getStateKey() ?? ''),
        )
        .filter((child): child is Room => !!child) ?? []
    if (activeSpace) children.sort((a, b) => compareSpaceChildren(activeSpace, a, b))
    return children
  }, [activeSpace, client, revision])
  const activeSpaceBannerUrl = useMediaUrl(roomBannerContent(activeSpace))
  const roomMembershipKey = useMemo(
    () =>
      rooms
        .map((room) => room.roomId)
        .sort()
        .join('|'),
    [rooms],
  )
  useEffect(() => {
    if (!selected) return
    const target = matrixService.room(selected)
    const path = containingSpacePath(selected)
    setSpacePath(target?.getType() === RoomType.Space ? [...path, selected] : path)
  }, [selected, roomMembershipKey])
  const roomInvites = useMemo(() => {
    void allRooms
    void revision
    return matrixService.roomInvites()
  }, [allRooms, revision])
  const unreadCache = useRef(new Map<string, number>())
  const unreadFor = useMemo(() => {
    void revision
    if (changedRoomIds.size === 0 || changedRoomIds.has('*')) unreadCache.current.clear()
    else for (const roomId of changedRoomIds) unreadCache.current.delete(roomId)
    return (roomId: string) => {
      const cached = unreadCache.current.get(roomId)
      if (cached !== undefined) return cached
      const unread = matrixService.effectiveUnreadCount(roomId)
      unreadCache.current.set(roomId, unread)
      return unread
    }
  }, [changedRoomIds, revision])
  const ownAccountUserIds = useMemo(() => {
    void revision
    return new Set(matrixService.availableAccounts().map((account) => account.userId))
  }, [revision])
  const summaryCache = useRef(
    new SelectiveCache<
      string,
      {
        last?: MatrixEvent
        lastIsMine: boolean
        lastReadByOther: boolean
        unread: number
        latest: number
        typing: boolean
      }
    >(),
  )
  const summaryFor = useMemo(() => {
    void allRooms
    void revision
    const cache = summaryCache.current
    if (changedRoomIds.has('*')) cache.clear()
    else {
      const invalidated = new Set(changedRoomIds)
      for (const candidate of allRooms) {
        if (candidate.getType() === RoomType.Space) invalidated.add(candidate.roomId)
      }
      cache.invalidate(invalidated)
    }
    cache.retain(new Set(allRooms.map((candidate) => candidate.roomId)))
    return (room: Room) => {
      return cache.get(room.roomId, () => {
        const events = room.getLiveTimeline().getEvents()
        let last
        for (let index = events.length - 1; index >= 0; index -= 1) {
          if (isVisibleMessageEvent(events[index])) {
            last = events[index]
            break
          }
        }
        const lastIsMine = !!last && ownAccountUserIds.has(last.getSender() ?? '')
        return {
          last,
          lastIsMine,
          lastReadByOther:
            !!last &&
            lastIsMine &&
            room.getUsersReadUpTo(last).some((reader) => !ownAccountUserIds.has(reader)),
          unread: roomUnreadCount(room, new Set(), unreadFor),
          latest: roomLatestTs(room),
          typing: roomHasTyping(room, new Set(), ownAccountUserIds),
        }
      })
    }
  }, [allRooms, changedRoomIds, revision, unreadFor, ownAccountUserIds])
  const topSpaceId = spacePath[0]
  const outsideUnread = useMemo(
    () =>
      activeSpace
        ? allRooms
            .filter((room) => !allChildIds.has(room.roomId) && room.roomId !== topSpaceId)
            .reduce((total, room) => total + summaryFor(room).unread, 0)
        : 0,
    [activeSpace, allRooms, allChildIds, topSpaceId, summaryFor],
  )
  const onSelect = (id: string) => {
    const target = matrixService.room(id)
    if (target?.getType() === RoomType.Space) setSpacePath((path) => [...path, id])
    selectRoom(id)
  }
  const openAccountManager = () => window.dispatchEvent(new CustomEvent('foxchat-accounts'))
  const accountUserId = activeAccountClient?.getUserId() ?? undefined
  const accountUser = accountUserId ? activeAccountClient?.getUser(accountUserId) : undefined
  const accountDisplayName = accountUser?.displayName || accountUserId || 'Matrix account'
  const activeAccount = matrixService
    .availableAccounts()
    .find((account) => account.client === activeAccountClient)
  const accountPresenceMode = matrixService.presenceMode(activeAccount?.id)
  const accountPresenceState = matrixService.effectivePresenceState(activeAccount?.id)
  const accountPresence =
    accountPresenceState === 'online'
      ? { label: 'Online', color: '#35c978' }
      : accountPresenceState === 'unavailable'
        ? { label: 'Away', color: '#e8b84a' }
        : { label: 'Offline', color: '#9299aa' }
  const setAccountPresence = (presenceMode: PresenceMode) => {
    if (!activeAccount) return
    matrixService.setPresenceMode(activeAccount.id, presenceMode)
  }
  const checkedPresenceLabel = (label: string, mode: PresenceMode) => (
    <span>
      {label}
      {accountPresenceMode === mode && <CheckOutlined style={{ marginLeft: 8 }} />}
    </span>
  )
  const accountMenu: MenuProps = {
    items: [
      {
        key: 'profile',
        label: 'View profile',
        icon: <InfoCircleOutlined />,
        disabled: !accountUserId,
        onClick: ({ domEvent }) => {
          domEvent.stopPropagation()
          if (!accountUserId || !profileAnchor.current) return
          window.setTimeout(() => {
            if (!profileAnchor.current) return
            showUserProfile(
              accountUserId,
              profileAnchor.current,
              accountDisplayName,
              accountUser?.avatarUrl,
              'above',
            )
          }, 0)
        },
      },
      {
        key: 'presence',
        label: `Presence: ${accountPresence.label}`,
        icon:
          accountPresenceState === 'online' ? (
            <CheckCircleFilled style={{ color: accountPresence.color }} />
          ) : accountPresenceState === 'unavailable' ? (
            <ClockCircleFilled style={{ color: accountPresence.color }} />
          ) : (
            <MinusCircleFilled style={{ color: accountPresence.color }} />
          ),
        disabled: !activeAccount,
        children: [
          {
            key: 'presence-automatic',
            label: checkedPresenceLabel('Automatic', 'automatic'),
            icon: <SyncOutlined />,
            onClick: () => setAccountPresence('automatic'),
          },
          {
            key: 'presence-online',
            label: checkedPresenceLabel('Force online', 'online'),
            icon: <CheckCircleFilled style={{ color: '#35c978' }} />,
            onClick: () => setAccountPresence('online'),
          },
          {
            key: 'presence-away',
            label: checkedPresenceLabel('Force away', 'away'),
            icon: <ClockCircleFilled style={{ color: '#e8b84a' }} />,
            onClick: () => setAccountPresence('away'),
          },
          {
            key: 'presence-offline',
            label: checkedPresenceLabel('Force offline', 'offline'),
            icon: <MinusCircleFilled style={{ color: '#9299aa' }} />,
            onClick: () => setAccountPresence('offline'),
          },
        ],
      },
      {
        key: 'accounts',
        label: 'Switch accounts',
        icon: <TeamOutlined />,
        onClick: openAccountManager,
      },
    ],
  }
  const accountFooter = (
    <Dropdown trigger={['click']} placement="topLeft" menu={accountMenu}>
      <Profile ref={profileAnchor} role="button" tabIndex={0} data-testid="account-menu">
        {accountUserId ? (
          <MemberAvatar
            userId={accountUserId}
            name={accountDisplayName}
            url={accountUser?.avatarUrl}
            size={32}
          />
        ) : (
          <Avatar style={{ background: '#202633' }}>?</Avatar>
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="accountPrimary">
            <span className="accountName">{accountDisplayName}</span>
            <span className="accountMxid">{accountUserId}</span>
          </div>
          <Preview>
            <CheckCircleFilled style={{ color: '#35c978' }} /> Connected
          </Preview>
        </div>
        <Tooltip title={mode === 'light' ? 'Dark mode' : 'Light mode'}>
          <IconBtn
            aria-label={mode === 'light' ? 'Enable dark mode' : 'Enable light mode'}
            onClick={(event) => {
              event.stopPropagation()
              onMode()
            }}
            shape="circle"
            icon={mode === 'light' ? <MoonOutlined /> : <SunOutlined />}
          />
        </Tooltip>
        <Tooltip title="Settings">
          <IconBtn
            aria-label="Open settings"
            onClick={(event) => {
              event.stopPropagation()
              onSettings()
            }}
            shape="circle"
            icon={<SettingOutlined />}
          />
        </Tooltip>
      </Profile>
    </Dropdown>
  )
  const customTags = [
    ...new Set(
      allRooms.flatMap((room) => Object.keys(room.tags).filter((tag) => tag.startsWith('u.'))),
    ),
  ].sort((a, b) => a.slice(2).localeCompare(b.slice(2)))
  const pinnedIds = rooms
    .filter((room) => !!room.tags['m.favourite'])
    .sort(
      (a, b) =>
        (Number(a.tags['m.favourite']?.order) || 0.5) -
        (Number(b.tags['m.favourite']?.order) || 0.5),
    )
    .map((room) => room.roomId)
  const pinnedIndex = new Map(pinnedIds.map((id, index) => [id, index]))
  const filterRooms = filter.startsWith('u.') ? allRooms : rooms
  const shown = filterRooms
    .filter(
      (r) =>
        r.getMyMembership() !== 'invite' &&
        r.name.toLowerCase().includes(query.toLowerCase()) &&
        (filter === 'All' ||
          (filter === 'Unread' && summaryFor(r).unread > 0) ||
          (filter === 'Spaces' && r.getType() === RoomType.Space) ||
          (filter === 'DMs' && dmIds.has(r.roomId)) ||
          (filter.startsWith('u.') && !!r.tags[filter])),
    )
    .sort((a, b) => {
      const ai = pinnedIndex.get(a.roomId)
      const bi = pinnedIndex.get(b.roomId)
      if (ai !== undefined || bi !== undefined)
        return ai === undefined ? 1 : bi === undefined ? -1 : ai - bi
      return summaryFor(b).latest - summaryFor(a).latest
    })
  const respondToInvite = async (accountId: string, room: Room, accept: boolean) => {
    const key = `${accountId}\u0000${room.roomId}`
    setInviteBusy(key)
    try {
      if (accept) {
        await matrixService.joinRoomAs(room.roomId, accountId)
        // Keep the account selection until membership sync catches up.
        matrixService.selectRoomAccount(room.roomId, accountId, true)
        message.success(`Joined ${room.name}`)
        onSelect(room.roomId)
      } else {
        await matrixService.declineRoomInvite(room.roomId, accountId)
        message.success(`Declined invitation to ${room.name}`)
      }
    } catch (error) {
      message.error(
        error instanceof Error
          ? error.message
          : `Could not ${accept ? 'accept' : 'decline'} invitation`,
      )
    } finally {
      setInviteBusy(undefined)
    }
  }
  const applyPinnedOrder = (ids: string[]) => {
    ids.forEach((id, index) => {
      const target = matrixService.room(id)
      if (target) target.tags['m.favourite'] = { order: (index + 1) / (ids.length + 1) }
    })
    refreshPins((value) => value + 1)
    void matrixService
      .setPinnedRoomOrder(ids)
      .catch((error) =>
        message.error(error instanceof Error ? error.message : 'Could not save pinned chats'),
      )
  }
  const togglePin = (room: Room) => {
    if (pinnedIndex.has(room.roomId)) {
      delete room.tags['m.favourite']
      refreshPins((value) => value + 1)
      void matrixService
        .unpinRoom(room.roomId)
        .catch((error) =>
          message.error(error instanceof Error ? error.message : 'Could not unpin chat'),
        )
    } else applyPinnedOrder([...pinnedIds, room.roomId])
  }
  const addTag = async (room: Room, tag: string) => {
    try {
      await matrixService.addRoomTag(room.roomId, tag)
      room.tags[tag] = {}
      refreshPins((value) => value + 1)
      message.success(`Added ${tag.slice(2)} tag`)
    } catch (error) {
      message.error(error instanceof Error ? error.message : 'Could not add tag')
      throw error
    }
  }
  const removeTag = async (room: Room, tag: string) => {
    try {
      await matrixService.removeRoomTag(room.roomId, tag)
      delete room.tags[tag]
      if (filter === tag) setFilter('All')
      refreshPins((value) => value + 1)
      message.success(`Removed ${tag.slice(2)} tag`)
    } catch (error) {
      message.error(error instanceof Error ? error.message : 'Could not remove tag')
    }
  }
  const createTag = (room: Room) => {
    let value = ''
    modal.confirm({
      title: `Add tag to ${room.name}`,
      content: (
        <Input
          autoFocus
          maxLength={253}
          placeholder="For example: Work"
          onChange={(event) => {
            value = event.target.value
          }}
          onPressEnter={() => undefined}
        />
      ),
      okText: 'Add tag',
      onOk: async () => {
        const label = value.trim().replace(/^u\./i, '')
        const tag = `u.${label}`
        if (!label) {
          message.error('Enter a tag name')
          throw new Error('Tag name is required')
        }
        if (new TextEncoder().encode(tag).length > 255) {
          message.error('Matrix tag names cannot exceed 255 bytes')
          throw new Error('Tag name is too long')
        }
        await addTag(room, tag)
      },
    })
  }
  const clearDrag = () => {
    draggedRoom.current = undefined
    setDragState(undefined)
  }
  const dropPinned = (targetId: string, edge: 'before' | 'after') => {
    const sourceId = draggedRoom.current
    if (!sourceId) {
      clearDrag()
      return
    }
    const next = pinnedIds.filter((id) => id !== sourceId)
    const targetIndex = next.indexOf(targetId)
    next.splice(Math.max(0, targetIndex + (edge === 'after' ? 1 : 0)), 0, sourceId)
    clearDrag()
    if (next.some((id, index) => id !== pinnedIds[index])) applyPinnedOrder(next)
  }
  const roomMenu = (room: Room) => ({
    items: [
      {
        key: 'pin',
        label: pinnedIndex.has(room.roomId) ? 'Unpin chat' : 'Pin chat',
        icon: <PushpinOutlined />,
        onClick: () => togglePin(room),
      },
      {
        key: 'mark-read',
        label: room.getType() === RoomType.Space ? 'Mark entire Space as read' : 'Mark as read',
        icon: <CheckOutlined />,
        onClick: () =>
          void matrixService
            .markRoomOrSpaceRead(room.roomId)
            .then(({ marked }) =>
              message.success(
                marked === 0
                  ? 'No unread messages'
                  : room.getType() === RoomType.Space
                    ? `${marked} room${marked === 1 ? '' : 's'} marked as read`
                    : 'Room marked as read',
              ),
            )
            .catch((error) =>
              message.error(error instanceof Error ? error.message : 'Could not mark as read'),
            ),
      },
      {
        key: 'tags',
        label: 'Tags',
        icon: <TagOutlined />,
        children: [
          {
            key: 'add-tag',
            label: 'Add tag',
            children: [
              ...customTags
                .filter((tag) => !room.tags[tag])
                .map((tag) => ({
                  key: `add-${tag}`,
                  label: tag.slice(2),
                  onClick: () => void addTag(room, tag),
                })),
              {
                key: 'new-tag',
                label: 'New tag…',
                onClick: () => createTag(room),
              },
            ],
          },
          ...(Object.keys(room.tags).some((tag) => tag.startsWith('u.'))
            ? [
                {
                  key: 'remove-tag',
                  label: 'Remove tag',
                  children: Object.keys(room.tags)
                    .filter((tag) => tag.startsWith('u.'))
                    .sort()
                    .map((tag) => ({
                      key: `remove-${tag}`,
                      label: tag.slice(2),
                      onClick: () => void removeTag(room, tag),
                    })),
                },
              ]
            : []),
        ],
      },
      {
        key: 'notifications',
        label: room.getType() === RoomType.Space ? 'Notifications · entire Space' : 'Notifications',
        icon: <BellOutlined />,
        children: [
          {
            key: 'notify-all',
            label: room.getType() === RoomType.Space ? 'All messages in Space' : 'All messages',
            onClick: () =>
              void matrixService
                .setRoomNotificationMode(room.roomId, 'all')
                .then(() => message.success('All-message notifications enabled'))
                .catch((e) =>
                  message.error(e instanceof Error ? e.message : 'Could not update notifications'),
                ),
          },
          {
            key: 'notify-mentions',
            label: room.getType() === RoomType.Space ? 'Mentions in Space' : 'Mentions only',
            onClick: () =>
              void matrixService
                .setRoomNotificationMode(room.roomId, 'mentions')
                .then(() => message.success('Mention notifications enabled'))
                .catch((e) =>
                  message.error(e instanceof Error ? e.message : 'Could not update notifications'),
                ),
          },
          {
            key: 'notify-none',
            label: room.getType() === RoomType.Space ? 'Mute entire Space' : 'None',
            onClick: () =>
              void matrixService
                .setRoomNotificationMode(room.roomId, 'none')
                .then(() => message.success('Notifications disabled'))
                .catch((e) =>
                  message.error(e instanceof Error ? e.message : 'Could not update notifications'),
                ),
          },
        ],
      },
      {
        key: 'info',
        label: matrixService.directRoomMember(room) ? 'User information' : 'Room information',
        icon: <InfoCircleOutlined />,
        onClick: () => {
          const member = matrixService.directRoomMember(room)
          const target = document.querySelector<HTMLElement>(
            '.ant-dropdown:not(.ant-dropdown-hidden)',
          )
          if (member && target)
            showUserProfile(member.userId, target, member.name, member.getMxcAvatarUrl())
          else onSelect(room.roomId)
        },
      },
      {
        key: 'settings',
        label: `${room.getType() === RoomType.Space ? 'Space' : 'Room'} settings`,
        icon: <SettingOutlined />,
        onClick: () => showRoomSettings(room),
      },
      {
        key: 'devtools',
        label: 'Developer tools',
        icon: <CodeOutlined />,
        onClick: () => showRoomDevTools(room),
      },
      ...Object.entries(direct)
        .filter(([, ids]) => ids.includes(room.roomId))
        .map(([userId]) => ({
          key: 'block-user',
          label: matrixService.matrixClient?.isUserIgnored(userId) ? 'Unblock user' : 'Block user',
          danger: !matrixService.matrixClient?.isUserIgnored(userId),
          onClick: () =>
            void matrixService
              .setUserBlocked(userId, !matrixService.matrixClient?.isUserIgnored(userId))
              .then(() =>
                message.success(
                  matrixService.matrixClient?.isUserIgnored(userId)
                    ? 'User blocked'
                    : 'User unblocked',
                ),
              )
              .catch((error) =>
                message.error(
                  error instanceof Error ? error.message : 'Could not update blocked users',
                ),
              ),
        })),
      { type: 'divider' as const },
      {
        key: 'leave',
        label: 'Leave room',
        danger: true,
        icon: <LogoutOutlined />,
        onClick: () =>
          modal.confirm({
            title: `Leave ${room.name}?`,
            content:
              'You will stop receiving messages from this room. You may need another invitation to rejoin.',
            okText: 'Leave room',
            okButtonProps: { danger: true },
            onOk: () => matrixService.leaveRoom(room.roomId),
          }),
      },
    ],
  })
  if (activeSpace)
    return (
      <Sidebar
        $mobile={mobile}
        data-testid="room-sidebar"
        onTouchStart={(e) => {
          if (!mobile) return
          const touch = e.changedTouches[0]
          spaceSwipeStart.current = touch ? { x: touch.clientX, y: touch.clientY } : undefined
        }}
        onTouchEnd={(e) => {
          const start = spaceSwipeStart.current
          const end = e.changedTouches[0]
          spaceSwipeStart.current = undefined
          if (
            mobile &&
            start &&
            end &&
            end.clientX - start.x > 70 &&
            Math.abs(end.clientY - start.y) < 55
          )
            setSpacePath((path) => path.slice(0, -1))
        }}
        onTouchCancel={() => {
          spaceSwipeStart.current = undefined
        }}
      >
        <SideHeader>
          <Tooltip
            title={
              outsideUnread ? `Close Space · ${outsideUnread} unread elsewhere` : 'Close Space'
            }
          >
            <Badge count={outsideUnread} size="small" color="#7357e8" offset={[-2, 3]}>
              <IconBtn
                shape="circle"
                icon={<ArrowLeftOutlined />}
                onClick={() => setSpacePath((path) => path.slice(0, -1))}
              />
            </Badge>
          </Tooltip>
          <RoomAvatar room={activeSpace} size={35} />
          <Brand style={{ fontSize: 16 }}>{activeSpace.name}</Brand>
        </SideHeader>
        {activeSpaceBannerUrl && (
          <SidebarBanner>
            <img src={activeSpaceBannerUrl} alt="" />
          </SidebarBanner>
        )}
        <Section style={{ padding: '8px 12px 5px' }}>
          <div className="head">
            <span>Channels</span>
          </div>
        </Section>
        <List>
          <Dropdown trigger={['contextMenu']} menu={roomMenu(activeSpace)}>
            <Row $selected={spaceOverview} onClick={() => onSpaceOverview?.(activeSpace)}>
              <Avatar size={43} shape="square" style={{ background: '#2f2853', color: '#a996ff' }}>
                <TeamOutlined />
              </Avatar>
              <div style={{ minWidth: 0 }}>
                <Name>Browse channels</Name>
                <Preview>View every channel in this Space</Preview>
              </div>
            </Row>
          </Dropdown>
          {spaceChildren.map((child) => {
            const summary = summaryFor(child)
            return (
              <Dropdown
                key={child.roomId}
                trigger={['contextMenu']}
                menu={{
                  items: roomMenu(child).items.filter(
                    (item) => !('key' in item) || (item.key !== 'pin' && item.key !== 'tags'),
                  ),
                }}
              >
                <div>
                  <SpaceChannelRow
                    room={child}
                    unread={summary.unread}
                    selected={!spaceOverview && selected === child.roomId}
                    onSelect={() => onSelect(child.roomId)}
                  />
                </div>
              </Dropdown>
            )
          })}
          {!spaceChildren.length && (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description="No joined channels in this space"
            />
          )}
        </List>
        <VoiceDockSlot data-voice-dock />
        {accountFooter}
      </Sidebar>
    )
  return (
    <Sidebar $mobile={mobile} data-testid="room-sidebar">
      <SideHeader>
        <Brand>
          <Logo>F</Logo>FoxChat
        </Brand>
        <Tooltip title="Unread messages">
          <IconBtn
            aria-label="Unread messages"
            shape="circle"
            icon={<ReadOutlined />}
            onClick={onUnreadInbox}
          />
        </Tooltip>
        <Dropdown
          trigger={['click']}
          menu={{
            items: [
              {
                key: 'create-dm',
                label: 'Start a DM',
                icon: <UserAddOutlined />,
                onClick: () => setRoomActionUrl('create-dm'),
              },
              {
                key: 'join',
                label: 'Join a room',
                icon: <LoginOutlined />,
                onClick: () => setRoomActionUrl('join'),
              },
              {
                key: 'discover',
                label: 'Discover rooms',
                icon: <CompassOutlined />,
                onClick: openRoomDirectoryUrl,
              },
              {
                key: 'search-all',
                label: 'Search all messages',
                icon: <SearchOutlined />,
                onClick: () => openSearchUrl('all'),
              },
              {
                key: 'create',
                label: 'Create a room',
                icon: <PlusOutlined />,
                onClick: () => setRoomActionUrl('create'),
              },
              {
                key: 'create-space',
                label: 'Create Space',
                icon: <TeamOutlined />,
                onClick: () => setRoomActionUrl('create-space'),
              },
            ],
          }}
        >
          <IconBtn aria-label="Room actions" shape="circle" icon={<MoreOutlined />} />
        </Dropdown>
      </SideHeader>
      <SearchWrap>
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          prefix={<SearchOutlined />}
          placeholder="Search rooms"
          allowClear
        />
      </SearchWrap>
      <FilterRow>
        {[...['All', 'Unread', 'Spaces', 'DMs'], ...customTags].map((x) => (
          <button
            key={x}
            title={x.startsWith('u.') ? x.slice(2) : x}
            className={filter === x ? 'active' : ''}
            onClick={() => setFilter(x)}
          >
            {x.startsWith('u.') ? x.slice(2) : x}
          </button>
        ))}
      </FilterRow>
      {roomInvites.length > 0 && (
        <Section style={{ padding: '10px 12px 4px' }}>
          <div className="head">
            <span>Invitations</span>
            <Badge count={roomInvites.length} size="small" color="#7357e8" />
          </div>
          {roomInvites.map((invite) => {
            const busyKey = `${invite.accountId}\u0000${invite.room.roomId}`
            return (
              <div className="item invitation" key={busyKey}>
                <RoomAvatar room={invite.room} size={36} />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <Name>{invite.room.name}</Name>
                  <Preview>
                    {invite.inviterName ? `Invited by ${invite.inviterName}` : 'Room invitation'}
                  </Preview>
                  <Preview>For {invite.accountUserId}</Preview>
                  <div
                    style={{
                      display: 'flex',
                      gap: 6,
                      marginTop: 8,
                      flexWrap: 'wrap',
                    }}
                  >
                    <Button
                      type="primary"
                      size="small"
                      loading={inviteBusy === busyKey}
                      disabled={!!inviteBusy && inviteBusy !== busyKey}
                      onClick={() => void respondToInvite(invite.accountId, invite.room, true)}
                    >
                      Accept
                    </Button>
                    <Button
                      danger
                      size="small"
                      disabled={!!inviteBusy}
                      onClick={() =>
                        modal.confirm({
                          title: `Decline invitation to ${invite.room.name}?`,
                          okText: 'Decline',
                          okButtonProps: { danger: true },
                          onOk: () => respondToInvite(invite.accountId, invite.room, false),
                        })
                      }
                    >
                      Decline
                    </Button>
                  </div>
                </div>
              </div>
            )
          })}
        </Section>
      )}
      <List
        onDragOver={(event) => {
          if (draggedRoom.current && dragState?.target) event.preventDefault()
        }}
        onDrop={(event) => {
          if (!dragState?.target || !dragState.edge) return
          event.preventDefault()
          dropPinned(dragState.target, dragState.edge)
        }}
      >
        {shown.map((room) => {
          const summary = summaryFor(room)
          const last = summary.last
          const lastIsMine = summary.lastIsMine
          const lastReadByOther = summary.lastReadByOther
          const unread = summary.unread
          const pinned = pinnedIndex.has(room.roomId)
          const dropEdge =
            dragState?.target === room.roomId && dragState.source !== room.roomId
              ? dragState.edge
              : undefined
          return (
            <Dropdown key={room.roomId} trigger={['contextMenu']} menu={roomMenu(room)}>
              <VoiceChannelGroup>
                <Row
                  data-testid="room-row"
                  data-room-id={room.roomId}
                  data-room-type={room.getType() === RoomType.Space ? 'space' : 'room'}
                  draggable={pinned}
                  $dragging={dragState?.source === room.roomId}
                  $dropEdge={dropEdge}
                  onDragStart={(event) => {
                    draggedRoom.current = room.roomId
                    setDragState({ source: room.roomId })
                    event.dataTransfer.effectAllowed = 'move'
                  }}
                  onDragEnd={clearDrag}
                  onDragOver={(event) => {
                    if (!pinned || !draggedRoom.current || draggedRoom.current === room.roomId)
                      return
                    event.preventDefault()
                    event.dataTransfer.dropEffect = 'move'
                    const bounds = event.currentTarget.getBoundingClientRect()
                    const edge = event.clientY < bounds.top + bounds.height / 2 ? 'before' : 'after'
                    setDragState((current) =>
                      current?.target === room.roomId && current.edge === edge
                        ? current
                        : {
                            source: draggedRoom.current!,
                            target: room.roomId,
                            edge,
                          },
                    )
                  }}
                  onDrop={(event) => {
                    event.preventDefault()
                    dropPinned(room.roomId, dropEdge ?? 'before')
                  }}
                  $selected={selected === room.roomId}
                  onClick={() => onSelect(room.roomId)}
                >
                  <RoomAvatar room={room} />
                  <div style={{ minWidth: 0 }}>
                    <Name>
                      {pinned && <PushpinOutlined style={{ marginRight: 6, fontSize: 10 }} />}
                      {room.getType() === RoomType.Space && (
                        <TeamOutlined style={{ marginRight: 6 }} />
                      )}
                      {room.name}
                    </Name>
                    {summary.typing ? (
                      typingPreview
                    ) : (
                      <Preview>
                        {room.getMyMembership() === 'invite'
                          ? 'Invitation'
                          : isVoiceChannel(room)
                            ? voicePresenceLabel(room)
                            : eventBody(last) || room.getCanonicalAlias() || room.roomId}
                      </Preview>
                    )}
                  </div>
                  <div
                    style={{
                      alignSelf: 'start',
                      paddingTop: 3,
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'flex-end',
                      gap: 4,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <RoomNotificationModeIcon roomId={room.roomId} />
                      {room.hasEncryptionStateEvent() && (
                        <Tooltip title="Encrypted">
                          <LockOutlined style={{ opacity: 0.55, fontSize: 12 }} />
                        </Tooltip>
                      )}
                      {unread > 0 && (
                        <Badge
                          data-testid="unread-badge"
                          count={unread}
                          size="small"
                          color="#7357e8"
                        />
                      )}
                    </div>
                    {lastIsMine && (
                      <Tooltip title={lastReadByOther ? 'Read' : 'Sent'}>
                        <RoomListReadMark $read={lastReadByOther}>
                          <CheckOutlined />
                          {lastReadByOther && <CheckOutlined />}
                        </RoomListReadMark>
                      </Tooltip>
                    )}
                  </div>
                </Row>
                {isVoiceChannel(room) && <VoiceParticipantList room={room} />}
              </VoiceChannelGroup>
            </Dropdown>
          )
        })}
        {!shown.length && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No rooms" />}
      </List>
      <VoiceDockSlot data-voice-dock />
      {accountFooter}
    </Sidebar>
  )
}
