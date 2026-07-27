import {
  Alert,
  App as AntApp,
  Button,
  Collapse,
  Descriptions,
  Empty,
  Spin,
  Tag,
  Typography,
} from 'antd'
import { ReloadOutlined, SafetyCertificateOutlined } from '@ant-design/icons'
import { useEffect, useState } from 'react'
import { Room } from 'matrix-js-sdk'
import { MemberAvatar } from '../../profile'
import {
  matrixService,
  type MatrixPublicSignature,
  type MatrixRoomMemberSecurity,
} from '../../../matrix/MatrixClientService'

type RoomSecurityData = {
  viewingAs: string
  members: MatrixRoomMemberSecurity[]
}

const shortened = (value: string) =>
  value.length > 32 ? `${value.slice(0, 18)}…${value.slice(-10)}` : value

function CopyableKey({ value }: { value?: string }) {
  if (!value) return <span style={{ opacity: 0.65 }}>Not published</span>
  return (
    <Typography.Text code copyable={{ text: value }}>
      {shortened(value)}
    </Typography.Text>
  )
}

function Signatures({ signatures }: { signatures: MatrixPublicSignature[] }) {
  if (!signatures.length) {
    return <span style={{ opacity: 0.65 }}>None published</span>
  }
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      {signatures.map((signature, index) => (
        <div key={`${signature.signer}:${signature.keyId}:${index}`} style={{ minWidth: 0 }}>
          <div>
            <code>{signature.signer}</code> · <code>{signature.keyId}</code>
          </div>
          <CopyableKey value={signature.signature} />
        </div>
      ))}
    </div>
  )
}

const identityTag = (member: MatrixRoomMemberSecurity) => {
  if (member.identity.needsApproval) {
    return <Tag color="error">Identity changed</Tag>
  }
  if (member.identity.verified) {
    return <Tag color="success">Identity verified</Tag>
  }
  if (member.identity.known) {
    return <Tag color="blue">Identity known</Tag>
  }
  return <Tag>Identity unavailable</Tag>
}

const crossSigningLabel: Record<string, string> = {
  master_key: 'Master identity key',
  self_signing_key: 'Device-signing key',
  user_signing_key: 'User-signing key',
}

function MemberSecurity({ member }: { member: MatrixRoomMemberSecurity }) {
  return (
    <div>
      <div style={{ marginBottom: 14 }}>
        <code>{member.userId}</code>
        <div style={{ marginTop: 8 }}>
          {identityTag(member)}
          {member.identity.crossSigningVerified && (
            <Tag color="success">Cross-signing verified</Tag>
          )}
          {member.identity.previouslyVerified && !member.identity.crossSigningVerified && (
            <Tag color="warning">Previously verified</Tag>
          )}
        </div>
      </div>
      {member.identity.needsApproval && (
        <Alert
          type="error"
          showIcon
          message="This user’s cryptographic identity changed"
          description="Verify the user again before relying on newly signed devices."
          style={{ marginBottom: 14 }}
        />
      )}
      <h4>Devices · {member.devices.length}</h4>
      {member.devices.length ? (
        <Collapse
          size="small"
          items={member.devices.map((device) => ({
            key: device.deviceId,
            label: (
              <span>
                {device.displayName} <code>{device.deviceId}</code>{' '}
                {device.blocked ? (
                  <Tag color="error">Blocked</Tag>
                ) : device.verified ? (
                  <Tag color="success">Verified</Tag>
                ) : device.signedByOwner ? (
                  <Tag color="blue">Signed by owner</Tag>
                ) : (
                  <Tag color="warning">Unsigned</Tag>
                )}
                {device.dehydrated && <Tag>Dehydrated</Tag>}
              </span>
            ),
            children: (
              <>
                <Descriptions
                  size="small"
                  bordered
                  column={1}
                  items={[
                    {
                      key: 'device-id',
                      label: 'Device ID',
                      children: <CopyableKey value={device.deviceId} />,
                    },
                    {
                      key: 'trust',
                      label: 'Overall trust',
                      children: device.blocked
                        ? 'Blocked'
                        : device.verified
                          ? 'Verified'
                          : 'Unverified',
                    },
                    {
                      key: 'owner-signature',
                      label: 'Signed by owner',
                      children: device.signedByOwner ? 'Yes' : 'No',
                    },
                    {
                      key: 'cross-signing',
                      label: 'Cross-signing verified',
                      children: device.crossSigningVerified ? 'Yes' : 'No',
                    },
                    {
                      key: 'local-verification',
                      label: 'Locally verified',
                      children: device.locallyVerified ? 'Yes' : 'No',
                    },
                    {
                      key: 'tofu',
                      label: 'Trust on first use',
                      children: device.tofu ? 'Yes' : 'No',
                    },
                    {
                      key: 'dehydrated',
                      label: 'Dehydrated device',
                      children: device.dehydrated ? 'Yes' : 'No',
                    },
                    {
                      key: 'fingerprint',
                      label: 'Ed25519 fingerprint',
                      children: <CopyableKey value={device.fingerprint} />,
                    },
                    {
                      key: 'identity-key',
                      label: 'Curve25519 identity key',
                      children: <CopyableKey value={device.identityKey} />,
                    },
                    {
                      key: 'algorithms',
                      label: 'Encryption algorithms',
                      children: device.algorithms.length
                        ? device.algorithms.map((algorithm) => (
                            <Tag key={algorithm}>{algorithm}</Tag>
                          ))
                        : 'None published',
                    },
                    {
                      key: 'signatures',
                      label: `Published signatures · ${device.signatures.length}`,
                      children: <Signatures signatures={device.signatures} />,
                    },
                  ]}
                />
              </>
            ),
          }))}
        />
      ) : (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="No encryption-capable devices were published"
        />
      )}
      <h4 style={{ marginTop: 18 }}>
        Cross-signing public keys · {member.crossSigningKeys.length}
      </h4>
      {member.crossSigningKeys.length ? (
        <Collapse
          size="small"
          items={member.crossSigningKeys.map((key) => ({
            key: `${key.type}:${key.keyId}`,
            label: crossSigningLabel[key.type] ?? key.type,
            children: (
              <Descriptions
                size="small"
                bordered
                column={1}
                items={[
                  {
                    key: 'usage',
                    label: 'Usage',
                    children: key.usage.join(', ') || 'Not specified',
                  },
                  {
                    key: 'key-id',
                    label: 'Key ID',
                    children: <CopyableKey value={key.keyId} />,
                  },
                  {
                    key: 'public-key',
                    label: 'Public key',
                    children: <CopyableKey value={key.key} />,
                  },
                  {
                    key: 'signatures',
                    label: `Published signatures · ${key.signatures.length}`,
                    children: <Signatures signatures={key.signatures} />,
                  },
                ]}
              />
            ),
          }))}
        />
      ) : (
        <p style={{ opacity: 0.65 }}>No cross-signing keys published.</p>
      )}
    </div>
  )
}

export function RoomSecuritySettings({ room }: { room: Room }) {
  const { message } = AntApp.useApp()
  const [requesting, setRequesting] = useState(false)
  const [security, setSecurity] = useState<RoomSecurityData>()
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string>()
  const [revision, setRevision] = useState(0)
  const userId = matrixService.roomVerificationUser(room)
  const member = userId ? room.getMember(userId) : undefined
  const encrypted = room.hasEncryptionStateEvent()

  useEffect(() => {
    let active = true
    setLoading(true)
    setLoadError(undefined)
    void matrixService
      .getRoomMemberSecurity(room)
      .then((result) => {
        if (active) setSecurity(result)
      })
      .catch((error) => {
        if (!active) return
        setLoadError(error instanceof Error ? error.message : 'Could not load device security')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [room, revision])

  useEffect(
    () =>
      matrixService.subscribe({
        onSync: (state) => {
          if (
            state.includes('CRYPTO_DEVICES_UPDATED') ||
            state.includes('CRYPTO_USER_TRUST_STATUS_CHANGED')
          ) {
            setRevision((value) => value + 1)
          }
        },
      }),
    [],
  )

  const startVerification = async () => {
    setRequesting(true)
    try {
      await matrixService.requestRoomVerification(room)
    } catch (error) {
      message.error(error instanceof Error ? error.message : 'Could not start verification')
    } finally {
      setRequesting(false)
    }
  }

  return (
    <div>
      <h2>Room security</h2>
      <p>
        <Tag color={encrypted ? 'success' : 'warning'}>
          {encrypted ? 'End-to-end encrypted' : 'Not encrypted'}
        </Tag>
      </p>
      <h3>Verify this conversation</h3>
      {userId ? (
        <>
          <p>
            Compare emoji with <b>{member?.name || userId}</b> to confirm that you are talking to
            the intended person and that their encryption identity has not been replaced.
          </p>
          <p style={{ opacity: 0.7 }}>{userId}</p>
          <Button
            type="primary"
            icon={<SafetyCertificateOutlined />}
            loading={requesting}
            onClick={() => void startVerification()}
          >
            Start verification
          </Button>
        </>
      ) : (
        <p>
          User verification is available in direct chats. This room is not marked as a direct chat
          for the account viewing it.
        </p>
      )}

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          marginTop: 28,
        }}
      >
        <div>
          <h3 style={{ marginBottom: 4 }}>Member identities and devices</h3>
          <span style={{ opacity: 0.7 }}>
            Trust is evaluated by <code>{security?.viewingAs ?? room.myUserId}</code>.
          </span>
        </div>
        <Button
          icon={<ReloadOutlined />}
          loading={loading}
          onClick={() => setRevision((value) => value + 1)}
        >
          Refresh
        </Button>
      </div>
      {loadError && (
        <Alert
          type="error"
          showIcon
          message="Could not load member devices"
          description={loadError}
          style={{ marginBottom: 14 }}
        />
      )}
      <Spin spinning={loading}>
        <div style={{ maxHeight: '58vh', overflow: 'auto', paddingRight: 4 }}>
          {security?.members.length ? (
            <Collapse
              items={security.members.map((securityMember) => ({
                key: securityMember.userId,
                label: (
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 8,
                      flexWrap: 'wrap',
                    }}
                  >
                    <MemberAvatar
                      userId={securityMember.userId}
                      name={securityMember.displayName}
                      url={securityMember.avatarUrl}
                      size={28}
                      showPresenceTooltip={false}
                    />
                    <b>{securityMember.displayName}</b>
                    {identityTag(securityMember)}
                    <Tag>{securityMember.devices.length} devices</Tag>
                  </span>
                ),
                children: <MemberSecurity member={securityMember} />,
              }))}
            />
          ) : (
            !loading && <Empty description="No joined members with device information" />
          )}
        </div>
      </Spin>
    </div>
  )
}
