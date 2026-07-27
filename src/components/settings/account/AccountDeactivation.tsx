import { matrixService } from '../../../matrix/MatrixClientService'
import { Button, Checkbox, Input, Modal, Switch, Alert, App as AntApp } from 'antd'
import { DeleteOutlined, ExportOutlined } from '@ant-design/icons'
import { MatrixError } from 'matrix-js-sdk'
import { useMemo, useState } from 'react'

type UiaFlow = { stages?: string[] }
type UiaPolicyTranslation = { name?: string; url?: string }
type UiaPolicy = { version?: string; [language: string]: string | UiaPolicyTranslation | undefined }
type UiaResponse = {
  session?: string
  completed?: string[]
  flows?: UiaFlow[]
  params?: Record<string, { policies?: Record<string, UiaPolicy> }>
}

const supportedStages = new Set(['m.login.password', 'm.login.terms', 'm.login.dummy'])

const policiesFor = (uia?: UiaResponse) => {
  const policies = uia?.params?.['m.login.terms']?.policies ?? {}
  const languages = [...navigator.languages, navigator.language, 'en']
  return Object.entries(policies).flatMap(([id, policy]) => {
    const translations = Object.entries(policy).flatMap(([key, value]) =>
      key !== 'version' && !!value && typeof value === 'object'
        ? ([[key, value as UiaPolicyTranslation]] as const)
        : [],
    )
    const selected =
      languages
        .map(
          (language) =>
            translations.find(([key]) => key.toLowerCase() === language.toLowerCase()) ??
            translations.find(([key]) => key.split('-')[0] === language.split('-')[0]),
        )
        .find(Boolean) ?? translations[0]
    const translation = selected?.[1]
    if (!translation?.url) return []
    return [
      {
        id,
        name: translation.name || id,
        url: translation.url,
        version: typeof policy.version === 'string' ? policy.version : undefined,
      },
    ]
  })
}

export function AccountDeactivation() {
  const { message } = AntApp.useApp()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [erase, setErase] = useState(false)
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [uia, setUia] = useState<UiaResponse>()
  const [acceptedTerms, setAcceptedTerms] = useState(false)
  const userId = matrixService.matrixClient?.getSafeUserId() ?? ''
  const policies = useMemo(() => policiesFor(uia), [uia])
  const completed = new Set(uia?.completed ?? [])
  const viableFlow = uia?.flows?.find((flow) =>
    (flow.stages ?? []).every((stage) => completed.has(stage) || supportedStages.has(stage)),
  )
  const nextStage = viableFlow?.stages?.find((stage) => !completed.has(stage))
  const unsupportedStages = uia?.flows
    ?.flatMap((flow) => flow.stages ?? [])
    .filter((stage) => !supportedStages.has(stage))

  const reset = () => {
    setOpen(false)
    setBusy(false)
    setErase(false)
    setPassword('')
    setConfirmation('')
    setUia(undefined)
    setAcceptedTerms(false)
  }

  const submit = async (auth?: Record<string, unknown>) => {
    if (confirmation !== userId) {
      message.error('Enter your full Matrix ID exactly to confirm deactivation')
      return
    }
    setBusy(true)
    try {
      await matrixService.deactivateAccount(auth, erase)
      location.reload()
    } catch (error) {
      if (error instanceof MatrixError && error.httpStatus === 401) {
        const next = error.data as UiaResponse
        setUia(next)
        const done = new Set(next.completed ?? [])
        const dummy = next.flows
          ?.find((flow) =>
            (flow.stages ?? []).every((stage) => done.has(stage) || supportedStages.has(stage)),
          )
          ?.stages?.find((stage) => stage === 'm.login.dummy' && !done.has(stage))
        if (dummy && next.session) {
          setBusy(false)
          await submit({ type: dummy, session: next.session })
          return
        }
      } else {
        message.error(error instanceof Error ? error.message : 'Could not deactivate the account')
      }
    } finally {
      setBusy(false)
    }
  }

  const retryFallback = () => void submit(uia?.session ? { session: uia.session } : undefined)

  return (
    <>
      <Button danger icon={<DeleteOutlined />} onClick={() => setOpen(true)}>
        Deactivate Matrix account
      </Button>
      <Modal
        open={open}
        title="Permanently deactivate account"
        onCancel={reset}
        footer={null}
        destroyOnHidden
      >
        <Alert
          type="error"
          showIcon
          message="This cannot be undone"
          description="You will lose the ability to sign in to this Matrix account. Leaving rooms and removing copies already held by other servers is not guaranteed."
          style={{ marginBottom: 18 }}
        />
        <div style={{ display: 'grid', gap: 16 }}>
          <label>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>Type {userId} to confirm</div>
            <Input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} />
          </label>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16 }}>
            <div>
              <div style={{ fontWeight: 600 }}>Request data erasure</div>
              <div style={{ opacity: 0.67, fontSize: 12 }}>
                Ask the homeserver to erase account data and hide your past events from future room
                members where possible.
              </div>
            </div>
            <Switch checked={erase} onChange={setErase} />
          </div>

          {!uia && (
            <Button danger type="primary" loading={busy} onClick={() => void submit()}>
              Continue
            </Button>
          )}

          {nextStage === 'm.login.password' && (
            <>
              <label>
                <div style={{ fontWeight: 600, marginBottom: 6 }}>Account password</div>
                <Input.Password
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </label>
              <Button
                danger
                type="primary"
                loading={busy}
                disabled={!password}
                onClick={() =>
                  void submit({
                    type: 'm.login.password',
                    identifier: { type: 'm.id.user', user: userId },
                    password,
                    session: uia?.session,
                  })
                }
              >
                Authorize deactivation
              </Button>
            </>
          )}

          {nextStage === 'm.login.terms' && (
            <>
              <div>
                <div style={{ fontWeight: 600, marginBottom: 8 }}>Server terms</div>
                <p style={{ marginTop: 0 }}>
                  Review the policies required by your homeserver before continuing:
                </p>
                <div style={{ display: 'grid', gap: 8 }}>
                  {policies.map((policy) => (
                    <a key={policy.id} href={policy.url} target="_blank" rel="noreferrer">
                      {policy.name}
                      {policy.version ? ` · ${policy.version}` : ''} <ExportOutlined />
                    </a>
                  ))}
                </div>
              </div>
              <Checkbox
                checked={acceptedTerms}
                onChange={(event) => setAcceptedTerms(event.target.checked)}
              >
                I have reviewed and accept these terms
              </Checkbox>
              <Button
                danger
                type="primary"
                loading={busy}
                disabled={!acceptedTerms || !policies.length}
                onClick={() => void submit({ type: 'm.login.terms', session: uia?.session })}
              >
                Accept and continue
              </Button>
            </>
          )}

          {uia && !viableFlow && (
            <Alert
              type="warning"
              showIcon
              message="Additional browser authentication required"
              description={
                <div>
                  <p>
                    This homeserver requires{' '}
                    {unsupportedStages?.join(', ') || 'an unsupported authentication stage'}.
                  </p>
                  {uia.session && unsupportedStages?.[0] && (
                    <a
                      href={`${matrixService.matrixClient?.getHomeserverUrl().replace(/\/$/, '')}/_matrix/client/v3/auth/${encodeURIComponent(unsupportedStages[0])}/fallback/web?session=${encodeURIComponent(uia.session)}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Open homeserver authentication <ExportOutlined />
                    </a>
                  )}
                  <div style={{ marginTop: 12 }}>
                    <Button loading={busy} onClick={retryFallback}>
                      I completed authentication
                    </Button>
                  </div>
                </div>
              }
            />
          )}
        </div>
      </Modal>
    </>
  )
}
