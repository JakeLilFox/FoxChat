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
  roomPrefix: string

  allowVoice: boolean
  voiceReason?: string
}

const value = (name: string) => process.env[name]?.trim() ?? ''

export const matrixTestAccount = (number: 1 | 2 | 3 | 4): MatrixTestAccount | undefined => {
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
  const account1 = matrixTestAccount(1)
  const account2 = matrixTestAccount(2)
  const account3 = matrixTestAccount(3)
  if (!account1 || !account2 || !account3)
    return {
      enabled: false,
      reason: 'All three Matrix test accounts require homeserver, user ID, and password',
      roomPrefix,
      allowVoice: false,
      voiceReason,
    }
  if (new Set([account1.userId, account2.userId, account3.userId]).size !== 3)
    return {
      enabled: false,
      reason: 'The live suite requires three different Matrix accounts',
      roomPrefix,
      allowVoice: false,
      voiceReason,
    }
  return {
    enabled: true,
    account1,
    account2,
    account3,
    roomPrefix,
    allowVoice,
    voiceReason,
  }
}
