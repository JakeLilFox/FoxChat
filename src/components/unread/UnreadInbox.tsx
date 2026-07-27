import { MemberAvatar } from '../profile'
import { RoomAvatar } from '../rooms'
import { eventBody } from '../../lib/eventHelpers'
import { IconBtn, Main } from '../../styles'
import { Feed, Group, Header, RoomBlock } from './UnreadInbox.styles'
import { useUnreadGroups } from './useUnreadGroups'
import { Empty, Spin } from 'antd'
import { MenuOutlined } from '@ant-design/icons'
import { type MatrixEvent, type Room } from 'matrix-js-sdk'

const unreadEventLabel = (event: MatrixEvent) => {
  const label = eventBody(event)
  return label === 'Unsupported message' ? `Unsupported notification · ${event.getType()}` : label
}

export function UnreadInbox({
  rooms,
  revision,
  onMenu,
  onOpen,
}: {
  rooms: Room[]
  revision: number
  onMenu: () => void
  onOpen: (roomId: string, eventId: string) => void
}) {
  const { groups, loading } = useUnreadGroups(rooms, revision)

  const messageCount = groups.reduce(
    (total, group) => total + group.rooms.reduce((sum, room) => sum + room.events.length, 0),
    0,
  )
  return (
    <Main>
      <Header>
        <IconBtn aria-label="Open rooms" shape="circle" icon={<MenuOutlined />} onClick={onMenu} />
        <div>
          <h1>Unread messages</h1>
          <div className="subtitle">
            {loading
              ? 'Loading unread messages…'
              : `${messageCount} unread message${messageCount === 1 ? '' : 's'}`}
          </div>
        </div>
      </Header>
      <Feed>
        {loading ? (
          <div style={{ display: 'grid', placeItems: 'center', minHeight: 180 }}>
            <Spin />
          </div>
        ) : groups.length ? (
          groups.map((group) => (
            <Group key={group.id}>
              <h2>{group.name}</h2>
              {group.rooms.map(({ room, events }) => (
                <RoomBlock key={room.roomId}>
                  <div className="roomHead">
                    <RoomAvatar room={room} size={30} />
                    <span>{room.name}</span>
                  </div>
                  {events.map((event) => {
                    const senderId = event.getSender() ?? ''
                    const member = room.getMember(senderId)
                    const eventId = event.getId()
                    return (
                      <button
                        type="button"
                        className="message"
                        key={eventId}
                        disabled={!eventId}
                        onClick={() => eventId && onOpen(room.roomId, eventId)}
                      >
                        <MemberAvatar
                          userId={senderId}
                          name={member?.name ?? senderId}
                          url={member?.getMxcAvatarUrl()}
                          size={32}
                        />
                        <span>
                          <span className="sender">{member?.name ?? senderId}</span>
                          <span className="body">{unreadEventLabel(event)}</span>
                        </span>
                        <time dateTime={new Date(event.getTs()).toISOString()}>
                          {new Date(event.getTs()).toLocaleString([], {
                            dateStyle: 'short',
                            timeStyle: 'short',
                          })}
                        </time>
                      </button>
                    )
                  })}
                </RoomBlock>
              ))}
            </Group>
          ))
        ) : (
          <Empty description="You’re all caught up" />
        )}
      </Feed>
    </Main>
  )
}
