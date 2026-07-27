import { config as loadDotenv } from 'dotenv'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  liveMatrixConfig,
  matrixTestAccount,
  type MatrixTestAccount,
} from '../../../tests/e2e/support/env'

const repoRoot = resolve(fileURLToPath(import.meta.url), '..', '..', '..', '..')
const testEnvPath = resolve(repoRoot, 'test.env')
if (existsSync(testEnvPath)) loadDotenv({ path: testEnvPath, override: false, quiet: true })

const value = (name: string) => process.env[name]?.trim() ?? ''

export type AndroidE2eConfig = {
  enabled: boolean
  reason?: string
  account1: MatrixTestAccount
  account2: MatrixTestAccount
  account3: MatrixTestAccount
  account4: MatrixTestAccount
  roomPrefix: string
  apkPath: string
  packageName: string
  mainActivity: string
  androidHome: string
  appiumPort: number
  baseUrl: string
  skipWebServer: boolean
}

export function androidE2eConfig(): {
  enabled: boolean
  reason?: string
  value?: AndroidE2eConfig
} {
  if (value('MATRIX_E2E_ALLOW_ANDROID').toLowerCase() !== 'true')
    return { enabled: false, reason: 'MATRIX_E2E_ALLOW_ANDROID is not true' }

  const live = liveMatrixConfig()
  if (!live.enabled) return { enabled: false, reason: live.reason }
  if (!live.account1 || !live.account2 || !live.account3)
    return { enabled: false, reason: 'All three MATRIX_E2E accounts are required' }
  const account4 = matrixTestAccount(4)
  if (!account4)
    return {
      enabled: false,
      reason:
        'MATRIX_E2E_ACCOUNT_4_HOMESERVER/USER/PASSWORD are required for the second independent sender',
    }
  if (!live.account1.recoveryKey)
    return {
      enabled: false,
      reason: 'MATRIX_E2E_ACCOUNT_1_RECOVERY_KEY is required for the backup-restore step',
    }

  const apkPath = value('ANDROID_E2E_APK_PATH')
  if (!apkPath) return { enabled: false, reason: 'ANDROID_E2E_APK_PATH is required' }

  return {
    enabled: true,
    value: {
      enabled: true,
      account1: live.account1,
      account2: live.account2,
      account3: live.account3,
      account4,
      roomPrefix: live.roomPrefix,
      apkPath,
      packageName: value('ANDROID_E2E_PACKAGE_NAME') || 'foxchat.jakefox.de',
      mainActivity: value('ANDROID_E2E_MAIN_ACTIVITY') || '.MainActivity',
      androidHome: value('ANDROID_HOME') || resolve(repoRoot, '.android-sdk'),
      appiumPort: Number(value('ANDROID_E2E_APPIUM_PORT') || 4723),
      baseUrl: value('E2E_BASE_URL') || 'http://127.0.0.1:4173',
      skipWebServer: value('E2E_SKIP_WEBSERVER').toLowerCase() === 'true',
    },
  }
}
