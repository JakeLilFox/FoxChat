import { isActiveCallMembership } from '../../lib/eventHelpers'
import { MembershipLine } from '../../styles'
import { MatrixEvent } from 'matrix-js-sdk'
import { matrixService } from '../../matrix/MatrixClientService'

export function CallMembershipStatus({ event }: { event: MatrixEvent }) {
  const room = matrixService
    .clientForRoom(event.getRoomId() ?? '')
    ?.getRoom(event.getRoomId() ?? '')
  const content = event.getContent() ?? {}
  const previous = event.getPrevContent() ?? {}
  const joined = isActiveCallMembership(content)
  const activeContent = joined ? content : previous
  const userId = String(activeContent.member?.user_id ?? event.getSender() ?? '')
  const name = room?.getMember(userId)?.name || userId || 'Someone'
  const intent = String(
    activeContent['m.call.intent'] || activeContent.application?.['m.call.intent'] || '',
  ).toLowerCase()
  return (
    <MembershipLine>
      {name} {joined ? 'joined' : 'left'} the{' '}
      {intent === 'video' ? 'video call' : intent === 'audio' ? 'voice call' : 'call'}
    </MembershipLine>
  )
}
