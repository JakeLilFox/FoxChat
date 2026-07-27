#!/usr/bin/env tsx

import { config as loadEnv } from 'dotenv'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { liveMatrixConfig } from '../tests/e2e/support/env'
import { cleanStaleTestRooms, rawLogin } from '../tests/e2e/support/matrix-api'

const envFile = resolve('test.env')
if (existsSync(envFile)) loadEnv({ path: envFile, override: false, quiet: true })

async function main() {
  const live = liveMatrixConfig()
  if (!live.enabled) {
    console.log(`Skipping stale-room cleanup: ${live.reason}`)
    return
  }
  const accounts = [live.account1!, live.account2!, live.account3!]
  const seen = new Set<string>()
  for (const account of accounts) {
    if (seen.has(account.userId)) continue
    seen.add(account.userId)
    try {
      const session = await rawLogin(account)
      const cleaned = await cleanStaleTestRooms(live.roomPrefix, [session])
      console.log(`${account.userId}: cleaned ${cleaned} stale "${live.roomPrefix} ..." room(s)`)
    } catch (error) {
      console.warn(
        `Could not clean stale rooms for ${account.userId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      )
    }
  }
}

main()
