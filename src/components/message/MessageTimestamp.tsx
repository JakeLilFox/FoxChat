import { useEffect, useState } from 'react'
import {
  formatTimestamp,
  timestampDate,
  timestampTitle,
  type TimestampStyle,
} from '../../lib/timestamps'

export function MessageTimestamp({
  seconds,
  style = 'f',
}: {
  seconds: number
  style?: TimestampStyle
}) {
  const [, refresh] = useState(0)
  const date = timestampDate(seconds)

  useEffect(() => {
    if (style !== 'R' || !date) return
    const timer = window.setInterval(() => refresh((value) => value + 1), 30_000)
    return () => window.clearInterval(timer)
  }, [date, style])

  if (!date) return <>{seconds}</>
  return (
    <time
      className="foxchat-timestamp"
      dateTime={date.toISOString()}
      title={timestampTitle(seconds)}
      data-timestamp-seconds={seconds}
      data-timestamp-style={style}
    >
      {formatTimestamp(seconds, style)}
    </time>
  )
}
