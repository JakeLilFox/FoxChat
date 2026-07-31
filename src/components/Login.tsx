import { AuthPage, Brand, Logo } from '../styles'
import { useState } from 'react'
import { Alert, Button, Checkbox, Form, Input, App as AntApp } from 'antd'
import { LockOutlined } from '@ant-design/icons'
import { matrixService, type MatrixRegistrationDetails } from '../matrix/MatrixClientService'
import {
  REGISTRATION_TERMS_STAGE,
  REGISTRATION_TOKEN_STAGES,
  type RegistrationChallenge,
} from '../lib/registration'
import { openExternalUrl } from '../platform/externalLinks'

type LoginValues = { homeserver: string; username: string; password: string }
type RegistrationValues = MatrixRegistrationDetails & { confirmPassword: string }

export function Login({ onReady }: { onReady: () => void }) {
  const { message } = AntApp.useApp()
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [busy, setBusy] = useState(false)
  const [registrationDetails, setRegistrationDetails] = useState<MatrixRegistrationDetails>()
  const [challenge, setChallenge] = useState<RegistrationChallenge>()

  const submitLogin = async (values: LoginValues) => {
    setBusy(true)
    try {
      await matrixService.login(values.homeserver, values.username, values.password)
      onReady()
    } catch (error) {
      message.error(error instanceof Error ? error.message : 'Login failed')
    } finally {
      setBusy(false)
    }
  }

  const performRegistration = async (
    details: MatrixRegistrationDetails,
    auth?: Record<string, unknown>,
  ) => {
    setBusy(true)
    try {
      const result = await matrixService.registerAccount(details, auth)
      if (result.status === 'challenge') {
        setRegistrationDetails({ ...details, homeserver: result.challenge.baseUrl })
        setChallenge(result.challenge)
        return
      }
      if (result.profileWarning)
        message.warning(
          `Your account was created, but the display name was not saved: ${result.profileWarning}`,
        )
      else message.success('Your account is ready.')
      onReady()
    } catch (error) {
      message.error(error instanceof Error ? error.message : 'Registration failed')
    } finally {
      setBusy(false)
    }
  }

  const submitRegistration = async (values: RegistrationValues) => {
    const details: MatrixRegistrationDetails = {
      homeserver: values.homeserver,
      username: values.username,
      password: values.password,
      displayName: values.displayName,
    }
    setRegistrationDetails(details)
    setChallenge(undefined)
    await performRegistration(details)
  }

  const completeStage = (auth: Record<string, unknown>) => {
    if (!registrationDetails) return
    void performRegistration(registrationDetails, auth)
  }

  const resetRegistration = () => {
    setChallenge(undefined)
    setRegistrationDetails(undefined)
  }

  const switchMode = (nextMode: 'login' | 'register') => {
    setMode(nextMode)
    resetRegistration()
  }

  const registrationStage = challenge ? (
    <div data-testid="registration-challenge">
      {challenge.error ? (
        <Alert type="error" showIcon message={challenge.error} style={{ marginBottom: 18 }} />
      ) : null}

      {REGISTRATION_TOKEN_STAGES.has(challenge.stage) ? (
        <Form
          layout="vertical"
          requiredMark={false}
          onFinish={({ token }: { token: string }) =>
            completeStage({ type: challenge.stage, token, session: challenge.session })
          }
        >
          <Form.Item
            name="token"
            label="Registration token"
            rules={[
              {
                required: true,
                message: 'Enter the registration token from your server administrator.',
              },
            ]}
          >
            <Input size="large" maxLength={64} autoComplete="one-time-code" />
          </Form.Item>
          <Button htmlType="submit" type="primary" size="large" block loading={busy}>
            Continue
          </Button>
        </Form>
      ) : challenge.stage === REGISTRATION_TERMS_STAGE && challenge.policies.length ? (
        <Form
          layout="vertical"
          requiredMark={false}
          onFinish={() => completeStage({ type: challenge.stage, session: challenge.session })}
        >
          <p>Please read and accept the policies required by this homeserver:</p>
          {challenge.policies.map((policy) => (
            <Form.Item
              key={policy.id}
              name={['acceptedPolicies', policy.id]}
              valuePropName="checked"
              rules={[
                {
                  validator: (_, accepted) =>
                    accepted
                      ? Promise.resolve()
                      : Promise.reject(new Error(`Accept ${policy.name} to continue.`)),
                },
              ]}
            >
              <Checkbox>
                I accept the{' '}
                <a href={policy.url} target="_blank" rel="noreferrer">
                  {policy.name}
                </a>
                {policy.version ? ` (${policy.version})` : ''}
              </Checkbox>
            </Form.Item>
          ))}
          <Button htmlType="submit" type="primary" size="large" block loading={busy}>
            Accept and continue
          </Button>
        </Form>
      ) : (
        <div>
          <Alert
            type="info"
            showIcon
            message="Complete the homeserver verification"
            description="The homeserver requires an external verification step. Open it, finish the step, then return here."
            style={{ marginBottom: 18 }}
          />
          <Button size="large" block onClick={() => void openExternalUrl(challenge.fallbackUrl)}>
            Open verification
          </Button>
          <Button
            type="primary"
            size="large"
            block
            loading={busy}
            style={{ marginTop: 10 }}
            onClick={() => completeStage({ session: challenge.session })}
          >
            I completed verification
          </Button>
        </div>
      )}

      <Button type="link" block disabled={busy} onClick={resetRegistration}>
        Start over
      </Button>
    </div>
  ) : null

  return (
    <AuthPage data-testid="login-page">
      <div className="form">
        <Brand>
          <Logo>F</Logo>FoxChat
        </Brand>

        {mode === 'login' ? (
          <>
            <h1>Welcome back</h1>
            <p>
              Sign in to your Matrix homeserver. Your session, encryption keys and sync cache stay
              in this browser.
            </p>
            <Form
              layout="vertical"
              onFinish={submitLogin}
              initialValues={{ homeserver: matrixService.lastHomeserver() }}
              requiredMark={false}
            >
              <Form.Item name="homeserver" label="Homeserver" rules={[{ required: true }]}>
                <Input size="large" placeholder="https://matrix.org" />
              </Form.Item>
              <Form.Item name="username" label="Matrix ID or username" rules={[{ required: true }]}>
                <Input size="large" placeholder="@you:matrix.org" autoComplete="username" />
              </Form.Item>
              <Form.Item name="password" label="Password" rules={[{ required: true }]}>
                <Input.Password
                  size="large"
                  placeholder="Your password"
                  autoComplete="current-password"
                />
              </Form.Item>
              <Button htmlType="submit" type="primary" size="large" block loading={busy}>
                Sign in
              </Button>
            </Form>
            <p className="auth-switch">
              New to Matrix?{' '}
              <Button type="link" onClick={() => switchMode('register')}>
                Create an account
              </Button>
            </p>
            <p>
              You stay signed in across reloads and browser restarts until you explicitly sign out.
            </p>
          </>
        ) : (
          <>
            <h1>Create your account</h1>
            <p>
              Register directly with your Matrix homeserver. Availability and verification steps are
              controlled by that server.
            </p>
            {registrationStage ?? (
              <Form
                layout="vertical"
                onFinish={submitRegistration}
                initialValues={{ homeserver: matrixService.lastHomeserver() }}
                requiredMark={false}
              >
                <Form.Item name="homeserver" label="Homeserver" rules={[{ required: true }]}>
                  <Input size="large" placeholder="https://matrix.org" />
                </Form.Item>
                <Form.Item name="username" label="Username" rules={[{ required: true }]}>
                  <Input size="large" placeholder="you" autoComplete="username" />
                </Form.Item>
                <Form.Item name="displayName" label="Display name (optional)">
                  <Input size="large" placeholder="How others see you" autoComplete="name" />
                </Form.Item>
                <Form.Item name="password" label="Password" rules={[{ required: true }]}>
                  <Input.Password size="large" autoComplete="new-password" />
                </Form.Item>
                <Form.Item
                  name="confirmPassword"
                  label="Confirm password"
                  dependencies={['password']}
                  rules={[
                    { required: true },
                    ({ getFieldValue }) => ({
                      validator(_, value) {
                        return !value || getFieldValue('password') === value
                          ? Promise.resolve()
                          : Promise.reject(new Error('The passwords do not match.'))
                      },
                    }),
                  ]}
                >
                  <Input.Password size="large" autoComplete="new-password" />
                </Form.Item>
                <Button htmlType="submit" type="primary" size="large" block loading={busy}>
                  Create account
                </Button>
              </Form>
            )}
            <p className="auth-switch">
              Already have an account?{' '}
              <Button type="link" disabled={busy} onClick={() => switchMode('login')}>
                Back to sign in
              </Button>
            </p>
          </>
        )}
      </div>
      <div className="visual">
        <div>
          <LockOutlined style={{ fontSize: 58 }} />
          <h2>Private conversations on an open network.</h2>
          <p>
            End-to-end encrypted messaging, decentralized rooms, Spaces, device sync, and no
            platform lock-in.
          </p>
        </div>
      </div>
    </AuthPage>
  )
}
