import { RoleIcon } from './RoleIcon'
import { type EditableRole } from '../../lib/roleHelpers'
import { useRef, useState } from 'react'
import { Button, Form, Input, App as AntApp } from 'antd'
import { UploadOutlined } from '@ant-design/icons'
import { matrixService } from '../../matrix/MatrixClientService'

export function RoleIconEditor({
  role,
  onChange,
}: {
  role: EditableRole
  onChange: (icon?: string) => void
}) {
  const { message } = AntApp.useApp()
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const upload = async (file?: File) => {
    if (!file) return
    setBusy(true)
    try {
      const [uploaded] = await matrixService.uploadImagePackFiles([file])
      if (!uploaded?.url) throw new Error('Matrix did not return a media URL')
      onChange(uploaded.url)
    } catch (error) {
      message.error(error instanceof Error ? error.message : 'Could not upload role icon')
    } finally {
      setBusy(false)
      if (input.current) input.current.value = ''
    }
  }
  return (
    <Form.Item label="Role icon">
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          flexWrap: 'wrap',
        }}
      >
        <span
          style={{
            width: 42,
            height: 42,
            display: 'grid',
            placeItems: 'center',
            border: '1px solid rgba(127,127,127,.25)',
            borderRadius: 9,
          }}
        >
          <RoleIcon
            rank={{
              level: role.level,
              name: role.name,
              color: role.color,
              icon: role.icon,
            }}
            size={30}
          />
        </span>
        <Input
          style={{ flex: '1 1 240px' }}
          value={role.icon}
          allowClear
          placeholder="mxc://server/media-id"
          onChange={(event) => onChange(event.target.value.trim() || undefined)}
        />
        <input
          ref={input}
          hidden
          style={{ display: 'none' }}
          type="file"
          accept="image/*"
          onChange={(event) => void upload(event.target.files?.[0])}
        />
        <Button loading={busy} icon={<UploadOutlined />} onClick={() => input.current?.click()}>
          Upload
        </Button>
        {role.icon && (
          <Button danger type="text" onClick={() => onChange(undefined)}>
            Remove
          </Button>
        )}
      </div>
    </Form.Item>
  )
}
