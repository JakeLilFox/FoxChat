import { EventType, HistoryVisibility, M_POLL_START, MatrixEvent, Room } from 'matrix-js-sdk'
import { textOf } from './pollHelpers'
import { type TimelineAppearanceSettings, timelineAppearanceSettings } from './constants'

// Matrix replies include a plain-text fallback for older clients.
const stripReplyFallback = (body: string) => {
  const lines = body.split('\n')
  while (lines[0]?.startsWith('> ')) lines.shift()
  if (lines[0] === '') lines.shift()
  return lines.join('\n')
}

export const eventBody = (e?: MatrixEvent) => {
  if (!e) return ''
  const c = e.getContent()
  if (e.isBeingDecrypted()) return 'Decrypting message…'
  if (e.isDecryptionFailure()) return 'Keys for this message are not available on this device'
  if (M_POLL_START.matches(e.getType())) {
    const poll = c[M_POLL_START.name] ?? c[M_POLL_START.altName ?? '']
    const question = textOf(poll?.question)
    return question ? `Poll: ${question}` : 'Poll'
  }
  if (c.msgtype === 'm.key.verification.request') return 'Device verification request'
  const label: { [key: string]: string } = {
    'm.image': 'Image',
    'm.sticker': 'Sticker',
    'm.file': 'File',
    'm.audio': 'Audio',
    'm.video': 'Video',
    'm.location': 'Location',
    'm.emote': '*',
  }
  const type = String(e.getType() === 'm.sticker' ? 'm.sticker' : c.msgtype)
  const rawBody = String(c.body ?? '')
  const body =
    type === 'm.text' || type === 'm.notice' || type === 'm.emote'
      ? stripReplyFallback(rawBody)
      : rawBody
  const prefix = label[type]
  if (!prefix) return body || 'Unsupported message'
  if (!body) return prefix
  return prefix === '*' ? `* ${body}` : `${prefix}: ${body}`
}

export const roomTopic = (room: Room) =>
  String(room.currentState.getStateEvents(EventType.RoomTopic, '')?.getContent().topic ?? '').trim()

export const isPreJoinHistoryUnavailable = (
  event: MatrixEvent,
  room: Room | null | undefined,
  userId: string | undefined | null,
) => {
  if (!room || !userId || room.getHistoryVisibility() !== HistoryVisibility.Joined) return false
  const membershipEvent = room.currentState.getStateEvents(EventType.RoomMember, userId)
  if (
    !membershipEvent ||
    Array.isArray(membershipEvent) ||
    membershipEvent.getContent().membership !== 'join'
  )
    return false
  const joinedAt = membershipEvent.getTs()
  const eventAt = event.getTs()
  return Number.isFinite(joinedAt) && joinedAt > 0 && Number.isFinite(eventAt) && eventAt < joinedAt
}

export const isVisibleMessageEvent = (event: MatrixEvent) => {
  const relation = event.getOriginalContent()['m.relates_to'] as { rel_type?: string } | undefined
  return (
    (event.getType() === EventType.RoomMessage ||
      event.getType() === EventType.Sticker ||
      M_POLL_START.matches(event.getType())) &&
    relation?.rel_type !== 'm.replace' &&
    !event.isRedacted()
  )
}
export const isMembershipChange = (event: MatrixEvent) => {
  if (event.getType() !== EventType.RoomMember) return false
  const content = event.getContent() ?? {}
  const previousContent = event.getPrevContent() ?? {}
  const membership = content.membership
  const previous = previousContent.membership
  if (membership !== 'join' && membership !== 'leave') return false
  return previous !== membership
}
export const callMemberEventTypes = new Set([
  'org.matrix.msc3401.call.member',
  'm.call.member',
  'org.matrix.msc4143.rtc.member',
])
export const isActiveCallMembership = (content: Record<string, any>) => {
  if (content.application === 'm.call' && typeof content.membershipID === 'string')
    return (
      content.membershipID.length > 0 &&
      (typeof content.expires !== 'number' || content.expires > 0)
    )
  return (
    content.application?.type === 'm.call' &&
    typeof content.member?.id === 'string' &&
    content.member.id.length > 0 &&
    Array.isArray(content.rtc_transports)
  )
}
const isJoinedMemberProfileUpdate = (event: MatrixEvent) => {
  if (event.getType() !== EventType.RoomMember) return false
  const content = event.getContent() ?? {}
  const previous = event.getPrevContent() ?? {}
  return content.membership === 'join' && previous.membership === 'join'
}
export const isDisplayNameChange = (event: MatrixEvent) =>
  isJoinedMemberProfileUpdate(event) &&
  String(event.getContent().displayname ?? '') !== String(event.getPrevContent().displayname ?? '')
export const isAvatarChange = (event: MatrixEvent) =>
  isJoinedMemberProfileUpdate(event) &&
  String(event.getContent().avatar_url ?? '') !== String(event.getPrevContent().avatar_url ?? '')
export const isCallMembershipChange = (event: MatrixEvent) =>
  callMemberEventTypes.has(event.getType()) &&
  isActiveCallMembership(event.getContent() ?? {}) !==
    isActiveCallMembership(event.getPrevContent() ?? {})
export const isHiddenTimelineActivity = (
  event: MatrixEvent,
  settings: TimelineAppearanceSettings = timelineAppearanceSettings(),
) => {
  const matchingSettings = [
    isMembershipChange(event) ? settings.roomMembership : undefined,
    isCallMembershipChange(event) ? settings.voiceMembership : undefined,
    isDisplayNameChange(event) ? settings.displayName : undefined,
    isAvatarChange(event) ? settings.avatar : undefined,
  ].filter((value): value is boolean => value !== undefined)
  return matchingSettings.length > 0 && matchingSettings.every((value) => !value)
}
export const isTimelineEvent = (event: MatrixEvent) =>
  isVisibleMessageEvent(event) ||
  isMembershipChange(event) ||
  isCallMembershipChange(event) ||
  isDisplayNameChange(event) ||
  isAvatarChange(event)
export const MESSAGE_WINDOW_SIZE = 40
export const MESSAGE_WINDOW_SHIFT = 20
