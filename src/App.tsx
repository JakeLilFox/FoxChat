import { AccountThemedHost } from './components/account'
import { Root } from './components/Root'
import { ViewportHeightSync } from './components/ViewportHeightSync'
import { App as AntApp } from 'antd'

export default function App() {
  return (
    <AntApp>
      <ViewportHeightSync />
      <Root />
      <AccountThemedHost />
    </AntApp>
  )
}
