// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'
import {
  isSameLocalDay,
  MESSAGE_GROUP_MAX_GAP_MS,
  shouldShowTimelineDateHint,
  shouldGroupMessages,
  timelineDateTime,
} from '../../src/lib/timelinePresentation'
import { fakeEvent } from './support/fakeMatrix'

const message = (id: string, sender: string, timestamp: number) =>
  fakeEvent({ id, sender, ts: timestamp })

describe('timeline presentation', () => {
  it('groups messages from the same sender up to and including five minutes apart', () => {
    const timestamp = new Date(2026, 6, 30, 12).getTime()
    const first = message('$first', '@alice:example.org', timestamp)

    expect(
      shouldGroupMessages(
        first,
        message('$at-cutoff', '@alice:example.org', timestamp + MESSAGE_GROUP_MAX_GAP_MS),
      ),
    ).toBe(true)
    expect(
      shouldGroupMessages(
        first,
        message('$after-cutoff', '@alice:example.org', timestamp + MESSAGE_GROUP_MAX_GAP_MS + 1),
      ),
    ).toBe(false)
    expect(
      shouldGroupMessages(first, message('$different-sender', '@bob:example.org', timestamp + 1)),
    ).toBe(false)
  })

  it('breaks a message group at midnight in the viewer local timezone', () => {
    const beforeMidnight = new Date(2026, 6, 30, 23, 59).getTime()
    const afterMidnight = new Date(2026, 6, 31, 0, 1).getTime()

    expect(isSameLocalDay(beforeMidnight, afterMidnight)).toBe(false)
    expect(
      shouldGroupMessages(
        message('$before', '@alice:example.org', beforeMidnight),
        message('$after', '@alice:example.org', afterMidnight),
      ),
    ).toBe(false)
    expect(timelineDateTime(afterMidnight)).toBe('2026-07-31')
  })

  it('shows the floating date hint only for an older day without a visible separator', () => {
    const now = new Date(2026, 6, 30, 12).getTime()
    const yesterday = new Date(2026, 6, 29, 12).getTime()

    expect(shouldShowTimelineDateHint(yesterday, false, now)).toBe(true)
    expect(shouldShowTimelineDateHint(yesterday, true, now)).toBe(false)
    expect(shouldShowTimelineDateHint(now, false, now)).toBe(false)
  })
})
