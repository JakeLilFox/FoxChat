import { MembershipLine } from '../../styles'
import { MatrixEvent } from 'matrix-js-sdk'
import { matrixService } from '../../matrix/MatrixClientService'

export function MembershipStatus({ event }: { event: MatrixEvent }) {
  const room = matrixService.matrixClient?.getRoom(event.getRoomId())
  const memberId = event.getStateKey() || event.getSender() || ''
  const member = room?.getMember(memberId)
  const name = String(event.getContent().displayname || member?.name || memberId)
  return (
    <MembershipLine>
      {name} {event.getContent().membership === 'join' ? 'joined' : 'left'} the room
    </MembershipLine>
  )
}
