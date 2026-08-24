import { useState } from 'react'
import { Button, Form, Input, Modal, App as AntApp } from 'antd'
import { CopyOutlined, LockOutlined, SafetyCertificateOutlined } from '@ant-design/icons'
import { MatrixError } from 'matrix-js-sdk'
import { matrixService } from '../matrix/MatrixClientService'

type Step = 'intro' | 'setup' | 'password' | 'done'

export function WelcomeDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { message } = AntApp.useApp()
  const [step, setStep] = useState<Step>('intro')
  const [passphrase, setPassphrase] = useState('')
  const [passphraseConfirm, setPassphraseConfirm] = useState('')
  const [accountPassword, setAccountPassword] = useState('')
  const [uiaSession, setUiaSession] = useState<string>()
  const [recoveryKey, setRecoveryKey] = useState('')
  const [busy, setBusy] = useState(false)

  const reset = () => {
    setStep('intro')
    setPassphrase('')
    setPassphraseConfirm('')
    setAccountPassword('')
    setUiaSession(undefined)
    setRecoveryKey('')
    setBusy(false)
  }

  const close = () => {
    reset()
    onClose()
  }

  const skip = () => close()

  const setup = async () => {
    if (passphrase !== passphraseConfirm) {
      message.error('The passphrases do not match')
      return
    }
    setBusy(true)
    try {
      const result = await matrixService.setupKeyBackup(
        passphrase || undefined,
        accountPassword || undefined,
        uiaSession,
      )
      setRecoveryKey(result.recoveryKey)
      setStep('done')
    } catch (error) {
      if (error instanceof MatrixError && typeof error.data?.session === 'string') {
        setUiaSession(error.data.session)
        setStep('password')
      } else {
        message.error(error instanceof Error ? error.message : 'Could not set up encrypted backup')
      }
    } finally {
      setBusy(false)
    }
  }

  const copyRecoveryKey = async () => {
    try {
      await navigator.clipboard.writeText(recoveryKey)
      message.success('Recovery key copied')
    } catch {
      message.error('Could not copy the recovery key')
    }
  }

  return (
    <Modal
      data-testid="welcome-dialog"
      title="Welcome to Matrix"
      open={open}
      maskClosable={false}
      closable={step === 'intro'}
      footer={null}
      width={520}
      onCancel={step === 'intro' ? skip : undefined}
    >
      {step === 'intro' && (
        <>
          <p>
            Your messages are end-to-end encrypted. The keys that unlock them are generated and kept
            on your own devices, never on the homeserver, and never seen by FoxChat.
          </p>
          <p>
            <SafetyCertificateOutlined style={{ marginRight: 6 }} />
            This device is automatically trusted: it's the one creating your account's identity, so
            nothing extra is needed to verify it right now. When you sign in on another phone or
            computer later, verify it from{' '}
            <strong>Settings → Security → Verify with another device</strong>.
          </p>
          <p>
            If you lose every device at once, encrypted history can only be recovered with a
            <strong> recovery key</strong>. You can set one up now, optionally protected by a
            passphrase you choose or skip this and do it later from Settings → Security.
          </p>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 20 }}>
            <Button onClick={skip}>Skip for now</Button>
            <Button type="primary" icon={<LockOutlined />} onClick={() => setStep('setup')}>
              Set up recovery key
            </Button>
          </div>
        </>
      )}
      {step === 'setup' && (
        <Form layout="vertical">
          <p>
            A passphrase is optional; the recovery key shown after setup always works on its own.
          </p>
          <Form.Item label="Passphrase (optional)">
            <Input.Password
              value={passphrase}
              onChange={(event) => setPassphrase(event.target.value)}
              placeholder="Leave blank to use only a recovery key"
              autoFocus
            />
          </Form.Item>
          <Form.Item
            label="Confirm passphrase"
            validateStatus={
              passphraseConfirm && passphrase !== passphraseConfirm ? 'error' : undefined
            }
            help={
              passphraseConfirm && passphrase !== passphraseConfirm
                ? 'The passphrases do not match'
                : undefined
            }
          >
            <Input.Password
              value={passphraseConfirm}
              disabled={!passphrase}
              onChange={(event) => setPassphraseConfirm(event.target.value)}
              onPressEnter={() => void setup()}
              placeholder="Enter the passphrase again"
            />
          </Form.Item>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
            <Button onClick={skip} disabled={busy}>
              Skip for now
            </Button>
            <Button type="primary" loading={busy} onClick={() => void setup()}>
              Set up backup
            </Button>
          </div>
        </Form>
      )}
      {step === 'password' && (
        <Form layout="vertical">
          <p>
            This account has no cross-signing keys yet. Confirm your account password to create them
            and finish setting up encrypted backup.
          </p>
          <Form.Item label="Account password">
            <Input.Password
              value={accountPassword}
              onChange={(event) => setAccountPassword(event.target.value)}
              onPressEnter={() => void setup()}
              placeholder="Your account password"
              autoFocus
            />
          </Form.Item>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
            <Button onClick={skip} disabled={busy}>
              Skip for now
            </Button>
            <Button
              type="primary"
              loading={busy}
              disabled={!accountPassword}
              onClick={() => void setup()}
            >
              Confirm password
            </Button>
          </div>
        </Form>
      )}
      {step === 'done' && (
        <>
          <p>
            Keep this recovery key somewhere safe and separate from this device. You will need it to
            restore encrypted messages if you lose access to your devices.
          </p>
          <Input.TextArea
            value={recoveryKey}
            readOnly
            autoSize={{ minRows: 2 }}
            style={{ fontFamily: 'monospace' }}
          />
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
            <Button icon={<CopyOutlined />} onClick={() => void copyRecoveryKey()}>
              Copy recovery key
            </Button>
            <Button type="primary" onClick={close}>
              I've saved it
            </Button>
          </div>
        </>
      )}
    </Modal>
  )
}
