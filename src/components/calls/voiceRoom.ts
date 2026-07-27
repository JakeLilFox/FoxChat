import { VOICE_CHANNEL_ROOM_TYPE } from '../../lib/constants'
import { EventType, type MatrixClient, Room, type RoomMember, RoomType } from 'matrix-js-sdk'
import type { CallMembership } from 'matrix-js-sdk/lib/matrixrtc/CallMembership'
import { GroupCallType } from 'matrix-js-sdk/lib/webrtc/groupCall'
import { matrixService } from '../../matrix/MatrixClientService'

export { VOICE_CHANNEL_ROOM_TYPE }
export const voiceCallFor = (room: Room) => {
  const call = matrixService.clientForRoomInstance(room)?.getGroupCallForRoom(room.roomId)
  return call?.type === GroupCallType.Voice ? call : undefined
}
export const isVoiceChannel = (room: Room) =>
  room.getType() === VOICE_CHANNEL_ROOM_TYPE ||
  matrixRTCVoiceMembers(matrixService.clientForRoomInstance(room), room).length > 0
export const matrixRTCActiveSpeakers = new Map<string, Set<string>>()
export const voiceSpeakerEvent = 'foxchat-voice-speakers'
export const matrixMemberDisplayName = (member: RoomMember, client?: MatrixClient) => {
  const profileName = client?.getUser(member.userId)?.displayName
  return profileName && profileName !== member.userId
    ? profileName
    : member.rawDisplayName || member.name || member.userId
}
export const activeVoiceUsers = (room: Room, seen = new Set<string>()): Map<string, string> => {
  if (seen.has(room.roomId)) return new Map()
  seen.add(room.roomId)
  const users = new Map<string, string>()
  const client = matrixService.clientForRoomInstance(room)
  for (const member of matrixRTCVoiceMembers(client, room))
    users.set(member.userId, matrixMemberDisplayName(member, client))
  const call = voiceCallFor(room)
  if (call)
    for (const member of call.participants.keys())
      users.set(member.userId, matrixMemberDisplayName(member, client))
  if (room.getType() === RoomType.Space)
    for (const event of room.currentState.getStateEvents(EventType.SpaceChild)) {
      const child = client?.getRoom(event.getStateKey() ?? '')
      if (child) for (const [id, name] of activeVoiceUsers(child, seen)) users.set(id, name)
    }
  return users
}
export const voicePresenceLabel = (room: Room) => {
  const names = [...activeVoiceUsers(room).values()]
  return names.length ? `In voice · ${names.join(', ')}` : 'Voice channel · nobody connected'
}
export const matrixRTCVoiceMemberships = (
  client: MatrixClient | undefined,
  room: Room,
): CallMembership[] => client?.matrixRTC.getRoomSession(room).memberships ?? []
export const matrixRTCVoiceMembers = (
  client: MatrixClient | undefined,
  room: Room,
): RoomMember[] => {
  const memberships = matrixRTCVoiceMemberships(client, room)
  const seen = new Set<string>()
  const members = memberships.flatMap((membership) => {
    if (seen.has(membership.userId)) return []
    seen.add(membership.userId)
    const member = room.getMember(membership.userId)
    return member ? [member] : []
  })
  const ownId = client?.getUserId()
  const ownMember = ownId ? room.getMember(ownId) : undefined
  if (memberships.length && ownMember && !seen.has(ownMember.userId)) members.unshift(ownMember)
  return members
}
