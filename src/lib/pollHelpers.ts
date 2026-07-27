import { M_POLL_RESPONSE, type MatrixEvent } from 'matrix-js-sdk'

const answerIdsOf = (event: MatrixEvent): string[] => {
  const content = event.getContent()
  const response = content[M_POLL_RESPONSE.name] ?? content[M_POLL_RESPONSE.altName ?? '']
  return Array.isArray(response?.answers) ? response.answers : []
}

// A poll response replaces that sender's previous selection.
export const aggregatePollResponses = (responses: MatrixEvent[], selfUserId?: string | null) => {
  const latestBySender = new Map<string, MatrixEvent>()
  for (const event of responses) {
    const sender = event.getSender()
    if (!sender) continue
    const current = latestBySender.get(sender)
    if (!current || event.getTs() > current.getTs()) latestBySender.set(sender, event)
  }
  const voters = new Map<string, string[]>()
  let mySelected: string[] = []
  for (const [sender, event] of latestBySender) {
    const answerIds = answerIdsOf(event)
    for (const answerId of answerIds) {
      const existing = voters.get(answerId) ?? []
      existing.push(sender)
      voters.set(answerId, existing)
    }
    if (sender === selfUserId) mySelected = answerIds
  }
  return { voters, mySelected }
}

export const textOf = (value: { 'm.text'?: string; body?: string } | undefined): string =>
  value?.['m.text'] ?? value?.body ?? ''
