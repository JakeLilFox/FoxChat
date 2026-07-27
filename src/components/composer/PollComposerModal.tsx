import { useState } from 'react'
import { Button, Input, InputNumber, Modal, Switch, App as AntApp } from 'antd'
import { CloseOutlined, PlusOutlined } from '@ant-design/icons'
import { matrixService } from '../../matrix/MatrixClientService'

export function PollComposerModal({
  open,
  roomId,
  accountId,
  onClose,
}: {
  open: boolean
  roomId: string
  accountId?: string
  onClose: () => void
}) {
  const { message } = AntApp.useApp()
  const [question, setQuestion] = useState('')
  const [answers, setAnswers] = useState(['', ''])
  const [disclosed, setDisclosed] = useState(true)
  const [maxSelections, setMaxSelections] = useState(1)
  const [busy, setBusy] = useState(false)

  const reset = () => {
    setQuestion('')
    setAnswers(['', ''])
    setDisclosed(true)
    setMaxSelections(1)
  }

  const validAnswers = answers.map((answer) => answer.trim()).filter(Boolean)
  const canSubmit = question.trim().length > 0 && validAnswers.length >= 2

  const submit = async () => {
    if (!canSubmit || !accountId) return
    setBusy(true)
    try {
      await matrixService.sendPoll(roomId, accountId, question.trim(), validAnswers, {
        disclosed,
        maxSelections,
      })
      reset()
      onClose()
    } catch (error) {
      message.error(error instanceof Error ? error.message : 'Could not create the poll')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title="Create a poll" open={open} onCancel={onClose} footer={null}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <Input
          autoFocus
          placeholder="Ask a question"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
        />
        {answers.map((answer, index) => (
          <div key={index} style={{ display: 'flex', gap: 8 }}>
            <Input
              placeholder={`Option ${index + 1}`}
              value={answer}
              onChange={(e) =>
                setAnswers((current) =>
                  current.map((value, i) => (i === index ? e.target.value : value)),
                )
              }
            />
            {answers.length > 2 && (
              <Button
                icon={<CloseOutlined />}
                onClick={() => setAnswers((current) => current.filter((_, i) => i !== index))}
              />
            )}
          </div>
        ))}
        {answers.length < 20 && (
          <Button icon={<PlusOutlined />} onClick={() => setAnswers((current) => [...current, ''])}>
            Add option
          </Button>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Switch checked={disclosed} onChange={setDisclosed} />
          <span>
            {disclosed ? 'Show results before the poll ends' : 'Hide results until the poll ends'}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span>Max answers per person</span>
          <InputNumber
            min={1}
            max={Math.max(2, validAnswers.length || 2)}
            value={maxSelections}
            onChange={(value) => setMaxSelections(value ?? 1)}
          />
        </div>
        <Button
          block
          type="primary"
          loading={busy}
          disabled={!canSubmit}
          onClick={() => void submit()}
        >
          Create poll
        </Button>
      </div>
    </Modal>
  )
}
