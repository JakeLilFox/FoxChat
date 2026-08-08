import { invoke } from '@tauri-apps/api/core'
import { matrixService, normalizeHomeserverInput } from '../matrix/MatrixClientService'
import { configureAutomationApi } from './automationApi'

export type CliLoginOptions = {
  homeserver?: string
  username?: string
  password?: string
  recoveryKey?: string
  persist: boolean
  automationPort?: number
  automationKey?: string
  headless: boolean
}

const nativeAvailable = () => !!window.__TAURI_INTERNALS__?.invoke

const localpart = (userId: string) => userId.replace(/^@/, '').split(':')[0].toLowerCase()

export async function fetchCliLoginOptions(): Promise<CliLoginOptions | undefined> {
  if (!nativeAvailable()) return undefined
  try {
    return (await invoke<CliLoginOptions | null>('cli_login_options')) ?? undefined
  } catch {
    return undefined
  }
}

function findMatchingAccount(options: CliLoginOptions) {
  if (!options.homeserver || !options.username) return undefined
  const targetHost = normalizeHomeserverInput(options.homeserver).toLowerCase()
  const targetUser = localpart(options.username)
  return matrixService
    .savedAccounts()
    .find(
      (session) =>
        normalizeHomeserverInput(session.baseUrl).toLowerCase() === targetHost &&
        localpart(session.userId) === targetUser,
    )
}

export async function applyCliLogin(options: CliLoginOptions): Promise<'ready' | 'guest'> {
  try {
    if (options.persist && !options.homeserver && !options.username) {
      const session = matrixService.restoreSession()
      if (!session)
        throw new Error(
          'No saved FoxChat session to resume with --persist. Pass --homeserver, --username ' +
            'and --password to sign in for the first time.',
        )
      await matrixService.start(session)
    } else if (options.persist) {
      const existing = findMatchingAccount(options)
      if (existing) {
        matrixService.selectAccount(matrixService.savedAccountId(existing))
        await matrixService.start()
      } else if (options.homeserver && options.username && options.password) {
        await matrixService.login(options.homeserver, options.username, options.password)
      } else {
        throw new Error(
          `No saved session matches ${options.username ?? '?'} on ${options.homeserver ?? '?'}, ` +
            'and no --password was given to create one.',
        )
      }
    } else {
      if (!options.homeserver || !options.username || !options.password)
        throw new Error(
          '--homeserver, --username and --password are all required without --persist.',
        )
      await matrixService.login(options.homeserver, options.username, options.password)
    }

    if (options.recoveryKey) {
      try {
        await matrixService.unlockSecretStorage(options.recoveryKey)
      } catch (error) {
        console.error(
          '[cli] Could not unlock encrypted history with the provided recovery key:',
          error,
        )
      }
    }

    if (options.automationPort && options.automationKey)
      await configureAutomationApi(true, options.automationPort, options.automationKey)

    return 'ready'
  } catch (error) {
    console.error('[cli] Sign-in failed:', error)
    return 'guest'
  }
}
