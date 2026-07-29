import { RoomAvatar } from '../rooms'
import { colorFor, initials } from '../../lib/constants'
import { roomTopic } from '../../lib/eventHelpers'
import { useMediaUrl } from '../../lib/hooks'
import { roomBannerContent } from '../../lib/roomBanner'
import { showRoomDevTools, showRoomSettings } from '../../lib/roomSettingsHelpers'
import { compareSpaceChildren } from '../../lib/spaceHelpers'
import {
  IconBtn,
  Main,
  MobileMenu,
  Name,
  RoomBanner,
  SpaceDirectoryBody,
  TopInfo,
  Topbar,
} from '../../styles'
import { useEffect, useState } from 'react'
import { Avatar, Button, Dropdown, Empty, Spin, App as AntApp } from 'antd'
import {
  BellOutlined,
  CodeOutlined,
  InfoCircleOutlined,
  LogoutOutlined,
  MenuOutlined,
  SettingOutlined,
} from '@ant-design/icons'
import { EventType, Room } from 'matrix-js-sdk'
import { matrixService } from '../../matrix/MatrixClientService'

export type SpaceDirectoryEntry = {
  room_id: string
  name?: string
  topic?: string
  canonical_alias?: string
}
export function SpaceOverview({
  room,
  onMenu,
  onInfo,
  onSelect,
}: {
  room: Room
  onMenu: () => void
  onInfo: () => void
  onSelect: (id: string) => void
}) {
  const { message, modal } = AntApp.useApp()
  const [directory, setDirectory] = useState<SpaceDirectoryEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [joining, setJoining] = useState<string>()
  const [acceptingSpace, setAcceptingSpace] = useState(false)
  const client = matrixService.clientForRoom(room.roomId)
  const accountId = matrixService
    .availableAccounts()
    .find((account) => account.client === client)?.id
  const accountRoom = client?.getRoom(room.roomId) ?? room
  const spaceInvited = accountRoom.getMyMembership() === 'invite'
  const bannerUrl = useMediaUrl(roomBannerContent(accountRoom), client, {
    category: 'avatar',
    roomId: room.roomId,
  })
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    void client
      ?.getRoomHierarchy(room.roomId, 100, 1)
      .then((result) => {
        if (!cancelled) setDirectory(result.rooms.filter((entry) => entry.room_id !== room.roomId))
      })
      .catch(() => {
        if (!cancelled) setDirectory([])
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [client, room])
  const known = accountRoom.currentState
    .getStateEvents(EventType.SpaceChild)
    .filter((event) => Array.isArray(event.getContent().via))
    .map(
      (event) =>
        client?.getRoom(event.getStateKey() ?? '') ?? matrixService.room(event.getStateKey() ?? ''),
    )
    .filter((child): child is Room => !!child)
  const knownEntries: SpaceDirectoryEntry[] = known.map((child) => ({
    room_id: child.roomId,
    name: child.name,
    topic: roomTopic(child),
    canonical_alias: child.getCanonicalAlias() ?? undefined,
  }))
  // Merge the hierarchy snapshot with locally synced children.
  const channels = [
    ...directory,
    ...knownEntries.filter(
      (entry) => !directory.some((existing) => existing.room_id === entry.room_id),
    ),
  ]
  channels.sort((a, b) =>
    compareSpaceChildren(
      accountRoom,
      { roomId: a.room_id, name: a.name },
      { roomId: b.room_id, name: b.name },
    ),
  )
  const join = async (id: string) => {
    setJoining(id)
    try {
      if (!client) throw new Error('Space account is unavailable')
      const childVia =
        accountRoom.currentState
          .getStateEvents(EventType.SpaceChild, id)
          ?.getContent<{ via?: string[] }>().via ?? []
      const entry = channels.find((channel) => channel.room_id === id)
      const aliasServer = entry?.canonical_alias?.includes(':')
        ? entry.canonical_alias.slice(entry.canonical_alias.indexOf(':') + 1)
        : undefined
      const legacyRoomServer = id.includes(':') ? id.slice(id.indexOf(':') + 1) : undefined
      const viaServers = [
        ...new Set(
          [...childVia, aliasServer, legacyRoomServer].filter(
            (server): server is string => !!server,
          ),
        ),
      ]
      const joined = await client.joinRoom(id, viaServers.length ? { viaServers } : undefined)
      if (accountId) {
        matrixService.selectRoomAccount(joined.roomId, accountId, true)
      }
      message.success(`Joined ${joined.name}`)
      onSelect(joined.roomId)
    } catch (error) {
      message.error(error instanceof Error ? error.message : 'Could not join channel')
    } finally {
      setJoining(undefined)
    }
  }
  const acceptSpaceInvite = async () => {
    if (!client) return
    setAcceptingSpace(true)
    try {
      await client.joinRoom(room.roomId)
      message.success(`Joined ${accountRoom.name}`)
    } catch (error) {
      message.error(error instanceof Error ? error.message : 'Could not accept Space invitation')
    } finally {
      setAcceptingSpace(false)
    }
  }
  const declineSpaceInvite = () => {
    modal.confirm({
      title: `Decline invite to ${accountRoom.name}?`,
      okText: 'Decline',
      okButtonProps: { danger: true },
      onOk: () => matrixService.leaveRoom(room.roomId, accountId),
    })
  }
  const openChannel = (roomId: string) => {
    if (accountId) matrixService.selectRoomAccount(roomId, accountId)
    onSelect(roomId)
  }
  const channelMenu = (entry: SpaceDirectoryEntry, child?: Room | null) => ({
    items:
      child?.getMyMembership() === 'invite'
        ? [
            {
              key: 'accept',
              label: 'Accept invite',
              onClick: () => void join(entry.room_id),
            },
            {
              key: 'decline',
              label: 'Decline invite',
              danger: true,
              onClick: () =>
                modal.confirm({
                  title: `Decline invite to ${entry.name || 'this channel'}?`,
                  okText: 'Decline',
                  okButtonProps: { danger: true },
                  onOk: () => matrixService.leaveRoom(entry.room_id, accountId),
                }),
            },
          ]
        : child?.getMyMembership() === 'join'
          ? [
              {
                key: 'open',
                label: 'Open room',
                onClick: () => openChannel(child.roomId),
              },
              {
                key: 'notifications',
                label: 'Notifications',
                icon: <BellOutlined />,
                children: [
                  {
                    key: 'notify-all',
                    label: 'All messages',
                    onClick: () =>
                      void matrixService
                        .setRoomNotificationMode(child.roomId, 'all', accountId)
                        .then(() => message.success('All-message notifications enabled'))
                        .catch((error) =>
                          message.error(
                            error instanceof Error
                              ? error.message
                              : 'Could not update notifications',
                          ),
                        ),
                  },
                  {
                    key: 'notify-mentions',
                    label: 'Mentions only',
                    onClick: () =>
                      void matrixService
                        .setRoomNotificationMode(child.roomId, 'mentions', accountId)
                        .then(() => message.success('Mention notifications enabled'))
                        .catch((error) =>
                          message.error(
                            error instanceof Error
                              ? error.message
                              : 'Could not update notifications',
                          ),
                        ),
                  },
                  {
                    key: 'notify-none',
                    label: 'None',
                    onClick: () =>
                      void matrixService
                        .setRoomNotificationMode(child.roomId, 'none', accountId)
                        .then(() => message.success('Notifications disabled'))
                        .catch((error) =>
                          message.error(
                            error instanceof Error
                              ? error.message
                              : 'Could not update notifications',
                          ),
                        ),
                  },
                ],
              },
              {
                key: 'settings',
                label: 'Room settings',
                icon: <SettingOutlined />,
                onClick: () => showRoomSettings(child),
              },
              {
                key: 'devtools',
                label: 'Developer tools',
                icon: <CodeOutlined />,
                onClick: () => showRoomDevTools(child),
              },
              { type: 'divider' as const },
              {
                key: 'leave',
                label: 'Leave room',
                danger: true,
                icon: <LogoutOutlined />,
                onClick: () =>
                  modal.confirm({
                    title: `Leave ${child.name}?`,
                    content:
                      'You will stop receiving messages from this room. You may need another invitation to rejoin.',
                    okText: 'Leave',
                    okButtonProps: { danger: true },
                    onOk: () => matrixService.leaveRoom(child.roomId, accountId),
                  }),
              },
            ]
          : [
              {
                key: 'join',
                label: `Join ${entry.name || entry.canonical_alias || 'room'}`,
                onClick: () => void join(entry.room_id),
              },
            ],
  })
  return (
    <Main>
      <Topbar>
        <MobileMenu onClick={onMenu} icon={<MenuOutlined />} />
        <RoomAvatar room={accountRoom} size={41} />
        <TopInfo>
          <h2>{accountRoom.name}</h2>
          <div className="status">Space overview</div>
        </TopInfo>
        <IconBtn onClick={onInfo} shape="circle" icon={<InfoCircleOutlined />} />
      </Topbar>
      <SpaceDirectoryBody>
        {bannerUrl && (
          <RoomBanner>
            <img src={bannerUrl} alt="" />
          </RoomBanner>
        )}
        <div className="intro">
          <h1>{accountRoom.name}</h1>
          <p>
            {roomTopic(accountRoom) ||
              `Browse every channel in ${accountRoom.name}. Join new channels or open ones you already participate in.`}
          </p>
        </div>
        {spaceInvited && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: '12px 16px',
              marginBottom: 16,
              borderRadius: 12,
              background: 'rgba(115,87,232,0.12)',
            }}
          >
            <span style={{ flex: 1 }}>You have been invited to this Space.</span>
            <Button
              type="primary"
              loading={acceptingSpace}
              onClick={() => void acceptSpaceInvite()}
            >
              Accept invite
            </Button>
            <Button danger onClick={declineSpaceInvite}>
              Decline
            </Button>
          </div>
        )}
        <div className="listHead">
          <span>Channels</span>
          <span>{channels.length}</span>
        </div>
        {loading ? (
          <Spin />
        ) : (
          <div className="channels">
            {channels.map((entry) => {
              const accountChild = client?.getRoom(entry.room_id)
              const displayChild = accountChild ?? matrixService.room(entry.room_id)
              const joined = accountChild?.getMyMembership() === 'join'
              const invited = accountChild?.getMyMembership() === 'invite'
              return (
                <Dropdown
                  key={entry.room_id}
                  trigger={['contextMenu']}
                  menu={channelMenu(entry, accountChild)}
                >
                  <div
                    className="channel"
                    onClick={() => {
                      if (joined) openChannel(entry.room_id)
                      else if (invited) void join(entry.room_id)
                    }}
                    style={{ cursor: joined || invited ? 'pointer' : 'default' }}
                  >
                    {displayChild ? (
                      <RoomAvatar room={displayChild} size={42} />
                    ) : (
                      <Avatar
                        size={42}
                        shape="square"
                        style={{ background: colorFor(entry.room_id) }}
                      >
                        {initials(entry.name || entry.canonical_alias || '#')}
                      </Avatar>
                    )}
                    <div className="grow">
                      <Name>
                        {displayChild?.name || entry.name || entry.canonical_alias || entry.room_id}
                      </Name>
                      <div className="topic">
                        {entry.topic ||
                          (displayChild && roomTopic(displayChild)) ||
                          entry.canonical_alias ||
                          'No channel topic'}
                      </div>
                    </div>
                    <div className="membership">
                      {joined ? (
                        <Button size="small" onClick={() => openChannel(entry.room_id)}>
                          Open
                        </Button>
                      ) : (
                        <Button
                          size="small"
                          type="primary"
                          loading={joining === entry.room_id}
                          onClick={(event) => {
                            event.stopPropagation()
                            void join(entry.room_id)
                          }}
                        >
                          {invited ? 'Accept invite' : 'Join'}
                        </Button>
                      )}
                    </div>
                  </div>
                </Dropdown>
              )
            })}
            {!channels.length && <Empty description="No channels in this Space" />}
          </div>
        )}
      </SpaceDirectoryBody>
    </Main>
  )
}
