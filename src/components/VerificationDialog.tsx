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
  const verifierListenersRef = useRef<
    | {
        verifier: Verifier
        showSas: (value: ShowSasCallbacks) => void
        cancel: () => void
      }
    | undefined
  >(undefined)
  const startingRef = useRef(false)
  const startWhenReadyRef = useRef(false)
  const unbindVerifier = useCallback(() => {
    const listeners = verifierListenersRef.current
    if (listeners) {
      listeners.verifier.off(VerifierEvent.ShowSas, listeners.showSas)
      listeners.verifier.off(VerifierEvent.Cancel, listeners.cancel)
    }
    verifierListenersRef.current = undefined
    verifierRef.current = undefined
  }, [])
  const bindVerifier = useCallback(
    (verifier: Verifier) => {
      // Rust crypto may reach the SAS comparison state before React receives the verifier.
      // ShowSas is an edge-triggered event, so recover its retained value instead of waiting
      // forever for an event which has already fired.
      if (verifierRef.current === verifier) {
        const retainedSas = verifier.getShowSasCallbacks()
        if (retainedSas) setSas(retainedSas)
        return
      }
      unbindVerifier()
      verifierRef.current = verifier
      setSas(undefined)
      const showSas = (value: ShowSasCallbacks) => setSas(value)
      const cancel = () => refresh((x) => x + 1)
      verifierListenersRef.current = { verifier, showSas, cancel }
      verifier.on(VerifierEvent.ShowSas, showSas)
      verifier.on(VerifierEvent.Cancel, cancel)
      const retainedSas = verifier.getShowSasCallbacks()
      if (retainedSas) setSas(retainedSas)
      void verifier
        .verify()
        .then(() => refresh((x) => x + 1))
        .catch((e) => message.error(e instanceof Error ? e.message : 'Verification cancelled'))
    },
    [message, unbindVerifier],
  )
  const startReadyVerifier = useCallback(async () => {
    if (request.verifier) {
      bindVerifier(request.verifier)
      return
    }
    if (
      request.phase !== VerificationPhase.Ready ||
      !startWhenReadyRef.current ||
      startingRef.current
    )
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
    startWhenReadyRef.current = false
  }, [request])
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
      unbindVerifier()
    }
  }, [request, bindVerifier, startReadyVerifier, unbindVerifier])
  const proceed = async () => {
    // A to-device request has no initiator until one side sends m.key.verification.start.
    // Remember that the user chose this device even if accept() resolves before Ready.
    startWhenReadyRef.current = true
    setWorking(true)
    try {
      if (!request.initiatedByMe && request.phase === VerificationPhase.Requested)
        await request.accept()
      if (request.verifier) bindVerifier(request.verifier)
      else await startReadyVerifier()
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
          data-testid="verification-sas"
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
              <small data-testid="verification-sas-label">{name}</small>
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
