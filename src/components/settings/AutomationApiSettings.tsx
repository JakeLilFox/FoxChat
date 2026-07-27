import { CopyOutlined, ReloadOutlined } from '@ant-design/icons'
import {
  App as AntApp,
  Button,
  Descriptions,
  Input,
  InputNumber,
  Space,
  Switch,
  Tag,
  Typography,
} from 'antd'
import { useEffect, useState } from 'react'
import {
  automationApiStatus,
  automationApiSupported,
  automationApiUsesBridge,
  automationSettings,
  configureAutomationApi,
  generateAutomationApiKey,
  type AutomationStatus,
} from '../../platform/automationApi'

export function AutomationApiSettings() {
  const { message } = AntApp.useApp()
  const initial = automationSettings()
  const [enabled, setEnabled] = useState(initial.enabled)
  const [port, setPort] = useState(initial.port)
  const [apiKey, setApiKey] = useState(initial.apiKey)
  const [status, setStatus] = useState<AutomationStatus>({ running: false, connections: 0 })
  const [saving, setSaving] = useState(false)
  const supported = automationApiSupported()
  const usesBridge = automationApiUsesBridge()
  const refresh = () =>
    void automationApiStatus()
      .then(setStatus)
      .catch(() => setStatus({ running: false, connections: 0 }))
  useEffect(() => {
    refresh()
    const timer = window.setInterval(refresh, 2_000)
    return () => window.clearInterval(timer)
  }, [])
  const save = async (nextEnabled = enabled, nextKey = apiKey) => {
    setSaving(true)
    try {
      await configureAutomationApi(nextEnabled, port, nextKey)
      setEnabled(nextEnabled)
      setApiKey(nextKey)
      refresh()
      message.success(nextEnabled ? 'Automation API started' : 'Automation API stopped')
    } catch (error) {
      message.error(error instanceof Error ? error.message : 'Could not configure automation API')
    } finally {
      setSaving(false)
    }
  }
  const regenerate = async () => {
    const next = generateAutomationApiKey()
    await save(enabled, next)
  }
  return (
    <div>
      <Typography.Title level={4}>Local automation API</Typography.Title>
      <Typography.Paragraph type="secondary">
        Exposes Matrix messages and call controls to trusted local programs. The desktop app hosts
        the server itself; a browser connects through the separately installed FoxChat Bridge.
        Everything stays on 127.0.0.1. Treat the API key like a password.
      </Typography.Paragraph>
      {!supported && (
        <Typography.Paragraph type="warning">
          The local automation API is not supported on mobile.
        </Typography.Paragraph>
      )}
      <Descriptions column={1} bordered size="small">
        <Descriptions.Item label="Enabled">
          <Switch
            disabled={!supported}
            checked={enabled}
            loading={saving}
            onChange={(value) => void save(value)}
          />
        </Descriptions.Item>
        <Descriptions.Item label="Status">
          <Space>
            <Tag color={status.running ? 'green' : 'default'}>
              {status.running ? 'Running' : 'Stopped'}
            </Tag>
            {status.running && <span>{status.connections} connection(s)</span>}
          </Space>
        </Descriptions.Item>
        <Descriptions.Item label="Port">
          <InputNumber
            min={1024}
            max={65535}
            value={port}
            disabled={enabled || !supported || usesBridge}
            onChange={(value) => setPort(value ?? initial.port)}
          />
        </Descriptions.Item>
        <Descriptions.Item label="WebSocket URL">
          <Input readOnly value={`ws://127.0.0.1:${status.port || port}/v1`} />
        </Descriptions.Item>
        <Descriptions.Item label="API key">
          <Space.Compact style={{ width: '100%' }}>
            <Input.Password readOnly value={apiKey} />
            <Button
              icon={<CopyOutlined />}
              onClick={() =>
                void navigator.clipboard
                  .writeText(apiKey)
                  .then(() => message.success('API key copied'))
              }
            >
              Copy
            </Button>
            <Button icon={<ReloadOutlined />} danger onClick={() => void regenerate()}>
              Rotate
            </Button>
          </Space.Compact>
        </Descriptions.Item>
      </Descriptions>
      {!enabled && supported && (
        <Button
          type="primary"
          style={{ marginTop: 16 }}
          loading={saving}
          onClick={() => void save(true)}
        >
          Enable API
        </Button>
      )}
    </div>
  )
}
