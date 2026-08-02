export type MatrixTestAccount = {
  homeserver: string
  userId: string
  password: string
  recoveryKey?: string
}

export type LiveMatrixConfig = {
  enabled: boolean
  reason?: string
  account1?: MatrixTestAccount
  account2?: MatrixTestAccount
  account3?: MatrixTestAccount
  account4?: MatrixTestAccount
  accountNumbers?: [number, number, number, number]
  roomPrefix: string

  allowVoice: boolean
  voiceReason?: string
}

const value = (name: string) => process.env[name]?.trim() ?? ''

export const matrixTestAccount = (number: number): MatrixTestAccount | undefined => {
  if (!Number.isInteger(number) || number < 1) return undefined
  const prefix = `MATRIX_E2E_ACCOUNT_${number}`
  const homeserver = value(`${prefix}_HOMESERVER`).replace(/\/$/, '')
  const userId = value(`${prefix}_USER`)
  const password = value(`${prefix}_PASSWORD`)
  if (!homeserver || !userId || !password) return undefined
  return {
    homeserver,
    userId,
    password,
    recoveryKey: value(`${prefix}_RECOVERY_KEY`) || undefined,
  }
}

export function matrixE2EAccountPool() {
  const completeNumbers = Object.keys(process.env)
    .flatMap((key) => {
      const match = /^MATRIX_E2E_ACCOUNT_(\d+)_USER$/.exec(key)
      return match ? [Number(match[1])] : []
    })
    .filter((number) => matrixTestAccount(number) !== undefined)
    .sort((left, right) => left - right)
  const seenAccounts = new Set<string>()
  const duplicateAccountNumbers: number[] = []
  const configuredNumbers = completeNumbers.filter((number) => {
    const account = matrixTestAccount(number)!
    const identity = `${account.homeserver}\0${account.userId}`
    if (seenAccounts.has(identity)) {
      duplicateAccountNumbers.push(number)
      return false
    }
    seenAccounts.add(identity)
    return true
  })

  const groups: Array<[number, number, number, number]> = []
  for (let offset = 0; offset + 3 < configuredNumbers.length; offset += 4) {
    groups.push([
      configuredNumbers[offset],
      configuredNumbers[offset + 1],
      configuredNumbers[offset + 2],
      configuredNumbers[offset + 3],
    ])
  }

  const parsedWorkerIndex = Number(value('TEST_WORKER_INDEX'))
  const workerIndex =
    Number.isInteger(parsedWorkerIndex) && parsedWorkerIndex > 0 ? parsedWorkerIndex : 1
  const groupIndex = groups.length ? (workerIndex - 1) % groups.length : 0
  return {
    configuredAccounts: completeNumbers.length,
    uniqueAccounts: configuredNumbers.length,
    duplicateAccountNumbers,
    workerCapacity: groups.length,
    accountNumbers: groups[groupIndex],
  }
}

export function liveMatrixConfig(): LiveMatrixConfig {
  const roomPrefix = value('E2E_ROOM_PREFIX') || 'FoxChat E2E'
  const allowVoice = value('MATRIX_E2E_ALLOW_VOICE').toLowerCase() === 'true'
  const voiceReason = allowVoice ? undefined : 'MATRIX_E2E_ALLOW_VOICE is not true'
  if (value('MATRIX_E2E_ENABLED').toLowerCase() !== 'true')
    return {
      enabled: false,
      reason: 'MATRIX_E2E_ENABLED is not true',
      roomPrefix,
      allowVoice: false,
      voiceReason,
    }
  if (value('MATRIX_E2E_ALLOW_ROOM_MUTATION').toLowerCase() !== 'true')
    return {
      enabled: false,
      reason: 'MATRIX_E2E_ALLOW_ROOM_MUTATION is not true',
      roomPrefix,
      allowVoice: false,
      voiceReason,
    }
  if (value('MATRIX_E2E_ALLOW_DEVICE_RESET').toLowerCase() !== 'true')
    return {
      enabled: false,
      reason: 'MATRIX_E2E_ALLOW_DEVICE_RESET is not true',
      roomPrefix,
      allowVoice: false,
      voiceReason,
    }
  const pool = matrixE2EAccountPool()
  const accountNumbers = pool.accountNumbers
  const account1 = accountNumbers ? matrixTestAccount(accountNumbers[0]) : undefined
  const account2 = accountNumbers ? matrixTestAccount(accountNumbers[1]) : undefined
  const account3 = accountNumbers ? matrixTestAccount(accountNumbers[2]) : undefined
  const account4 = accountNumbers ? matrixTestAccount(accountNumbers[3]) : undefined
  if (!account1 || !account2 || !account3 || !account4)
    return {
      enabled: false,
      reason: 'The Matrix account pool needs at least four complete accounts',
      roomPrefix,
      allowVoice: false,
      voiceReason,
    }
  if (new Set([account1.userId, account2.userId, account3.userId, account4.userId]).size !== 4)
    return {
      enabled: false,
      reason: 'Each live-suite worker requires four different Matrix accounts',
      roomPrefix,
      allowVoice: false,
      voiceReason,
    }
  return {
    enabled: true,
    account1,
    account2,
    account3,
    account4,
    accountNumbers,
    roomPrefix,
    allowVoice,
    voiceReason,
  }
}
