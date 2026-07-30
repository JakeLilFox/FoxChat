// @vitest-environment jsdom

import { EventType, HistoryVisibility, MatrixEvent, type Room } from 'matrix-js-sdk'
import { DecryptionFailureCode } from 'matrix-js-sdk/lib/crypto-api'
import { describe, expect, it } from 'vitest'
import {
  eventBody,
  isMembershipChange,
  isPreJoinHistoryUnavailable,
  isVisibleMessageEvent,
} from '../../src/lib/eventHelpers'
import { formatFileSize } from '../../src/lib/format'
import { firstPreviewUrl, matrixUserIdFromHref } from '../../src/lib/messageText'

const event = (
  type: string,
  content: Record<string, unknown>,
  unsigned?: Record<string, unknown>,
) =>
  new MatrixEvent({
    type,
    content,
    unsigned,
    sender: '@alice:example.org',
    origin_server_ts: 1,
  })

describe('content presentation helpers', () => {
  it.each([
    [Number.NaN, '0 B'],
    [-1, '0 B'],
    [0, '0 B'],
    [999, '999 B'],
    [1024, '1.0 KB'],
    [10 * 1024, '10 KB'],
    [1536 * 1024, '1.5 MB'],
    [1024 ** 5, '1024 TB'],
  ])('formats %s bytes as %s', (bytes, formatted) => {
    expect(formatFileSize(bytes as number)).toBe(formatted)
  })

  it('extracts only Matrix user links from matrix.to URLs', () => {
    expect(matrixUserIdFromHref('https://matrix.to/#/@alice:example.org')).toBe(
      '@alice:example.org',
    )
    expect(matrixUserIdFromHref('https://matrix.to/#/%40alice%3Aexample.org?via=example.org')).toBe(
      '@alice:example.org',
    )
    expect(matrixUserIdFromHref('https://matrix.to/#/!room:example.org')).toBeUndefined()
    expect(matrixUserIdFromHref('https://matrix.example/#/@alice:example.org')).toBeUndefined()
    expect(matrixUserIdFromHref('not a URL')).toBeUndefined()
  })

  it('finds the first preview URL and trims sentence punctuation', () => {
    expect(
      firstPreviewUrl('Read https://example.org/docs?q=matrix, then https://other.test.'),
    ).toBe('https://example.org/docs?q=matrix')
    expect(firstPreviewUrl('No link here')).toBeUndefined()
  })

  it('labels common message bodies and unsupported events', () => {
    expect(eventBody(event(EventType.RoomMessage, { msgtype: 'm.text', body: 'Hi' }))).toBe('Hi')
    expect(
      eventBody(
        event(EventType.RoomMessage, {
          msgtype: 'm.file',
          body: 'report.pdf',
        }),
      ),
    ).toContain('report.pdf')
    expect(eventBody(event(EventType.RoomMessage, {}))).toContain('Unsupported message')
  })

  it('hides edits and redactions from the visible-message stream', () => {
    const normal = event(EventType.RoomMessage, {
      msgtype: 'm.text',
      body: 'Visible',
    })
    const edit = event(EventType.RoomMessage, {
      msgtype: 'm.text',
      body: 'Replacement',
      'm.relates_to': { rel_type: 'm.replace' },
    })
    const redacted = event(
      EventType.RoomMessage,
      { msgtype: 'm.text', body: 'Removed' },
      { redacted_because: { type: EventType.RoomRedaction } },
    )

    expect(isVisibleMessageEvent(normal)).toBe(true)
    expect(isVisibleMessageEvent(edit)).toBe(false)
    expect(isVisibleMessageEvent(redacted)).toBe(false)
  })

  it('detects join and leave membership transitions only', () => {
    const joined = new MatrixEvent({
      type: EventType.RoomMember,
      state_key: '@alice:example.org',
      sender: '@alice:example.org',
      content: { membership: 'join' },
      unsigned: { prev_content: { membership: 'invite' } },
    })
    const unchanged = new MatrixEvent({
      type: EventType.RoomMember,
      state_key: '@alice:example.org',
      sender: '@alice:example.org',
      content: { membership: 'join', displayname: 'New name' },
      unsigned: { prev_content: { membership: 'join' } },
    })

    expect(isMembershipChange(joined)).toBe(true)
    expect(isMembershipChange(unchanged)).toBe(false)
  })

  it('recognizes failed history from before the user joined a joined-history room', () => {
    const userId = '@me:example.org'
    const message = event(EventType.RoomMessageEncrypted, {})
    message.event.origin_server_ts = 1_000
    const membership = event(EventType.RoomMember, { membership: 'join' })
    membership.event.origin_server_ts = 2_000
    const room = {
      getHistoryVisibility: () => HistoryVisibility.Joined,
      currentState: {
        getStateEvents: (type: string, stateKey: string) =>
          type === EventType.RoomMember && stateKey === userId ? membership : undefined,
      },
    } as unknown as Room

    expect(isPreJoinHistoryUnavailable(message, room, userId)).toBe(true)
  })

  it('uses the exact crypto failure reason when cached membership timing is unavailable', () => {
    const message = event(EventType.RoomMessageEncrypted, {})
    Object.defineProperty(message, 'decryptionFailureReason', {
      value: DecryptionFailureCode.HISTORICAL_MESSAGE_USER_NOT_JOINED,
    })

    expect(isPreJoinHistoryUnavailable(message, undefined, undefined)).toBe(true)
  })

  it('does not confuse other missing-key failures with unavailable pre-join history', () => {
    const userId = '@me:example.org'
    const beforeJoin = event(EventType.RoomMessageEncrypted, {})
    beforeJoin.event.origin_server_ts = 1_000
    const afterJoin = event(EventType.RoomMessageEncrypted, {})
    afterJoin.event.origin_server_ts = 3_000
    const membership = event(EventType.RoomMember, { membership: 'join' })
    membership.event.origin_server_ts = 2_000
    const room = (visibility: HistoryVisibility) =>
      ({
        getHistoryVisibility: () => visibility,
        currentState: { getStateEvents: () => membership },
      }) as unknown as Room

    expect(isPreJoinHistoryUnavailable(beforeJoin, room(HistoryVisibility.Shared), userId)).toBe(
      false,
    )
    expect(isPreJoinHistoryUnavailable(afterJoin, room(HistoryVisibility.Joined), userId)).toBe(
      false,
    )
    expect(isPreJoinHistoryUnavailable(beforeJoin, room(HistoryVisibility.Joined), undefined)).toBe(
      false,
    )
  })
})
