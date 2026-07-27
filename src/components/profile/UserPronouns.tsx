import { useEffect, useState } from 'react'
import { MatrixClient } from 'matrix-js-sdk'
import { cachedPronouns } from '../../lib/userPronouns'

export function UserPronouns({ userId, client }: { userId?: string; client?: MatrixClient }) {
  const [pronouns, setPronouns] = useState('')
  useEffect(() => {
    let cancelled = false
    if (!userId || !client) {
      setPronouns('')
      return
    }
    const request = cachedPronouns(client.getSafeUserId(), userId, () =>
      client
        .getProfileInfo(userId)
        .then((profile) => {
          const raw = profile as Record<string, unknown>
          return typeof raw['foxchat.pronouns'] === 'string' ? raw['foxchat.pronouns'].trim() : ''
        })
        .catch(() => ''),
    )
    void request.then((value) => {
      if (!cancelled) setPronouns(value)
    })
    return () => {
      cancelled = true
    }
  }, [userId, client])
  return pronouns ? <span className="pronouns">{pronouns}</span> : null
}
