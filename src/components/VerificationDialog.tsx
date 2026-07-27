import { useCallback, useEffect, useRef, useState } from 'react'
import { Button, Modal, App as AntApp } from 'antd'
import { CheckOutlined } from '@ant-design/icons'
import {
  VerificationPhase,
  VerificationRequestEvent,
  VerifierEvent,
  type ShowSasCallbacks,
  type VerificationRequest,
  type Verifier,
} from 'matrix-js-sdk/lib/crypto-api'

export function VerificationDialog({
  request,
  onClose,
}: {
  request: VerificationRequest
  onClose: () => void
}) {
  const { message } = AntApp.useApp()
  const [, refresh] = useState(0)
  const [sas, setSas] = useState<ShowSasCallbacks>()
  const [working, setWorking] = useState(false)
  const verifierRef = useRef<Verifier | undefined>(undefined)
  const startingRef = useRef(false)
  const bindVerifier = useCallback(
    (verifier: Verifier) => {
      if (verifierRef.current === verifier) return
      verifierRef.current = verifier
      verifier.on(VerifierEvent.ShowSas, (value) => setSas(value))
      verifier.on(VerifierEvent.Cancel, () => refresh((x) => x + 1))
      void verifier
        .verify()
        .then(() => refresh((x) => x + 1))
        .catch((e) => message.error(e instanceof Error ? e.message : 'Verification cancelled'))
    },
    [message],
  )
  const startReadyVerifier = useCallback(async () => {
    if (request.verifier) {
      bindVerifier(request.verifier)
      return
    }
    if (request.phase !== VerificationPhase.Ready || !request.initiatedByMe || startingRef.current)
      return
    startingRef.current = true
    setWorking(true)
    try {
      bindVerifier(await request.startVerification('m.sas.v1'))
    } catch (e) {
      message.error(e instanceof Error ? e.message : 'Could not start verification')
    } finally {
      startingRef.current = false
      setWorking(false)
    }
  }, [request, bindVerifier, message])
  useEffect(() => {
    const changed = () => {
      refresh((x) => x + 1)
      if (request.verifier) bindVerifier(request.verifier)
      else void startReadyVerifier()
    }
    request.on(VerificationRequestEvent.Change, changed)
    changed()
    return () => {
      request.off(VerificationRequestEvent.Change, changed)
    }
  }, [request, bindVerifier, startReadyVerifier])
  const proceed = async () => {
    setWorking(true)
    try {
      if (!request.initiatedByMe && request.phase === VerificationPhase.Requested)
        await request.accept()
      if (request.verifier) bindVerifier(request.verifier)
      else if (request.phase === VerificationPhase.Ready)
        bindVerifier(await request.startVerification('m.sas.v1'))
    } catch (e) {
      message.error(e instanceof Error ? e.message : 'Could not start verification')
    } finally {
      setWorking(false)
    }
  }
  const done = request.phase === VerificationPhase.Done
  const cancelled = request.phase === VerificationPhase.Cancelled
  return (
    <Modal
      title="Verify another device"
      open
      footer={null}
      onCancel={() => {
        if (request.pending) void request.cancel()
        onClose()
      }}
    >
      <p>
        Compare the symbols below with the ones shown on your other Matrix device. They must appear
        in the same order.
      </p>
      {sas?.sas.emoji && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(4,1fr)',
            gap: 10,
            margin: '20px 0',
          }}
        >
          {sas.sas.emoji.map(([emoji, name]) => (
            <div
              key={name}
              style={{
                textAlign: 'center',
                padding: 8,
                border: '1px solid #ddd',
                borderRadius: 10,
              }}
            >
              <div style={{ fontSize: 28 }}>{emoji}</div>
              <small>{name}</small>
            </div>
          ))}
        </div>
      )}
      {sas?.sas.decimal && !sas.sas.emoji && (
        <h2 style={{ textAlign: 'center', letterSpacing: 4 }}>{sas.sas.decimal.join(' · ')}</h2>
      )}
      {done ? (
        <>
          <p>
            <CheckOutlined style={{ color: '#35c978' }} /> Device verification completed.
          </p>
          <Button type="primary" block onClick={onClose}>
            Done
          </Button>
        </>
      ) : cancelled ? (
        <>
          <p>Verification was cancelled.</p>
          <Button block onClick={onClose}>
            Close
          </Button>
        </>
      ) : sas ? (
        <div style={{ display: 'flex', gap: 8 }}>
          <Button danger block onClick={() => sas.mismatch()}>
            They don’t match
          </Button>
          <Button type="primary" block onClick={() => void sas.confirm()}>
            They match
          </Button>
        </div>
      ) : (
        <Button type="primary" block loading={working} onClick={() => void proceed()}>
          {request.initiatedByMe
            ? 'Waiting / continue verification'
            : 'Accept verification request'}
        </Button>
      )}
    </Modal>
  )
}
