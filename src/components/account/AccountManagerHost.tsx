import { colorFor, initials } from '../../lib/constants'
import { useEffect, useState } from 'react'
import { Avatar, Button, Divider, Form, Input, Modal, App as AntApp, List as AntList } from 'antd'
import { ArrowLeftOutlined, LoginOutlined, LogoutOutlined } from '@ant-design/icons'
import { matrixService, type MatrixSession } from '../../matrix/MatrixClientService'
import {
  accountLogoutIdFromUrl,
  accountsOpenFromUrl,
  clearAccountLogoutUrl,
  clearAccountsUrl,
  closeAccountLogoutUrl,
  closeAccountsUrl,
  openAccountLogoutUrl,
  openAccountsUrl,
} from '../../lib/urlState'

export function AccountManagerHost() {
  const { message } = AntApp.useApp()
  const [open, setOpen] = useState(accountsOpenFromUrl)
  const [adding, setAdding] = useState(false)
  const [busy, setBusy] = useState(false)
  const [accounts, setAccounts] = useState<MatrixSession[]>(() => matrixService.savedAccounts())
  const [logoutAccountId, setLogoutAccountId] = useState(accountLogoutIdFromUrl)
  const logoutAccount = accounts.find(
    (account) => matrixService.savedAccountId(account) === logoutAccountId,
  )
  useEffect(() => {
    const navigate = () => {
      const next = accountsOpenFromUrl()
      setOpen(next)
      setLogoutAccountId(next ? accountLogoutIdFromUrl() : undefined)
      if (next) {
        setAccounts(matrixService.savedAccounts())
        window.dispatchEvent(new CustomEvent('foxchat-accounts-state-changed'))
      }
    }
    const show = () => {
      setAccounts(matrixService.savedAccounts())
      setAdding(false)
      setLogoutAccountId(undefined)
      setOpen(true)
      openAccountsUrl()
      window.dispatchEvent(new CustomEvent('foxchat-accounts-state-changed'))
    }
    window.addEventListener('popstate', navigate)
    window.addEventListener('foxchat-accounts', show)
    navigate()
    return () => {
      window.removeEventListener('popstate', navigate)
      window.removeEventListener('foxchat-accounts', show)
    }
  }, [])
  const switchTo = async (account: MatrixSession) => {
    if (matrixService.savedAccountId(account) === matrixService.activeAccountId()) {
      closeAccountsUrl()
      return
    }
    setBusy(true)
    try {
      matrixService.selectAccount(matrixService.savedAccountId(account))
      clearAccountsUrl()
      location.reload()
    } catch (error) {
      message.error(error instanceof Error ? error.message : 'Could not switch account')
      setBusy(false)
    }
  }
  const login = async (values: { homeserver: string; username: string; password: string }) => {
    setBusy(true)
    try {
      await matrixService.loginAdditionalAccount(
        values.homeserver,
        values.username,
        values.password,
      )
      clearAccountsUrl()
      location.reload()
    } catch (error) {
      message.error(error instanceof Error ? error.message : 'Login failed')
      setBusy(false)
    }
  }
  const confirmLogout = async () => {
    if (!logoutAccount) return
    setBusy(true)
    try {
      await matrixService.logoutAccount(matrixService.savedAccountId(logoutAccount))
    } catch (error) {
      // Local logout still succeeds when token revocation fails.
      console.warn('[accounts] Could not revoke the Matrix session', error)
    } finally {
      clearAccountLogoutUrl()
      clearAccountsUrl()
      location.reload()
    }
  }
  return (
    <>
      <Modal
        title="Accounts"
        open={open}
        footer={null}
        onCancel={() => !busy && closeAccountsUrl()}
      >
        <p>
          Switch accounts without signing out. Each account keeps its own device, sync cache, and
          encryption keystore.
        </p>
        {!adding ? (
          <>
            <AntList
              dataSource={accounts}
              renderItem={(account) => (
                <AntList.Item
                  actions={[
                    <Button
                      key="switch"
                      type={
                        matrixService.savedAccountId(account) === matrixService.activeAccountId()
                          ? 'default'
                          : 'primary'
                      }
                      disabled={busy}
                      onClick={() => void switchTo(account)}
                    >
                      {matrixService.savedAccountId(account) === matrixService.activeAccountId()
                        ? 'Current'
                        : 'Switch'}
                    </Button>,
                    <Button
                      key="logout"
                      danger
                      icon={<LogoutOutlined />}
                      disabled={busy}
                      onClick={() => {
                        const accountId = matrixService.savedAccountId(account)
                        setLogoutAccountId(accountId)
                        openAccountLogoutUrl(accountId)
                      }}
                    >
                      Log out
                    </Button>,
                  ]}
                >
                  <AntList.Item.Meta
                    avatar={
                      <Avatar style={{ background: colorFor(account.userId) }}>
                        {initials(account.userId)}
                      </Avatar>
                    }
                    title={account.userId}
                    description={account.baseUrl}
                  />
                </AntList.Item>
              )}
            />
            <Divider />
            <Button block icon={<LoginOutlined />} onClick={() => setAdding(true)}>
              Log in with another account
            </Button>
          </>
        ) : (
          <>
            <Button type="text" icon={<ArrowLeftOutlined />} onClick={() => setAdding(false)}>
              Saved accounts
            </Button>
            <Form
              layout="vertical"
              onFinish={login}
              initialValues={{ homeserver: matrixService.lastHomeserver() }}
              requiredMark={false}
            >
              <Form.Item name="homeserver" label="Homeserver" rules={[{ required: true }]}>
                <Input placeholder="https://matrix.org" />
              </Form.Item>
              <Form.Item name="username" label="Matrix ID or username" rules={[{ required: true }]}>
                <Input />
              </Form.Item>
              <Form.Item name="password" label="Password" rules={[{ required: true }]}>
                <Input.Password />
              </Form.Item>
              <Button block type="primary" htmlType="submit" loading={busy}>
                Log in and save account
              </Button>
            </Form>
          </>
        )}
      </Modal>
      <Modal
        title={`Log out ${logoutAccount?.userId ?? 'account'}?`}
        open={!!logoutAccount}
        okText="Log out"
        okButtonProps={{ danger: true }}
        confirmLoading={busy}
        maskClosable={!busy}
        closable={!busy}
        onOk={() => void confirmLogout()}
        onCancel={() => !busy && closeAccountLogoutUrl()}
      >
        <p>
          This removes the account from FoxChat and revokes this device session on the homeserver.
        </p>
        {logoutAccount && (
          <p>
            <strong>{logoutAccount.userId}</strong>
            <br />
            {logoutAccount.baseUrl}
          </p>
        )}
      </Modal>
    </>
  )
}
