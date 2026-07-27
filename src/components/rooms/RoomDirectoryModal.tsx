import { useMediaUrl } from '../../lib/hooks'
import { clearRoomDirectoryUrl } from '../../lib/urlState'
import { DirectoryList } from '../../styles'
import { useCallback, useEffect, useRef, useState } from 'react'
import { AutoComplete, Avatar, Button, Empty, Input, Modal, Spin, App as AntApp } from 'antd'
import { TeamOutlined } from '@ant-design/icons'
import { type IPublicRoomsChunkRoom, type MatrixClient } from 'matrix-js-sdk'
import { matrixService } from '../../matrix/MatrixClientService'

function DirectoryRow({
  entry,
  client,
  onJoin,
  joining,
}: {
  entry: IPublicRoomsChunkRoom
  client?: MatrixClient
  onJoin: () => void
  joining: boolean
}) {
  const avatarUrl = useMediaUrl({ url: entry.avatar_url }, client)
  const title = entry.name || entry.canonical_alias || entry.room_id
  return (
    <div className="item">
      <Avatar size={44} src={avatarUrl} shape="square">
        {!avatarUrl && title[0]?.toUpperCase()}
      </Avatar>
      <div className="meta">
        <div className="name">{title}</div>
        {entry.topic && <div className="topic">{entry.topic}</div>}
        <div className="members">
          {entry.num_joined_members} member
          {entry.num_joined_members === 1 ? '' : 's'}
        </div>
      </div>
      <Button loading={joining} onClick={onJoin}>
        Join
      </Button>
    </div>
  )
}

export function RoomDirectoryModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { message } = AntApp.useApp()
  const accounts = matrixService.availableAccounts()
  const defaultAccountUserId = accounts[0]?.userId
  const [term, setTerm] = useState('')
  const [serverField, setServerField] = useState('')
  const [rooms, setRooms] = useState<IPublicRoomsChunkRoom[]>([])
  const [nextBatch, setNextBatch] = useState<string>()
  const [loading, setLoading] = useState(false)
  const [joiningId, setJoiningId] = useState<string>()
  const generationRef = useRef(0)
  const matchedAccount = accounts.find((account) => account.userId === serverField.trim())
  const accountId = matchedAccount?.id ?? accounts[0]?.id
  const client = accounts.find((account) => account.id === accountId)?.client
  const serverName = matchedAccount
    ? ''
    : serverField
        .trim()
        .replace(/^https?:\/\//i, '')
        .replace(/\/.*$/, '')

  useEffect(() => {
    if (open) setServerField((current) => current || defaultAccountUserId || '')
    else {
      setRooms([])
      setNextBatch(undefined)
      setTerm('')
      setServerField('')
    }
  }, [open, defaultAccountUserId])

  const search = useCallback(
    async (searchTerm: string, id: string | undefined, srv: string) => {
      if (!id) return
      generationRef.current++
      const generation = generationRef.current
      setLoading(true)
      try {
        const response = await matrixService.publicRooms(
          id,
          searchTerm,
          undefined,
          srv || undefined,
        )
        if (generationRef.current !== generation) return
        setRooms(response.chunk)
        setNextBatch(response.next_batch)
      } catch (error) {
        message.error(error instanceof Error ? error.message : 'Could not load the room directory')
      } finally {
        if (generationRef.current === generation) setLoading(false)
      }
    },
    [message],
  )

  useEffect(() => {
    if (!open || !accountId) return
    const timer = window.setTimeout(() => void search(term, accountId, serverName), 300)
    return () => window.clearTimeout(timer)
  }, [open, accountId, term, serverName, search])

  const loadMore = async () => {
    if (!accountId || !nextBatch || loading) return
    const generation = generationRef.current
    setLoading(true)
    try {
      const response = await matrixService.publicRooms(
        accountId,
        term,
        nextBatch,
        serverName || undefined,
      )
      if (generationRef.current !== generation) return
      setRooms((current) => [...current, ...response.chunk])
      setNextBatch(response.next_batch)
    } catch (error) {
      message.error(error instanceof Error ? error.message : 'Could not load more rooms')
    } finally {
      if (generationRef.current === generation) setLoading(false)
    }
  }

  const join = async (entry: IPublicRoomsChunkRoom) => {
    if (!accountId) return
    setJoiningId(entry.room_id)
    try {
      const joined = await matrixService.joinRoomAs(
        entry.room_id,
        accountId,
        serverName ? [serverName] : undefined,
      )
      message.success(`Joined ${joined.name}`)
      clearRoomDirectoryUrl()
      window.dispatchEvent(new CustomEvent('foxchat-open-room', { detail: joined.roomId }))
    } catch (error) {
      message.error(error instanceof Error ? error.message : 'Could not join that room')
    } finally {
      setJoiningId(undefined)
    }
  }

  return (
    <Modal title="Discover rooms" open={open} footer={null} width={560} onCancel={onClose}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <AutoComplete
          style={{ width: 220 }}
          value={serverField}
          onChange={setServerField}
          options={accounts.map((account) => ({ value: account.userId }))}
          placeholder="Account or server (e.g. matrix.org)"
        />
        <Input
          allowClear
          autoFocus
          placeholder="Search public rooms"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
        />
      </div>
      <DirectoryList
        onScroll={(event) => {
          const target = event.currentTarget
          if (target.scrollHeight - target.scrollTop - target.clientHeight < 160) void loadMore()
        }}
      >
        {rooms.map((entry) => (
          <DirectoryRow
            key={entry.room_id}
            entry={entry}
            client={client}
            joining={joiningId === entry.room_id}
            onJoin={() => void join(entry)}
          />
        ))}
        {!loading && !rooms.length && (
          <Empty
            image={<TeamOutlined style={{ fontSize: 32, opacity: 0.4 }} />}
            description="No public rooms found"
          />
        )}
        {loading && (
          <div style={{ textAlign: 'center', padding: 16 }}>
            <Spin size="small" />
          </div>
        )}
      </DirectoryList>
    </Modal>
  )
}
