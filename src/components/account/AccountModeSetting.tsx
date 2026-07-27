import { Name, Preview } from '../../styles'
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Divider, Segmented } from 'antd'
import { matrixService } from '../../matrix/MatrixClientService'
import { accountsOpenFromUrl, clearAccountsUrl } from '../../lib/urlState'

export function AccountModeSetting() {
  const [target, setTarget] = useState<HTMLElement>()
  const [combined, setCombined] = useState(() => matrixService.combinedAccountsEnabled())
  useEffect(() => {
    let timer: number | undefined
    const find = () => {
      const bodies = [...document.querySelectorAll<HTMLElement>('.ant-modal-body')].filter(
        (node) => node.getBoundingClientRect().width > 0,
      )
      const body = bodies.at(-1)
      if (body) setTarget(body)
      else timer = window.setTimeout(find, 30)
    }
    const show = () => {
      setTarget(undefined)
      setCombined(matrixService.combinedAccountsEnabled())
      timer = window.setTimeout(find, 0)
    }
    window.addEventListener('foxchat-accounts', show)
    window.addEventListener('foxchat-accounts-state-changed', show)
    if (accountsOpenFromUrl()) show()
    return () => {
      window.removeEventListener('foxchat-accounts', show)
      window.removeEventListener('foxchat-accounts-state-changed', show)
      if (timer !== undefined) window.clearTimeout(timer)
    }
  }, [])
  if (!target) return null
  return createPortal(
    <>
      <Divider />
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 16,
          flexWrap: 'wrap',
        }}
      >
        <div>
          <Name>Account layout</Name>
          <Preview>
            {combined
              ? 'Combined rooms from every account'
              : 'Separate accounts with manual switching'}
          </Preview>
        </div>
        <Segmented
          value={combined ? 'combined' : 'separate'}
          options={[
            { label: 'Separate', value: 'separate' },
            { label: 'Combined', value: 'combined' },
          ]}
          onChange={(value) => {
            const enabled = value === 'combined'
            setCombined(enabled)
            matrixService.setCombinedAccountsEnabled(enabled)
            clearAccountsUrl()
            location.reload()
          }}
        />
      </div>
    </>,
    target,
  )
}
