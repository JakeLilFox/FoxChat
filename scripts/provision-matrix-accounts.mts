import { randomBytes } from 'node:crypto'
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { parseArgs } from 'node:util'

import { parse as parseDotenv } from 'dotenv'
import { ClientEvent, createClient } from 'matrix-js-sdk'
import { deriveRecoveryKeyFromPassphrase } from 'matrix-js-sdk/lib/crypto-api/key-passphrase.js'
import { encodeRecoveryKey } from 'matrix-js-sdk/lib/crypto-api/recovery-key.js'

const TOKEN_STAGES = new Set([
  'm.login.registration_token',
  'org.matrix.msc3231.login.registration_token',
])
const SUPPORTED_STAGES = new Set(['m.login.dummy', 'm.login.terms', ...TOKEN_STAGES])
const CONNECT_FAILURE_CODES = new Set([
  'UND_ERR_CONNECT_TIMEOUT',
  'ECONNREFUSED',
  'ECONNRESET',
  'ENOTFOUND',
  'EAI_AGAIN',
])

type MatrixResponse = {
  response: Response
  data: Record<string, unknown>
}

type RegistrationSession = {
  accessToken: string
  userId: string
  deviceId: string
}

type ProvisionedAccount = {
  homeserver: string
  userId: string
  password: string
  recoveryKey?: string
  backupVersion?: string
}

const { values } = parseArgs({
  options: {
    homeserver: { type: 'string' },
    count: { type: 'string', default: '4' },
    prefix: { type: 'string' },
    'account-start': { type: 'string', default: '1' },
    output: { type: 'string' },
    resume: { type: 'boolean', default: false },
    force: { type: 'boolean', default: false },
    'accept-terms': { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h', default: false },
  },
  strict: true,
})

if (values.help) {
  console.log(`Create dedicated Matrix E2E accounts and initialize encrypted recovery.

Usage:
  npm run provision:matrix-accounts -- --homeserver https://matrix.example --count 4

Secrets are read from the environment so they do not appear in the process list:
  MATRIX_PROVISION_REGISTRATION_TOKEN  Registration token/code
  MATRIX_PROVISION_BACKUP_PASSPHRASE  Passphrase used to derive each account's recovery key

Options:
  --prefix <localpart-prefix>  Default: jake-<timestamp>-
  --account-start <number>     First MATRIX_E2E_ACCOUNT_N index (default: 1)
  --output <path>              Destination dotenv file under test-results by default
  --resume                     Resume and repair accounts already saved in --output
  --accept-terms               Accept m.login.terms if the homeserver requires it
  --force                      Replace an existing output file

The output contains generated passwords and recovery keys. Keep it out of source control.`)
  process.exit(0)
}

const inputHomeserver = values.homeserver ?? process.env.MATRIX_PROVISION_HOMESERVER
const registrationToken = process.env.MATRIX_PROVISION_REGISTRATION_TOKEN
const backupPassphrase = process.env.MATRIX_PROVISION_BACKUP_PASSPHRASE
if (!inputHomeserver) throw new Error('--homeserver or MATRIX_PROVISION_HOMESERVER is required')
if (!backupPassphrase || backupPassphrase.length < 12)
  throw new Error('MATRIX_PROVISION_BACKUP_PASSPHRASE must contain at least 12 characters')
const provisionBackupPassphrase = backupPassphrase

const count = Number(values.count)
const accountStart = Number(values['account-start'])
if (!Number.isInteger(count) || count < 1)
  throw new Error('--count must be an integer bigger than or 1')
if (!Number.isInteger(accountStart) || accountStart < 1)
  throw new Error('--account-start must be a positive integer')

const defaultPrefix = `jake-${Date.now().toString(36)}-`
const prefix = (values.prefix ?? defaultPrefix).toLowerCase()
if (!/^[a-z0-9._=/-]+$/.test(prefix))
  throw new Error('--prefix contains characters that are invalid in a Matrix user localpart')

const defaultOutput = `test-results/provisioned-matrix-accounts-${Date.now()}.env`
const outputPath = resolve(values.output ?? defaultOutput)
const accounts: ProvisionedAccount[] = []

if (values.resume && !values.output) throw new Error('--resume requires an explicit --output file')
if (values.resume && values.force) throw new Error('--resume and --force cannot be used together')

const delay = (milliseconds: number) =>
  new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds))

async function withTimeout<T>(promise: Promise<T>, label: string, timeoutMs = 120_000) {
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error(`${label} timed out after ${timeoutMs} ms`)),
          timeoutMs,
        )
      }),
    ])
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}

const quietMatrixLogger = {
  trace: () => undefined,
  debug: () => undefined,
  info: () => undefined,
  warn: (...messages: unknown[]) => console.warn('[matrix-sdk]', ...messages),
  error: (...messages: unknown[]) => console.error('[matrix-sdk]', ...messages),
  getChild: () => quietMatrixLogger,
}

function retryDelay(response: Response, data: Record<string, unknown>, attempt: number) {
  if (typeof data.retry_after_ms === 'number') return Math.max(0, data.retry_after_ms) + 250
  const retryAfter = Number(response.headers.get('retry-after'))
  if (Number.isFinite(retryAfter)) return Math.max(0, retryAfter * 1000) + 250
  return attempt * 2_000
}

async function matrixRequest(
  baseUrl: string,
  path: string,
  options: RequestInit = {},
  attempts = 4,
): Promise<MatrixResponse> {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await fetch(`${baseUrl}${path}`, {
        ...options,
        headers: {
          ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
          ...options.headers,
        },
        signal: AbortSignal.timeout(90_000),
      })
      const data = (await response.json().catch(() => ({}))) as Record<string, unknown>
      const retryable = response.status === 429 || response.status >= 500
      if (!retryable || attempt === attempts) return { response, data }
      const waitMs = retryDelay(response, data, attempt)
      console.warn(`[matrix] ${response.status} from ${path}; retrying in ${waitMs} ms`)
      await delay(waitMs)
    } catch (error) {
      const code = (error as { cause?: { code?: string } })?.cause?.code
      if (attempt === attempts || !code || !CONNECT_FAILURE_CODES.has(code)) throw error
      const waitMs = attempt * 2_000
      console.warn(`[matrix] ${code} from ${path}; retrying in ${waitMs} ms`)
      await delay(waitMs)
    }
  }
  throw new Error(`Matrix request exhausted its retries: ${path}`)
}

async function discoverHomeserver(value: string) {
  const normalized = (/^https?:\/\//i.test(value) ? value : `https://${value}`).replace(/\/$/, '')
  try {
    const { response, data } = await matrixRequest(normalized, '/.well-known/matrix/client', {}, 2)
    const discovered = (data['m.homeserver'] as { base_url?: unknown } | undefined)?.base_url
    if (response.ok && typeof discovered === 'string' && discovered)
      return new URL(discovered, normalized).toString().replace(/\/$/, '')
  } catch (error) {
    console.warn(
      `[discovery] Could not read .well-known (${error instanceof Error ? error.message : error}); using ${normalized}`,
    )
  }
  return normalized
}

function matrixError(action: string, result: MatrixResponse) {
  const code = typeof result.data.errcode === 'string' ? ` ${result.data.errcode}` : ''
  const detail =
    typeof result.data.error === 'string'
      ? `: ${result.data.error}`
      : `: HTTP ${result.response.status}`
  return new Error(`${action} failed (${result.response.status})${code}${detail}`)
}

function nextRegistrationStage(data: Record<string, unknown>) {
  const completed = Array.isArray(data.completed)
    ? data.completed.filter((stage): stage is string => typeof stage === 'string')
    : []
  const completedSet = new Set(completed)
  const flows = Array.isArray(data.flows)
    ? data.flows.flatMap((flow) => {
        if (
          !flow ||
          typeof flow !== 'object' ||
          !Array.isArray((flow as { stages?: unknown }).stages)
        )
          return []
        const stages = (flow as { stages: unknown[] }).stages.filter(
          (stage): stage is string => typeof stage === 'string',
        )
        return completed.every((stage) => stages.includes(stage)) ? [stages] : []
      })
    : []
  const selected = flows
    .filter((stages) => stages.every((stage) => SUPPORTED_STAGES.has(stage)))
    .sort((left, right) => left.length - right.length)[0]
  return selected?.find((stage) => !completedSet.has(stage))
}

async function registerAccount(
  homeserver: string,
  username: string,
  password: string,
): Promise<RegistrationSession> {
  const registration = {
    username,
    password,
    initial_device_display_name: 'FoxChat E2E provisioning',
    refresh_token: false,
  }
  let auth: Record<string, unknown> | undefined
  for (let step = 0; step < 10; step++) {
    const result = await matrixRequest(homeserver, '/_matrix/client/v3/register', {
      method: 'POST',
      body: JSON.stringify({ ...registration, ...(auth ? { auth } : {}) }),
    })
    if (result.response.ok) {
      const accessToken = result.data.access_token
      const userId = result.data.user_id
      const deviceId = result.data.device_id
      if (
        typeof accessToken !== 'string' ||
        typeof userId !== 'string' ||
        typeof deviceId !== 'string'
      )
        throw new Error('Registration succeeded without an access token, user ID, or device ID')
      return { accessToken, userId, deviceId }
    }
    if (result.response.status !== 401) throw matrixError(`Registering ${username}`, result)
    const session = result.data.session
    const stage = nextRegistrationStage(result.data)
    if (typeof session !== 'string' || !stage) {
      const advertised = Array.isArray(result.data.flows)
        ? JSON.stringify(result.data.flows)
        : 'none'
      throw new Error(`Homeserver requires an unsupported registration flow: ${advertised}`)
    }
    if (TOKEN_STAGES.has(stage)) {
      if (!registrationToken)
        throw new Error(`Homeserver requires ${stage}; set MATRIX_PROVISION_REGISTRATION_TOKEN`)
      auth = { type: stage, token: registrationToken, session }
    } else if (stage === 'm.login.terms') {
      if (!values['accept-terms'])
        throw new Error(
          'Homeserver requires m.login.terms; inspect its policies and pass --accept-terms',
        )
      auth = { type: stage, session }
    } else {
      auth = { type: stage, session }
    }
  }
  throw new Error(`Homeserver requested too many registration stages for ${username}`)
}

async function loginAccount(
  homeserver: string,
  userId: string,
  password: string,
): Promise<RegistrationSession> {
  const result = await matrixRequest(homeserver, '/_matrix/client/v3/login', {
    method: 'POST',
    body: JSON.stringify({
      type: 'm.login.password',
      identifier: { type: 'm.id.user', user: userId },
      password,
      initial_device_display_name: 'FoxChat E2E provisioning repair',
      refresh_token: false,
    }),
  })
  if (!result.response.ok) throw matrixError(`Logging in ${userId}`, result)
  const accessToken = result.data.access_token
  const canonicalUserId = result.data.user_id
  const deviceId = result.data.device_id
  if (
    typeof accessToken !== 'string' ||
    typeof canonicalUserId !== 'string' ||
    typeof deviceId !== 'string'
  )
    throw new Error(`Login for ${userId} succeeded without complete session information`)
  return { accessToken, userId: canonicalUserId, deviceId }
}

async function startClientAndWaitForSync(client: ReturnType<typeof createClient>) {
  if (['PREPARED', 'SYNCING'].includes(String(client.getSyncState()).toUpperCase())) return

  let cleanup = () => undefined
  const initialSync = new Promise<void>((resolveSync, rejectSync) => {
    const onSync = (state: unknown) => {
      if (!['PREPARED', 'SYNCING'].includes(String(state).toUpperCase())) return
      cleanup()
      resolveSync()
    }
    const timeout = setTimeout(() => {
      cleanup()
      rejectSync(new Error('Initial Matrix sync timed out after 60 seconds'))
    }, 60_000)
    cleanup = () => {
      clearTimeout(timeout)
      client.off(ClientEvent.Sync, onSync)
    }
    client.on(ClientEvent.Sync, onSync)
  })

  try {
    await client.startClient({
      initialSyncLimit: 0,
      lazyLoadMembers: true,
      disablePresence: true,
      pollTimeout: 1_000,
    })
    await initialSync
  } catch (error) {
    cleanup()
    throw error
  }
}

async function initializeRecovery(
  homeserver: string,
  session: RegistrationSession,
  password: string,
) {
  const secretStorageKeys = new Map<string, Uint8Array<ArrayBuffer>>()
  let recoveryKey: string | undefined
  const client = createClient({
    baseUrl: homeserver,
    accessToken: session.accessToken,
    userId: session.userId,
    deviceId: session.deviceId,
    logger: quietMatrixLogger,
    cryptoCallbacks: {
      getSecretStorageKey: async ({ keys }) => {
        for (const [keyId, keyInfo] of Object.entries(keys)) {
          const key = secretStorageKeys.get(keyId)
          if (key) return [keyId, key]
          const passphrase = keyInfo.passphrase
          if (passphrase?.algorithm !== 'm.pbkdf2') continue
          const derivedSource = await deriveRecoveryKeyFromPassphrase(
            provisionBackupPassphrase,
            passphrase.salt,
            passphrase.iterations,
            passphrase.bits,
          )
          const derived = new Uint8Array(new ArrayBuffer(derivedSource.byteLength))
          derived.set(derivedSource)
          secretStorageKeys.set(keyId, derived)
          recoveryKey = encodeRecoveryKey(derived)
          return [keyId, derived]
        }
        return null
      },
      cacheSecretStorageKey: (keyId, _keyInfo, key) => {
        secretStorageKeys.set(keyId, key)
      },
    },
  })
  try {
    await withTimeout(
      client.initRustCrypto({ useIndexedDB: false }),
      `Initializing encryption for ${session.userId}`,
    )
    await startClientAndWaitForSync(client)
    const crypto = client.getCrypto()
    if (!crypto) throw new Error('Matrix Rust crypto did not initialize')

    const existingBackup = await withTimeout(
      crypto.getKeyBackupInfo(),
      `Checking backup for ${session.userId}`,
    )
    // Establish secret storage first, then cross-signing, then backup. That lets cross-signing
    // persist its private keys and lets the backup carry a master-key signature immediately.
    await withTimeout(
      crypto.bootstrapSecretStorage({
        createSecretStorageKey: async () => {
          const generated = await crypto.createRecoveryKeyFromPassphrase(provisionBackupPassphrase)
          recoveryKey = generated.encodedPrivateKey
          return generated
        },
      }),
      `Creating secret storage for ${session.userId}`,
    )
    await withTimeout(
      crypto.bootstrapCrossSigning({
        authUploadDeviceSigningKeys: (makeRequest) =>
          makeRequest({
            type: 'm.login.password',
            identifier: { type: 'm.id.user', user: session.userId },
            password,
          }),
      }),
      `Creating cross-signing keys for ${session.userId}`,
    )
    await withTimeout(
      crypto.bootstrapSecretStorage({ setupNewKeyBackup: !existingBackup?.version }),
      `Creating encrypted backup for ${session.userId}`,
    )
    await withTimeout(
      crypto.loadSessionBackupPrivateKeyFromSecretStorage(),
      `Loading the backup key for ${session.userId}`,
    )
    await withTimeout(crypto.checkKeyBackupAndEnable(), `Enabling backup for ${session.userId}`)

    const defaultKey = await client.secretStorage.getKey()
    const passphraseInfo = defaultKey?.[1].passphrase
    if (!defaultKey || !passphraseInfo || passphraseInfo.algorithm !== 'm.pbkdf2')
      throw new Error('Secret storage was not configured with the requested passphrase')
    const derivedKey = await deriveRecoveryKeyFromPassphrase(
      provisionBackupPassphrase,
      passphraseInfo.salt,
      passphraseInfo.iterations,
      passphraseInfo.bits,
    )
    if (!(await client.secretStorage.checkKey(derivedKey, defaultKey[1])))
      throw new Error('The configured passphrase did not unlock secret storage')
    recoveryKey = encodeRecoveryKey(derivedKey)

    const backup = await crypto.getKeyBackupInfo()
    if (!backup?.version) throw new Error('Homeserver did not create a server-side key backup')
    if (!(await crypto.isSecretStorageReady()))
      throw new Error('Secret storage is missing cross-signing or backup secrets')
    if (!recoveryKey) throw new Error('Matrix SDK did not return a printable recovery key')
    return { recoveryKey, backupVersion: backup.version }
  } finally {
    client.stopClient()
  }
}

function dotenvValue(value: string) {
  return JSON.stringify(value)
}

async function loadSavedAccounts() {
  const parsed = parseDotenv(await readFile(outputPath))
  const indices = Object.keys(parsed)
    .flatMap((key) => {
      const match = /^MATRIX_E2E_ACCOUNT_(\d+)_USER$/.exec(key)
      return match ? [Number(match[1])] : []
    })
    .filter((index) => index >= accountStart)
    .sort((left, right) => left - right)

  return indices.map((index) => {
    const key = `MATRIX_E2E_ACCOUNT_${index}`
    const homeserver = parsed[`${key}_HOMESERVER`]
    const userId = parsed[`${key}_USER`]
    const password = parsed[`${key}_PASSWORD`]
    const recoveryKey = parsed[`${key}_RECOVERY_KEY`] || undefined
    if (!homeserver || !userId || !password)
      throw new Error(`Saved account ${index} is missing its homeserver, user ID, or password`)
    return { homeserver, userId, password, recoveryKey } satisfies ProvisionedAccount
  })
}

function renderOutput(homeserver: string) {
  const lines = [
    '# Generated by npm run provision:matrix-accounts.',
    '# Contains live credentials and recovery keys. Do not commit this file.',
    '# The shared backup passphrase is intentionally not written here.',
    '',
  ]
  accounts.forEach((account, offset) => {
    const index = accountStart + offset
    lines.push(
      `MATRIX_E2E_ACCOUNT_${index}_HOMESERVER=${dotenvValue(homeserver)}`,
      `MATRIX_E2E_ACCOUNT_${index}_USER=${dotenvValue(account.userId)}`,
      `MATRIX_E2E_ACCOUNT_${index}_PASSWORD=${dotenvValue(account.password)}`,
      `MATRIX_E2E_ACCOUNT_${index}_RECOVERY_KEY=${dotenvValue(account.recoveryKey ?? '')}`,
      ...(account.backupVersion
        ? [`# Key backup version: ${account.backupVersion}`]
        : account.recoveryKey
          ? ['# Encrypted backup was provisioned in an earlier run.']
          : ['# WARNING: encrypted backup setup did not complete for this account.']),
      '',
    )
  })
  return `${lines.join('\n')}\n`
}

async function saveOutput(homeserver: string, initial = false) {
  await mkdir(dirname(outputPath), { recursive: true })
  await writeFile(outputPath, renderOutput(homeserver), {
    encoding: 'utf8',
    mode: 0o600,
    flag: initial && !values.force ? 'wx' : 'w',
  })
  await chmod(outputPath, 0o600).catch(() => undefined)
}

async function removeProvisioningDevice(
  homeserver: string,
  session: RegistrationSession,
  accountNumber: number,
) {
  const logout = await matrixRequest(homeserver, '/_matrix/client/v3/logout', {
    method: 'POST',
    headers: { Authorization: `Bearer ${session.accessToken}` },
    body: JSON.stringify({}),
  }).catch(() => undefined)
  if (!logout?.response.ok)
    console.warn(`[account ${accountNumber}/${count}] Could not remove provisioning device`)
}

const homeserver = await discoverHomeserver(inputHomeserver)
if (values.resume) {
  accounts.push(...(await loadSavedAccounts()))
  if (accounts.length > count)
    throw new Error(
      `The resume file already contains ${accounts.length} accounts, more than --count ${count}`,
    )
  const mismatched = accounts.find(
    (account) => account.homeserver.replace(/\/$/, '') !== homeserver,
  )
  if (mismatched)
    throw new Error(
      `Resume file homeserver ${mismatched.homeserver} does not match requested ${homeserver}`,
    )
  console.log(`Resuming ${accounts.length}/${count} Matrix accounts from ${outputPath}`)
} else {
  await saveOutput(homeserver, true)
  console.log(`Provisioning ${count} Matrix accounts on ${homeserver}`)
}
console.log(`Credentials will be written to ${outputPath}`)

try {
  for (let offset = 0; offset < accounts.length; offset++) {
    const account = accounts[offset]
    if (account.recoveryKey) continue
    const accountNumber = offset + 1
    console.log(`[account ${accountNumber}/${count}] Repairing backup for ${account.userId}`)
    const session = await loginAccount(homeserver, account.userId, account.password)
    try {
      const recovery = await initializeRecovery(homeserver, session, account.password)
      account.recoveryKey = recovery.recoveryKey
      account.backupVersion = recovery.backupVersion
      await saveOutput(homeserver)
      console.log(`[account ${accountNumber}/${count}] Encrypted backup and recovery are ready`)
    } finally {
      await removeProvisioningDevice(homeserver, session, accountNumber)
    }
  }

  let candidate = 1
  while (accounts.length < count) {
    const username = `${prefix}${candidate++}`
    const password = randomBytes(32).toString('base64url')
    let session: RegistrationSession
    try {
      session = await registerAccount(homeserver, username, password)
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.includes('M_USER_IN_USE') &&
        candidate <= count * 20
      ) {
        console.warn(`[account] ${username} already exists; trying the next suffix`)
        continue
      }
      throw error
    }

    const account: ProvisionedAccount = { homeserver, userId: session.userId, password }
    accounts.push(account)
    // Persist the generated password immediately so a later crypto failure never leaves an
    // inaccessible account behind.
    await saveOutput(homeserver)
    console.log(`[account ${accounts.length}/${count}] Registered ${session.userId}`)

    try {
      const recovery = await initializeRecovery(homeserver, session, password)
      account.recoveryKey = recovery.recoveryKey
      account.backupVersion = recovery.backupVersion
      await saveOutput(homeserver)
      console.log(`[account ${accounts.length}/${count}] Encrypted backup and recovery are ready`)
    } finally {
      await removeProvisioningDevice(homeserver, session, accounts.length)
    }
  }
} catch (error) {
  await saveOutput(homeserver).catch(() => undefined)
  console.error(`Provisioning stopped. Completed credentials remain in ${outputPath}`)
  throw error
}

console.log(`Provisioned ${accounts.length} accounts successfully.`)
