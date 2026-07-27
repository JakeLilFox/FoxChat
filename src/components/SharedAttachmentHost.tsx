import { RoomAvatar } from './rooms'
import { type NativeSharedFile, decodeNativeSharedFiles, queueSharedFiles } from '../lib/media'
import { containingSpacePath } from '../lib/spaceHelpers'
import { roomLatestTs } from '../lib/timelineHelpers'
import { setDrawerOpenUrl, writeRoomUrl } from '../lib/urlState'
import { useEffect, useState } from 'react'
import { Input, Modal, List as AntList } from 'antd'
import { SearchOutlined } from '@ant-design/icons'
import { Room, RoomType } from 'matrix-js-sdk'
import { matrixService } from '../matrix/MatrixClientService'

export function SharedAttachmentHost() {
  const [files, setFiles] = useState<File[]>([])
  const [query, setQuery] = useState('')
  const [, refresh] = useState(0)
  useEffect(() => {
    const receive = (event: Event) => {
      try {
        const detail = (event as CustomEvent<{ files?: NativeSharedFile[] }>).detail
        const next = decodeNativeSharedFiles(detail?.files ?? [])
        if (next.length) setFiles(next)
      } catch (error) {
        console.error('[share] Could not read shared files', error)
      }
    }
    window.addEventListener('foxchat-native-share', receive)
    const pending = (
      window as typeof window & {
        __foxchatPendingShare?: { files?: NativeSharedFile[] }
      }
    ).__foxchatPendingShare
    if (pending) receive(new CustomEvent('foxchat-native-share', { detail: pending }))
    const timer = window.setInterval(() => refresh((value) => value + 1), 1000)
    return () => {
      window.removeEventListener('foxchat-native-share', receive)
      window.clearInterval(timer)
    }
  }, [])
  const rooms = matrixService
    .rooms()
    .filter((room) => room.getMyMembership() === 'join' && room.getType() !== RoomType.Space)
    .filter(
      (room) =>
        !query.trim() ||
        room.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()) ||
        room.roomId.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
    )
    .sort((a, b) => roomLatestTs(b) - roomLatestTs(a))
  const choose = (room: Room) => {
    const shared = [...files]
    queueSharedFiles(room.roomId, shared)
    setDrawerOpenUrl(false, true)
    writeRoomUrl(room.roomId, false, containingSpacePath(room.roomId).at(-1))
    window.dispatchEvent(new PopStateEvent('popstate', { state: history.state }))
    setFiles([])
    setQuery('')
    delete (window as typeof window & { __foxchatPendingShare?: unknown }).__foxchatPendingShare
  }
  return (
    <Modal
      title={`Share ${files.length} file${files.length === 1 ? '' : 's'} to…`}
      open={files.length > 0}
      footer={null}
      onCancel={() => {
        setFiles([])
        setQuery('')
      }}
      destroyOnHidden
    >
      <Input
        autoFocus
        allowClear
        prefix={<SearchOutlined />}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search chats"
        style={{ marginBottom: 12 }}
      />
      <AntList
        dataSource={rooms}
        locale={{ emptyText: 'No matching chats' }}
        renderItem={(room) => (
          <AntList.Item style={{ cursor: 'pointer' }} onClick={() => choose(room)}>
            <AntList.Item.Meta
              avatar={<RoomAvatar room={room} size={40} />}
              title={room.name}
              description={room.getCanonicalAlias() || room.roomId}
            />
          </AntList.Item>
        )}
      />
    </Modal>
  )
}
