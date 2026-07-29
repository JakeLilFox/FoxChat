import { CloudDownloadOutlined } from '@ant-design/icons'
import { Badge, Popover } from 'antd'
import { useEffect, useState } from 'react'
import { IconBtn } from '../styles'
import { useDesktopUpdate } from './desktopUpdateContext'
import { DesktopUpdatePanel } from './DesktopUpdatePanel'

export function DesktopUpdateIndicator() {
  const { update, autoOpenPending, consumeAutoOpen, skipUpdate } = useDesktopUpdate()
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!update) {
      setOpen(false)
      return
    }
    if (autoOpenPending) {
      setOpen(true)
      consumeAutoOpen()
    }
  }, [autoOpenPending, consumeAutoOpen, update])

  if (!update) return null

  return (
    <Popover
      content={<DesktopUpdatePanel update={update} onSkip={skipUpdate} popover />}
      trigger="click"
      placement="bottomRight"
      open={open}
      onOpenChange={setOpen}
    >
      <Badge dot color="#7357e8" offset={[-5, 5]}>
        <IconBtn
          aria-label={`FoxChat ${update.version} update available`}
          shape="circle"
          icon={<CloudDownloadOutlined />}
        />
      </Badge>
    </Popover>
  )
}
