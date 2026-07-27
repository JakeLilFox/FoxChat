import { aggregatePollResponses, textOf } from '../../lib/pollHelpers'
import {
  PollAnswer,
  PollAnswerBar,
  PollAnswerCount,
  PollAnswerText,
  PollCard,
  PollFooter,
  PollQuestion,
} from '../../styles'
import { useEffect, useState } from 'react'
import { Button } from 'antd'
import { CheckOutlined } from '@ant-design/icons'
import { M_POLL_START, MatrixEvent, PollEvent, Room } from 'matrix-js-sdk'
import { matrixService } from '../../matrix/MatrixClientService'

export function PollMessage({
  event,
  room,
  userId,
  canEnd,
}: {
  event: MatrixEvent
  room?: Room | null
  userId?: string | null
  canEnd: boolean
}) {
  const pollEventId = event.getId()
  const poll = pollEventId ? room?.polls.get(pollEventId) : undefined
  const [responses, setResponses] = useState<MatrixEvent[]>([])
  const [ended, setEnded] = useState(poll?.isEnded ?? false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!poll) return
    let active = true
    const refresh = () => {
      setEnded(poll.isEnded)
      void poll.getResponses().then((relations) => {
        if (active) setResponses(relations.getRelations())
      })
    }
    refresh()
    poll.on(PollEvent.Responses, refresh)
    poll.on(PollEvent.Update, refresh)
    poll.on(PollEvent.End, refresh)
    return () => {
      active = false
      poll.off(PollEvent.Responses, refresh)
      poll.off(PollEvent.Update, refresh)
      poll.off(PollEvent.End, refresh)
    }
  }, [poll])

  const content = event.getContent()
  const pollContent = content[M_POLL_START.name] ?? content[M_POLL_START.altName ?? '']
  const question = textOf(pollContent?.question) || 'Poll'
  const answers: { id: string; text: string }[] = Array.isArray(pollContent?.answers)
    ? pollContent.answers.map((answer: { id: string }) => ({
        id: answer.id,
        text: textOf(answer as { 'm.text'?: string; body?: string }),
      }))
    : []
  const maxSelections: number =
    typeof pollContent?.max_selections === 'number' && pollContent.max_selections > 1
      ? pollContent.max_selections
      : 1
  const { voters, mySelected } = aggregatePollResponses(responses, userId)
  const totalVoters = new Set([...voters.values()].flat()).size

  const vote = async (answerId: string) => {
    if (!userId || ended || busy || !pollEventId || !room) return
    let next: string[]
    if (mySelected.includes(answerId)) next = mySelected.filter((id) => id !== answerId)
    else if (maxSelections <= 1) next = [answerId]
    else if (mySelected.length < maxSelections) next = [...mySelected, answerId]
    else next = [...mySelected.slice(1), answerId]
    setBusy(true)
    try {
      await matrixService.votePoll(room.roomId, pollEventId, next)
    } finally {
      setBusy(false)
    }
  }

  const endThisPoll = async () => {
    if (!pollEventId || !room) return
    setBusy(true)
    try {
      await matrixService.endPoll(room.roomId, pollEventId)
    } finally {
      setBusy(false)
    }
  }

  return (
    <PollCard>
      <PollQuestion>{question}</PollQuestion>
      {answers.map((answer) => {
        const count = voters.get(answer.id)?.length ?? 0
        const pct = totalVoters ? Math.round((count / totalVoters) * 100) : 0
        const selected = mySelected.includes(answer.id)
        return (
          <PollAnswer
            key={answer.id}
            type="button"
            $selected={selected}
            disabled={ended || busy || !userId}
            onClick={() => void vote(answer.id)}
          >
            <PollAnswerBar style={{ width: `${pct}%` }} />
            <PollAnswerText>
              {selected && <CheckOutlined />}
              {answer.text}
            </PollAnswerText>
            <PollAnswerCount>{totalVoters ? `${count} · ${pct}%` : ''}</PollAnswerCount>
          </PollAnswer>
        )
      })}
      <PollFooter>
        <span>
          {ended ? 'Final results' : `${totalVoters} vote${totalVoters === 1 ? '' : 's'}`}
        </span>
        {canEnd && !ended && (
          <Button size="small" type="text" loading={busy} onClick={() => void endThisPoll()}>
            End poll
          </Button>
        )}
      </PollFooter>
    </PollCard>
  )
}
