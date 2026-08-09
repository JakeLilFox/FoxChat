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

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error))

const logToTerminal = (message: string) => {
  console.error(message)
  if (nativeAvailable()) void invoke('cli_log', { message }).catch(() => undefined)
}

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

    logToTerminal(
      `[cli] Signed in as ${matrixService.matrixClient?.getSafeUserId() ?? '(unknown user)'}`,
    )

    if (options.recoveryKey) {
      try {
        await matrixService.unlockSecretStorage(options.recoveryKey)
        logToTerminal('[cli] Unlocked encrypted history with the provided recovery key')
      } catch (error) {
        logToTerminal(
          `[cli] Could not unlock encrypted history with the provided recovery key: ${errorMessage(error)}`,
        )
      }
    }

    if (options.automationPort && options.automationKey) {
      try {
        await configureAutomationApi(true, options.automationPort, options.automationKey)
        logToTerminal(`[cli] Automation API listening on 127.0.0.1:${options.automationPort}`)
      } catch (error) {
        logToTerminal(`[cli] Automation API failed to start: ${errorMessage(error)}`)
      }
    } else if (options.automationPort || options.automationKey) {
      logToTerminal(
        '[cli] --automation-port and --automation-key must both be given to start the ' +
          'automation API; got only one, so it was not started.',
      )
    }

    return 'ready'
  } catch (error) {
    logToTerminal(`[cli] Sign-in failed: ${errorMessage(error)}`)
    return 'guest'
  }
}
