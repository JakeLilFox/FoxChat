import { AccountThemedHost } from './components/account'
import { Root } from './components/Root'
import { ViewportHeightSync } from './components/ViewportHeightSync'
import { DesktopUpdateProvider } from './components/DesktopUpdateProvider'
import { App as AntApp } from 'antd'

export default function App() {
  return (
    <AntApp>
      <DesktopUpdateProvider>
        <ViewportHeightSync />
        <Root />
        <AccountThemedHost />
      </DesktopUpdateProvider>
    </AntApp>
  )
}
