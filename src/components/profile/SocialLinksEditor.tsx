import { type SocialLink } from '../../lib/social'
import { SocialEditorRow } from '../../styles'
import { useState } from 'react'
import { Button, Divider, Input, App as AntApp } from 'antd'
import { DeleteOutlined, LinkOutlined, UploadOutlined } from '@ant-design/icons'
import { MatrixClient } from 'matrix-js-sdk'

export function SocialLinksEditor({
  value,
  onChange,
  client,
}: {
  value: SocialLink[]
  onChange: (value: SocialLink[]) => void
  client?: MatrixClient
}) {
  const { message } = AntApp.useApp()
  const [uploading, setUploading] = useState<number>()
  const update = (index: number, change: Partial<SocialLink>) =>
    onChange(value.map((item, itemIndex) => (itemIndex === index ? { ...item, ...change } : item)))
  const upload = async (index: number, file?: File) => {
    if (!file || !client) return
    setUploading(index)
    try {
      const result = await client.uploadContent(file, {
        name: file.name,
        type: file.type,
      })
      update(index, { img: result.content_uri })
      message.success('Social icon uploaded')
    } catch (error) {
      message.error(error instanceof Error ? error.message : 'Could not upload social icon')
    } finally {
      setUploading(undefined)
    }
  }
  return (
    <div>
      <Divider />
      <h3>Social links</h3>
      <p>
        Links are published in <code>foxchat.social_links</code>. Known services receive a default
        icon when no custom image is set.
      </p>
      {value.map((item, index) => (
        <SocialEditorRow key={index}>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr) auto',
              gap: 8,
              alignItems: 'center',
            }}
          >
            <Input
              value={item.title}
              onChange={(event) => update(index, { title: event.target.value })}
              placeholder="Title"
            />
            <Input
              value={item.link}
              onChange={(event) => update(index, { link: event.target.value })}
              placeholder="https://…"
            />
            <Button
              danger
              type="text"
              icon={<DeleteOutlined />}
              aria-label="Remove social link"
              onClick={() => onChange(value.filter((_, itemIndex) => itemIndex !== index))}
            />
          </div>
          <div
            style={{
              display: 'flex',
              gap: 8,
              marginTop: 8,
              alignItems: 'center',
            }}
          >
            <Input
              value={item.img ?? ''}
              onChange={(event) => update(index, { img: event.target.value || undefined })}
              placeholder="Optional image URL or mxc://…"
            />
            <Button
              loading={uploading === index}
              icon={<UploadOutlined />}
              onClick={() => document.getElementById(`social-icon-${index}`)?.click()}
            >
              Upload
            </Button>
            <input
              id={`social-icon-${index}`}
              hidden
              style={{ display: 'none' }}
              type="file"
              accept="image/*"
              onChange={(event) => {
                void upload(index, event.target.files?.[0])
                event.target.value = ''
              }}
            />
          </div>
        </SocialEditorRow>
      ))}
      <Button
        type="dashed"
        block
        icon={<LinkOutlined />}
        onClick={() => onChange([...value, { title: '', link: '', img: undefined }])}
      >
        Add social link
      </Button>
    </div>
  )
}
