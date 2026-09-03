import { useEffect } from 'react'
import { App as AntApp } from 'antd'
import { installMessageErrorLogging } from '../platform/errorLogging'

export function ErrorLoggingBridge() {
  const { message } = AntApp.useApp()
  useEffect(() => installMessageErrorLogging(message), [message])
  return null
}
