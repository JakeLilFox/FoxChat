import { FollowingChatHost } from '../../composer'
import { RoleAssignmentMenu } from '../../roles'
import { RoomDevToolsModal } from './RoomDevToolsModal'
import { RoomSettingsModal } from './RoomSettingsModal'
import { VoiceCallHost } from '../../calls/VoiceCallHost'
import { type RoleAssignRequest } from '../../../lib/roleHelpers'
import { useEffect, useState } from 'react'
import { Room } from 'matrix-js-sdk'

export function RoomSettingsHost() {
  const [room, setRoom] = useState<Room>()
  const [devRoom, setDevRoom] = useState<Room>()
  const [roleRequest, setRoleRequest] = useState<RoleAssignRequest>()
  useEffect(() => {
    const open = (event: Event) => setRoom((event as CustomEvent<Room>).detail)
    const assignRole = (event: Event) =>
      setRoleRequest((event as CustomEvent<RoleAssignRequest>).detail)
    const openDevTools = (event: Event) => setDevRoom((event as CustomEvent<Room>).detail)
    window.addEventListener('foxchat-room-settings', open)
    window.addEventListener('foxchat-room-devtools', openDevTools)
    window.addEventListener('foxchat-assign-role', assignRole)
    return () => {
      window.removeEventListener('foxchat-room-settings', open)
      window.removeEventListener('foxchat-room-devtools', openDevTools)
      window.removeEventListener('foxchat-assign-role', assignRole)
    }
  }, [])
  return (
    <>
      {room && <RoomSettingsModal room={room} onClose={() => setRoom(undefined)} />}{' '}
      {devRoom && <RoomDevToolsModal room={devRoom} onClose={() => setDevRoom(undefined)} />}
      {roleRequest && (
        <RoleAssignmentMenu request={roleRequest} onClose={() => setRoleRequest(undefined)} />
      )}
      <VoiceCallHost />
      <FollowingChatHost />
    </>
  )
}
