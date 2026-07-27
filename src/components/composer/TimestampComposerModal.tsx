import { useEffect, useMemo, useState } from 'react'
import { Button, Input, Modal, Select } from 'antd'
import { ClockCircleOutlined } from '@ant-design/icons'
import { timestampStyleOptions, timestampSyntax, type TimestampStyle } from '../../lib/timestamps'
import { MessageTimestamp } from '../message/MessageTimestamp'

const localInputValue = (date: Date) => {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 19)
}

export function TimestampComposerModal({
  open,
  onClose,
  onInsert,
}: {
  open: boolean
  onClose: () => void
  onInsert: (syntax: string) => void
}) {
  const [dateTime, setDateTime] = useState(() => localInputValue(new Date()))
  const [style, setStyle] = useState<TimestampStyle>('F')

  useEffect(() => {
    if (open) setDateTime(localInputValue(new Date()))
  }, [open])

  const date = useMemo(() => new Date(dateTime), [dateTime])
  const valid = !Number.isNaN(date.getTime())
  const syntax = valid ? timestampSyntax(date, style) : ''
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone

  const insert = () => {
    if (!syntax) return
    onInsert(syntax)
    onClose()
  }

  return (
    <Modal
      title={
        <span>
          <ClockCircleOutlined /> Create timestamp
        </span>
      }
      open={open}
      onCancel={onClose}
      footer={[
        <Button key="now" onClick={() => setDateTime(localInputValue(new Date()))}>
          Set to now
        </Button>,
        <Button key="cancel" onClick={onClose}>
          Cancel
        </Button>,
        <Button key="insert" type="primary" disabled={!valid} onClick={insert}>
          Insert timestamp
        </Button>,
      ]}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span>Date and time</span>
          <Input
            type="datetime-local"
            step={1}
            value={dateTime}
            aria-label="Timestamp date and time"
            onChange={(event) => setDateTime(event.target.value)}
          />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span>Display format</span>
          <Select
            value={style}
            options={timestampStyleOptions}
            aria-label="Timestamp display format"
            onChange={setStyle}
          />
        </label>
        <div
          style={{
            padding: 14,
            border: '1px solid rgba(127, 127, 127, 0.3)',
            borderRadius: 10,
          }}
        >
          <div style={{ marginBottom: 8, fontSize: 12, opacity: 0.7 }}>Preview</div>
          {valid ? (
            <>
              <div style={{ marginBottom: 8, fontSize: 16 }}>
                <MessageTimestamp seconds={Math.floor(date.getTime() / 1000)} style={style} />
              </div>
              <code style={{ userSelect: 'all' }}>{syntax}</code>
            </>
          ) : (
            <span>Choose a valid date and time.</span>
          )}
        </div>
        <small style={{ opacity: 0.7 }}>
          The selected time uses {timezone || 'your device timezone'}. Everyone sees it in their own
          local time.
        </small>
      </div>
    </Modal>
  )
}
