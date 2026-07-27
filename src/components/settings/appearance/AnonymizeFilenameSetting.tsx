import {
  ANONYMIZE_FILENAME_CHANGED_EVENT,
  ANONYMIZE_FILENAME_KEY,
  anonymizeFilenameDefault,
} from '../../../lib/constants'
import { useState } from 'react'
import { List as AntList, Switch } from 'antd'

export function AnonymizeFilenameSetting() {
  const [anonymize, setAnonymize] = useState(anonymizeFilenameDefault)
  const toggle = (value: boolean) => {
    setAnonymize(value)
    localStorage.setItem(ANONYMIZE_FILENAME_KEY, String(value))
    window.dispatchEvent(new CustomEvent(ANONYMIZE_FILENAME_CHANGED_EVENT, { detail: value }))
  }
  return (
    <AntList.Item extra={<Switch checked={anonymize} onChange={toggle} />}>
      <AntList.Item.Meta
        title="Anonymize filenames by default"
        description="Turn on to replace a shared file's name with a random ID (keeping its extension) by default. You can still override this per file before sending."
      />
    </AntList.Item>
  )
}
