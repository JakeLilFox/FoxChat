import { M_POLL_RESPONSE, MatrixEvent } from 'matrix-js-sdk'
import { describe, expect, it } from 'vitest'
import { aggregatePollResponses, textOf } from '../../src/lib/pollHelpers'

const response = (sender: string | undefined, timestamp: number, answers: string[]) =>
  new MatrixEvent({
    type: M_POLL_RESPONSE.name,
    sender,
    origin_server_ts: timestamp,
    content: { [M_POLL_RESPONSE.name]: { answers } },
  })

describe('poll response aggregation', () => {
  it("counts only each sender's newest complete selection", () => {
    const result = aggregatePollResponses(
      [
        response('@alice:example.org', 10, ['one']),
        response('@bob:example.org', 20, ['one', 'two']),
        response('@alice:example.org', 30, ['two']),
      ],
      '@alice:example.org',
    )

    expect(result.voters.get('one')).toEqual(['@bob:example.org'])
    expect(result.voters.get('two')?.sort()).toEqual(['@alice:example.org', '@bob:example.org'])
    expect(result.mySelected).toEqual(['two'])
  })

  it('ignores senderless responses and accepts an empty replacement vote', () => {
    const result = aggregatePollResponses(
      [
        response(undefined, 30, ['one']),
        response('@alice:example.org', 10, ['one']),
        response('@alice:example.org', 20, []),
      ],
      '@alice:example.org',
    )

    expect(result.voters.size).toBe(0)
    expect(result.mySelected).toEqual([])
  })

  it('prefers extensible-event text and falls back to body', () => {
    expect(textOf({ 'm.text': 'New text', body: 'Legacy text' })).toBe('New text')
    expect(textOf({ body: 'Legacy text' })).toBe('Legacy text')
    expect(textOf(undefined)).toBe('')
  })
})
