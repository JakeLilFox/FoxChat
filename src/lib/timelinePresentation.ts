import type { MatrixEvent } from 'matrix-js-sdk'
import { isVisibleMessageEvent } from './eventHelpers'

export const MESSAGE_GROUP_MAX_GAP_MS = 5 * 60 * 1000

const localDateParts = (timestamp: number) => {
  const date = new Date(timestamp)
  return {
    year: date.getFullYear(),
    month: date.getMonth(),
    day: date.getDate(),
  }
}

export const isSameLocalDay = (firstTimestamp: number, secondTimestamp: number) => {
  const first = localDateParts(firstTimestamp)
  const second = localDateParts(secondTimestamp)
  return first.year === second.year && first.month === second.month && first.day === second.day
}

export const shouldGroupMessages = (first: MatrixEvent, second: MatrixEvent) =>
  isVisibleMessageEvent(first) &&
  isVisibleMessageEvent(second) &&
  first.getSender() === second.getSender() &&
  isSameLocalDay(first.getTs(), second.getTs()) &&
  Math.abs(second.getTs() - first.getTs()) <= MESSAGE_GROUP_MAX_GAP_MS

export const timelineDateLabel = (timestamp: number) =>
  new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(new Date(timestamp))

export const timelineDateTime = (timestamp: number) => {
  const { year, month, day } = localDateParts(timestamp)
  return `${String(year).padStart(4, '0')}-${String(month + 1).padStart(2, '0')}-${String(
    day,
  ).padStart(2, '0')}`
}

export const shouldShowTimelineDateHint = (
  visibleTimestamp: number,
  separatorVisible: boolean,
  now = Date.now(),
) =>
  Number.isFinite(visibleTimestamp) && !separatorVisible && !isSameLocalDay(visibleTimestamp, now)
