import { describe, expect, it } from 'vitest'
import { preprocessMarkdown } from '../../src/lib/markdownPreprocess'
import {
  formatTimestamp,
  parseTimestampTag,
  splitTimestamps,
  timestampFromHref,
  timestampSyntax,
} from '../../src/lib/timestamps'

describe('message timestamps', () => {
  it('parses explicit and default timestamp styles', () => {
    expect(parseTimestampTag('<t:1785142440:F>')).toEqual({
      raw: '<t:1785142440:F>',
      seconds: 1785142440,
      style: 'F',
    })
    expect(parseTimestampTag('<t:1785142440>')?.style).toBe('f')
    expect(parseTimestampTag('<t:1785142440:x>')).toBeUndefined()
    expect(parseTimestampTag('<t:not-a-time:F>')).toBeUndefined()
  })

  it('splits timestamps out of surrounding message text', () => {
    expect(splitTimestamps('Starts <t:1785142440:R> in the lobby')).toEqual([
      'Starts ',
      {
        raw: '<t:1785142440:R>',
        seconds: 1785142440,
        style: 'R',
      },
      ' in the lobby',
    ])
  })

  it('creates syntax from a date and reads its internal link', () => {
    const date = new Date('2026-07-27T08:54:00.000Z')
    const syntax = timestampSyntax(date, 'T')
    expect(syntax).toBe('<t:1785142440:T>')
    expect(timestampFromHref('foxchat://timestamp/1785142440/T')?.raw).toBe(syntax)
  })

  it('converts message timestamps before Markdown parses them', () => {
    expect(preprocessMarkdown('Meet <t:1785142440:F>')).toContain(
      '[timestamp](foxchat://timestamp/1785142440/F)',
    )
    expect(preprocessMarkdown('`<t:1785142440:F>`')).toBe('`<t:1785142440:F>`')
    expect(preprocessMarkdown('```\n<t:1785142440:F>\n```')).toBe('```\n<t:1785142440:F>\n```')
  })

  it('formats absolute and relative timestamps for the local viewer', () => {
    const now = new Date('2026-07-27T08:00:00.000Z')
    expect(formatTimestamp(1785142440, 'F', now)).not.toBe('1785142440')
    expect(formatTimestamp(Math.floor(now.getTime() / 1000) + 3600, 'R', now)).not.toBe('')
  })
})
