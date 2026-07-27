export const timestampStyles = ['d', 'D', 't', 'T', 'f', 'F', 's', 'S', 'R'] as const

export type TimestampStyle = (typeof timestampStyles)[number]

export const timestampStyleOptions: Array<{
  value: TimestampStyle
  label: string
}> = [
  { value: 'd', label: 'Short date' },
  { value: 'D', label: 'Long date' },
  { value: 't', label: 'Short time' },
  { value: 'T', label: 'Long time' },
  { value: 'f', label: 'Short date and time' },
  { value: 'F', label: 'Long date and time' },
  { value: 's', label: 'Short date and time (numeric)' },
  { value: 'S', label: 'Long date and time (numeric)' },
  { value: 'R', label: 'Relative time' },
]

export type ParsedTimestamp = {
  raw: string
  seconds: number
  style: TimestampStyle
}

export type TimestampPart = string | ParsedTimestamp

const TIMESTAMP_PATTERN = /<t:(-?\d{1,13})(?::([dDtTfFsSR]))?>/g
const TIMESTAMP_EXACT_PATTERN = /^<t:(-?\d{1,13})(?::([dDtTfFsSR]))?>$/
const INLINE_CODE_PATTERN = /(`+)([\s\S]*?)\1/g
const MAX_DATE_SECONDS = 8_640_000_000_000

const validSeconds = (value: number) =>
  Number.isSafeInteger(value) && Math.abs(value) <= MAX_DATE_SECONDS

export function parseTimestampTag(value: string): ParsedTimestamp | undefined {
  const match = TIMESTAMP_EXACT_PATTERN.exec(value)
  if (!match) return
  const seconds = Number(match[1])
  if (!validSeconds(seconds)) return
  return {
    raw: match[0],
    seconds,
    style: (match[2] || 'f') as TimestampStyle,
  }
}

export function splitTimestamps(text: string): TimestampPart[] {
  const parts: TimestampPart[] = []
  let cursor = 0
  for (const match of text.matchAll(TIMESTAMP_PATTERN)) {
    const index = match.index ?? cursor
    if (index > cursor) parts.push(text.slice(cursor, index))
    const parsed = parseTimestampTag(match[0])
    if (parsed) parts.push(parsed)
    else parts.push(match[0])
    cursor = index + match[0].length
  }
  if (cursor < text.length) parts.push(text.slice(cursor))
  return parts.length ? parts : [text]
}

export function timestampSyntax(date: Date, style: TimestampStyle): string {
  return `<t:${Math.floor(date.getTime() / 1000)}:${style}>`
}

export function timestampDate(seconds: number): Date | undefined {
  if (!validSeconds(seconds)) return
  const date = new Date(seconds * 1000)
  return Number.isNaN(date.getTime()) ? undefined : date
}

function formatRelativeTime(date: Date, now: Date): string {
  const seconds = (date.getTime() - now.getTime()) / 1000
  const absolute = Math.abs(seconds)
  let value: number
  let unit: Intl.RelativeTimeFormatUnit
  if (absolute < 60) {
    value = Math.round(seconds)
    unit = 'second'
  } else if (absolute < 60 * 60) {
    value = Math.round(seconds / 60)
    unit = 'minute'
  } else if (absolute < 24 * 60 * 60) {
    value = Math.round(seconds / (60 * 60))
    unit = 'hour'
  } else if (absolute < 30 * 24 * 60 * 60) {
    value = Math.round(seconds / (24 * 60 * 60))
    unit = 'day'
  } else if (absolute < 365 * 24 * 60 * 60) {
    value = Math.round(seconds / (30 * 24 * 60 * 60))
    unit = 'month'
  } else {
    value = Math.round(seconds / (365 * 24 * 60 * 60))
    unit = 'year'
  }
  return new Intl.RelativeTimeFormat(undefined, { numeric: 'always' }).format(value, unit)
}

export function formatTimestamp(
  seconds: number,
  style: TimestampStyle = 'f',
  now = new Date(),
): string {
  const date = timestampDate(seconds)
  if (!date) return String(seconds)
  if (style === 'R') return formatRelativeTime(date, now)
  const options: Intl.DateTimeFormatOptions =
    style === 'd'
      ? { year: 'numeric', month: '2-digit', day: '2-digit' }
      : style === 'D'
        ? { year: 'numeric', month: 'long', day: 'numeric' }
        : style === 't'
          ? { hour: '2-digit', minute: '2-digit' }
          : style === 'T'
            ? { hour: '2-digit', minute: '2-digit', second: '2-digit' }
            : style === 'f'
              ? {
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                }
              : style === 'F'
                ? {
                    weekday: 'long',
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  }
                : style === 's'
                  ? {
                      year: 'numeric',
                      month: '2-digit',
                      day: '2-digit',
                      hour: '2-digit',
                      minute: '2-digit',
                    }
                  : {
                      year: 'numeric',
                      month: '2-digit',
                      day: '2-digit',
                      hour: '2-digit',
                      minute: '2-digit',
                      second: '2-digit',
                    }
  return new Intl.DateTimeFormat(undefined, options).format(date)
}

export function timestampTitle(seconds: number): string {
  const date = timestampDate(seconds)
  if (!date) return String(seconds)
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'full',
    timeStyle: 'long',
  }).format(date)
}

function replaceTimestampTags(text: string): string {
  return text.replace(TIMESTAMP_PATTERN, (raw) => {
    const parsed = parseTimestampTag(raw)
    return parsed ? `[timestamp](foxchat://timestamp/${parsed.seconds}/${parsed.style})` : raw
  })
}

export function timestampMarkdownLinks(text: string): string {
  let result = ''
  let cursor = 0
  for (const match of text.matchAll(INLINE_CODE_PATTERN)) {
    const index = match.index ?? cursor
    result += replaceTimestampTags(text.slice(cursor, index))
    result += match[0]
    cursor = index + match[0].length
  }
  return result + replaceTimestampTags(text.slice(cursor))
}

export function timestampFromHref(href: string): ParsedTimestamp | undefined {
  const match = /^foxchat:\/\/timestamp\/(-?\d{1,13})\/([dDtTfFsSR])$/.exec(href)
  return match ? parseTimestampTag(`<t:${match[1]}:${match[2]}>`) : undefined
}
