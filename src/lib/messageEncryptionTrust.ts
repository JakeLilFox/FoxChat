import { EventShieldReason } from 'matrix-js-sdk/lib/crypto-api'

export type MessageEncryptionTrust = {
  kind: 'verified' | 'unverified' | 'unknown' | 'warning'
  deviceId?: string
  deviceName?: string
  signedByOwner?: boolean
  warningLevel?: 'low' | 'high'
  reason?: EventShieldReason | 'DECRYPTION_FAILURE'
}

const deviceLabel = (trust: MessageEncryptionTrust) =>
  trust.deviceName
    ? `${trust.deviceName}${trust.deviceId ? ` (${trust.deviceId})` : ''}`
    : trust.deviceId

const warningText = (reason: MessageEncryptionTrust['reason']) => {
  switch (reason) {
    case EventShieldReason.AUTHENTICITY_NOT_GUARANTEED:
      return 'the session key was forwarded or restored without trusted authenticity information'
    case EventShieldReason.UNKNOWN_DEVICE:
      return 'the sending device is unknown or was deleted'
    case EventShieldReason.UNSIGNED_DEVICE:
      return 'the sending device is not signed by its owner'
    case EventShieldReason.UNVERIFIED_IDENTITY:
      return "the sender's identity is not verified"
    case EventShieldReason.VERIFICATION_VIOLATION:
      return "the sender's previously verified identity changed"
    case EventShieldReason.MISMATCHED_SENDER:
    case EventShieldReason.MISMATCHED_SENDER_KEY:
      return 'the encrypted session does not match the claimed sender'
    case EventShieldReason.SENT_IN_CLEAR:
      return 'the event was sent without encryption'
    case 'DECRYPTION_FAILURE':
      return 'this device could not decrypt the message or verify its sender'
    default:
      return 'the authenticity check returned an unknown warning'
  }
}

export function messageEncryptionTrustPresentation(trust?: MessageEncryptionTrust) {
  if (!trust)
    return {
      color: '#8c8c8c',
      tooltip: 'Encrypted · checking sender device verification…',
    }

  const device = deviceLabel(trust)
  if (trust.kind === 'verified')
    return {
      color: '#35c978',
      tooltip: `Encrypted · verified device${device ? `: ${device}` : ''}`,
    }
  if (trust.kind === 'unverified')
    return {
      color: '#faad14',
      tooltip: trust.signedByOwner
        ? `Encrypted · device is signed by its owner, but the sender identity is not verified${device ? `: ${device}` : ''}`
        : `Encrypted · unverified device${device ? `: ${device}` : ''}`,
    }
  if (trust.kind === 'warning')
    return {
      color: trust.warningLevel === 'low' ? '#faad14' : '#ff4d4f',
      tooltip: `Encrypted · warning: ${warningText(trust.reason)}`,
    }
  return {
    color: '#8c8c8c',
    tooltip: 'Encrypted · sender device verification unavailable',
  }
}
