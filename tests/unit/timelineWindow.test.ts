// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'
import {
  addedVisibleEventCount,
  initialTimelinePosition,
  nextFollowLatest,
  shouldHandleTimelineGrowth,
  shouldFollowAddedEvents,
  visibleReadBoundary,
} from '../../src/lib/timelineWindow'
import { fakeEvent } from './support/fakeMatrix'

describe('addedVisibleEventCount', () => {
  it('does not treat a local-echo ID acknowledgement as a new event', () => {
    expect(addedVisibleEventCount(3, 3)).toBe(0)
  })

  it('counts genuinely added visible events', () => {
    expect(addedVisibleEventCount(3, 4)).toBe(1)
    expect(addedVisibleEventCount(3, 6)).toBe(3)
  })

  it('does not move the window when events are removed', () => {
    expect(addedVisibleEventCount(4, 3)).toBe(0)
  })
})

describe('shouldHandleTimelineGrowth', () => {
  it('handles older encrypted messages becoming visible after the newest one', () => {
    expect(shouldHandleTimelineGrowth(false, 39)).toBe(true)
  })

  it('does nothing when neither the newest event nor visible count changed', () => {
    expect(shouldHandleTimelineGrowth(false, 0)).toBe(false)
  })
})

describe('nextFollowLatest', () => {
  it('keeps following through layout-driven scroll events while encrypted messages appear', () => {
    expect(nextFollowLatest(true, false, false)).toBe(true)
  })

  it('stops following when the user intentionally scrolls away', () => {
    expect(nextFollowLatest(true, false, true)).toBe(false)
  })

  it('resumes following when the viewport reaches the bottom', () => {
    expect(nextFollowLatest(false, true, true)).toBe(true)
  })
})

describe('shouldFollowAddedEvents', () => {
  it('follows a new event when the rendered timeline is at the bottom despite a stale flag', () => {
    expect(shouldFollowAddedEvents(false, 0, 0, 64)).toBe(true)
  })

  it('does not follow from the bottom of an older detached window', () => {
    expect(shouldFollowAddedEvents(true, 2, 0, 64)).toBe(false)
  })

  it('does not follow while the user is away from the bottom', () => {
    expect(shouldFollowAddedEvents(false, 0, 200, 64)).toBe(false)
  })
})

describe('visibleReadBoundary', () => {
  const message = fakeEvent({
    id: '$message',
    sender: '@remote:example.org',
    ts: 10,
  })
  const notifyingState = fakeEvent({
    id: '$state',
    sender: '@remote:example.org',
    type: 'org.matrix.msc3401.call.member',
    ts: 20,
    notify: true,
  })

  it('advances through a notifying state event when the room is at the live edge', () => {
    expect(visibleReadBoundary([message, notifyingState], '$message', true)?.getId()).toBe('$state')
  })

  it('stops at the last visible message while the user is scrolled up', () => {
    expect(visibleReadBoundary([message, notifyingState], '$message', false)?.getId()).toBe(
      '$message',
    )
  })
})

describe('initialTimelinePosition', () => {
  it('lands at the bottom when the unread counter is clear but the receipt echo is stale', () => {
    const events = Array.from({ length: 50 }, (_, index) =>
      fakeEvent({
        id: `$${index + 1}`,
        sender: '@remote:example.org',
      }),
    )

    expect(initialTimelinePosition(events, '$10', 0, new Set(['@selected:example.org']))).toEqual({
      unreadStart: undefined,
      windowEndOffset: 0,
    })
  })

  it('uses the selected account receipt instead of another account unread state', () => {
    const events = Array.from({ length: 50 }, (_, index) =>
      fakeEvent({
        id: `$${index + 1}`,
        sender: '@remote:example.org',
      }),
    )
    const ownUserIds = new Set(['@selected:example.org', '@other-account:example.org'])

    expect(initialTimelinePosition(events, '$50', 0, ownUserIds)).toEqual({
      unreadStart: undefined,
      windowEndOffset: 0,
    })
    expect(initialTimelinePosition(events, '$10', 40, ownUserIds)).toEqual({
      unreadStart: '$11',
      windowEndOffset: 0,
    })
  })

  it('skips unread messages sent by another one of the user accounts', () => {
    const events = [
      fakeEvent({ id: '$1', sender: '@other-account:example.org' }),
      fakeEvent({ id: '$2', sender: '@remote:example.org' }),
    ]

    expect(
      initialTimelinePosition(
        events,
        undefined,
        2,
        new Set(['@selected:example.org', '@other-account:example.org']),
      ).unreadStart,
    ).toBe('$2')
  })

  it('keeps following when an initially empty room receives messages during positioning', () => {
    const events = Array.from({ length: 41 }, (_, index) =>
      fakeEvent({
        id: `$${index + 1}`,
        sender: '@remote:example.org',
      }),
    )

    expect(
      initialTimelinePosition(events, undefined, 41, new Set(['@selected:example.org']), null),
    ).toEqual({
      unreadStart: undefined,
      windowEndOffset: 0,
    })
  })
})
