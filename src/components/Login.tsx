import { AuthPage, Brand, Logo } from '../styles'
import { useState } from 'react'
import { Button, Form, Input, App as AntApp } from 'antd'
import { LockOutlined } from '@ant-design/icons'
import { matrixService } from '../matrix/MatrixClientService'

export function Login({ onReady }: { onReady: () => void }) {
  const { message } = AntApp.useApp()
  const [busy, setBusy] = useState(false)
  const submit = async (v: { homeserver: string; username: string; password: string }) => {
    setBusy(true)
    try {
      await matrixService.login(v.homeserver, v.username, v.password)
      onReady()
    } catch (e) {
      message.error(e instanceof Error ? e.message : 'Login failed')
    } finally {
      setBusy(false)
    }
  }
  return (
    <AuthPage data-testid="login-page">
      <div className="form">
        <Brand>
          <Logo>F</Logo>FoxChat
        </Brand>
        <h1>Welcome back</h1>
        <p>
          Sign in to your Matrix homeserver. Your session, encryption keys and sync cache stay in
          this browser.
        </p>
        <Form
          layout="vertical"
          onFinish={submit}
          initialValues={{ homeserver: matrixService.lastHomeserver() }}
          requiredMark={false}
        >
          <Form.Item name="homeserver" label="Homeserver" rules={[{ required: true }]}>
            <Input size="large" placeholder="https://matrix.org" />
          </Form.Item>
          <Form.Item name="username" label="Matrix ID or username" rules={[{ required: true }]}>
            <Input size="large" placeholder="@you:matrix.org" />
          </Form.Item>
          <Form.Item name="password" label="Password" rules={[{ required: true }]}>
            <Input.Password size="large" placeholder="Your password" />
          </Form.Item>
          <Button htmlType="submit" type="primary" size="large" block loading={busy}>
            Sign in
          </Button>
        </Form>
        <p style={{ marginTop: 18 }}>
          You stay signed in across reloads and browser restarts until you explicitly sign out.
        </p>
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
