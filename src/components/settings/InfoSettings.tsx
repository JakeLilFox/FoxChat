import { BUILD_VERSION } from '../../lib/constants'
import { Descriptions } from 'antd'

export function InfoSettings() {
  return (
    <div>
      <h2>Info</h2>
      <Descriptions
        column={1}
        bordered
        size="small"
        items={[
          {
            key: 'build',
            label: 'Build number',
            children: <code>{BUILD_VERSION}</code>,
          },
          {
            key: 'author',
            label: 'Made by',
            children: (
              <>
                <a href="https://jakefox.de" target="_blank" rel="noreferrer">
                  jakefox
                </a>{' '}
                with &lt;3
              </>
            ),
          },
        ]}
      />
    </div>
  )
}
