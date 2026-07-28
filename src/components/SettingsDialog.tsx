import {
  AccountDeactivation,
  AnonymizeFilenameSetting,
  AutoSyncSpaceRolesSetting,
  AutoReadAllAccountsSetting,
  BlockedUsersSettings,
  ChatBackgroundSettings,
  ChatFontSizeSetting,
  InfoSettings,
  OwnMessageAlignmentSetting,
  PushReceiverSettings,
  StickerSettings,
  TimelineAppearanceSettings,
  AutomationApiSettings,
} from './settings'
import { ImageCropModal } from './media'
import { MicrophoneSetting } from './calls/MicrophoneSetting'
import { SocialLinksEditor } from './profile'
import { invalidatePronouns } from '../lib/userPronouns'
import { TIMEZONE_OPTIONS, type ThemeMode } from '../lib/constants'
import { useMediaQuery, useMediaUrl } from '../lib/hooks'
import { type SocialLink, socialLinksFrom } from '../lib/social'
import { isAndroidApp } from '../platform/nativeBackground'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Avatar,
  Button,
  Descriptions,
  Divider,
  Form,
  Input,
  Modal,
  Popconfirm,
  Select,
  Spin,
  Switch,
  Tabs,
  Tag,
  App as AntApp,
  List as AntList,
} from 'antd'
import {
  CheckOutlined,
  CopyOutlined,
  LockOutlined,
  LogoutOutlined,
  UploadOutlined,
} from '@ant-design/icons'
import { MatrixError } from 'matrix-js-sdk'
import {
  matrixService,
  type MatrixDeviceSession,
  type MatrixSecurityStatus,
} from '../matrix/MatrixClientService'
import { deviceDeletionAccountManagementUrl } from '../lib/accountManagement'
import { openExternalUrl } from '../platform/externalLinks'

export function SettingsDialog({
  open,
  onClose,
  mode,
  onMode,
  onRecover,
  onVerify,
  onSetup,
}: {
  open: boolean
  onClose: () => void
  mode: ThemeMode
  onMode: () => void
  onRecover: () => void
  onVerify: (deviceId?: string) => void
  onSetup?: () => void
}) {
  const { message } = AntApp.useApp()
  const [devices, setDevices] = useState<MatrixDeviceSession[]>([])
  const [security, setSecurity] = useState<MatrixSecurityStatus>()
  const [loading, setLoading] = useState(false)
  const [displayName, setDisplayName] = useState('')
  const [savedDisplayName, setSavedDisplayName] = useState('')
  const [profileBio, setProfileBio] = useState('')
  const [profilePronouns, setProfilePronouns] = useState('')
  const [profileStatus, setProfileStatus] = useState('')
  const [profileTimezone, setProfileTimezone] = useState(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
  )
  const [profileSocialLinks, setProfileSocialLinks] = useState<SocialLink[]>([])
  const [profileAvatar, setProfileAvatar] = useState<string>()
  const [profileBanner, setProfileBanner] = useState<string>()
  const [savingProfile, setSavingProfile] = useState(false)
  const [cropRequest, setCropRequest] = useState<{
    file: File
    shape: 'circle' | 'banner'
  }>()
  const avatarInput = useRef<HTMLInputElement>(null)
  const bannerInput = useRef<HTMLInputElement>(null)
  const [renaming, setRenaming] = useState<MatrixDeviceSession>()
  const [newDeviceName, setNewDeviceName] = useState('')
  const [deleting, setDeleting] = useState<MatrixDeviceSession>()
  const [deletePassword, setDeletePassword] = useState('')
  const [deleteSession, setDeleteSession] = useState<string>()
  const [deviceDeletionManagementUri, setDeviceDeletionManagementUri] = useState<string>()
  const [backupSetupOpen, setBackupSetupOpen] = useState(false)
  const [backupPassphrase, setBackupPassphrase] = useState('')
  const [backupPassphraseConfirm, setBackupPassphraseConfirm] = useState('')
  const [backupRecoveryKey, setBackupRecoveryKey] = useState('')
  const [settingUpBackup, setSettingUpBackup] = useState(false)
  const android = isAndroidApp()
  const narrow = useMediaQuery('(max-width: 699px)')
  const short = useMediaQuery('(max-height: 699px)')
  const compact = narrow || (android && short)
  const client = matrixService.matrixClient
  const profileAvatarUrl = useMediaUrl({ url: profileAvatar })
  const profileBannerUrl = useMediaUrl({ url: profileBanner })
  const backupSetupNeedsUnlock = !!security?.hasSecretStorageKey && !security.secretStorageKeyCached
  const closeBackupSetup = () => {
    if (settingUpBackup || backupRecoveryKey) return
    setBackupSetupOpen(false)
    setBackupPassphrase('')
    setBackupPassphraseConfirm('')
  }
  const finishBackupSetup = () => {
    setBackupSetupOpen(false)
    setBackupPassphrase('')
    setBackupPassphraseConfirm('')
    setBackupRecoveryKey('')
  }
  const setupBackup = async () => {
    if (backupPassphrase !== backupPassphraseConfirm) {
      message.error('The passphrases do not match')
      return
    }
    setSettingUpBackup(true)
    try {
      const result = await matrixService.setupKeyBackup(backupPassphrase || undefined)
      setBackupRecoveryKey(result.recoveryKey)
      message.success('Encrypted key backup is ready')
      await load()
    } catch (e) {
      message.error(e instanceof Error ? e.message : 'Could not set up encrypted key backup')
    } finally {
      setSettingUpBackup(false)
    }
  }
  const copyRecoveryKey = async () => {
    try {
      await navigator.clipboard.writeText(backupRecoveryKey)
      message.success('Recovery key copied')
    } catch {
      message.error('Could not copy the recovery key')
    }
  }
  const load = useCallback(async () => {
    setLoading(true)
    try {
      const userId = client?.getSafeUserId()
      const [nextDevices, nextSecurity, profile, presence, nextDeviceDeletionManagementUri] =
        await Promise.all([
          matrixService.getDeviceSessions(),
          matrixService.getSecurityStatus(),
          userId ? client?.getProfileInfo(userId) : matrixService.getProfile(),
          userId && client ? client.getPresence(userId).catch(() => undefined) : undefined,
          matrixService.deviceDeletionAccountManagementUri(),
        ])
      const raw = profile as Record<string, unknown>
      const bio = raw?.['chat.commet.profile_bio']
      const nextDisplayName = String(raw?.displayname ?? '')
      setDevices(
        nextDevices.sort(
          (a, b) =>
            Number(b.current) - Number(a.current) + (b.lastSeenTs ?? 0) - (a.lastSeenTs ?? 0),
        ),
      )
      setSecurity(nextSecurity)
      setDeviceDeletionManagementUri(nextDeviceDeletionManagementUri)
      setDisplayName(nextDisplayName)
      setSavedDisplayName(nextDisplayName)
      setProfileAvatar(
        typeof raw?.avatar_url === 'string' && raw.avatar_url ? raw.avatar_url : undefined,
      )
      setProfileBanner(
        typeof raw?.['chat.commet.profile_banner'] === 'string'
          ? raw['chat.commet.profile_banner']
          : undefined,
      )
      setProfileBio(
        typeof bio === 'string'
          ? bio
          : typeof bio === 'object' && bio && 'body' in bio
            ? String((bio as { body?: unknown }).body ?? '')
            : '',
      )
      setProfilePronouns(
        typeof raw?.['foxchat.pronouns'] === 'string' ? raw['foxchat.pronouns'] : '',
      )
      setProfileTimezone(
        typeof raw?.['m.tz'] === 'string' && raw['m.tz']
          ? raw['m.tz']
          : Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
      )
      setProfileSocialLinks(socialLinksFrom(raw?.['foxchat.social_links']))
      setProfileStatus(
        String(presence?.status_msg ?? client?.getUser(userId ?? '')?.presenceStatusMsg ?? ''),
      )
    } catch (e) {
      message.error(e instanceof Error ? e.message : 'Could not load settings')
    } finally {
      setLoading(false)
    }
  }, [message, client])
  useEffect(() => {
    if (open) void load()
  }, [open, load])
  const setPublicProfileField = (field: string, value: unknown) => {
    if (!client) throw new Error('Matrix client is not connected')
    return (
      client.setProfileInfo as unknown as (
        field: string,
        data: Record<string, unknown>,
      ) => Promise<unknown>
    )(field, { [field]: value })
  }
  const uploadProfileBanner = async (file?: File) => {
    if (!file || !client) return
    setSavingProfile(true)
    try {
      const upload = await client.uploadContent(file, {
        name: file.name,
        type: file.type,
      })
      setProfileBanner(upload.content_uri)
      message.success('Banner uploaded, save your profile to publish it')
    } catch (e) {
      message.error(e instanceof Error ? e.message : 'Could not upload banner')
    } finally {
      setSavingProfile(false)
      if (bannerInput.current) bannerInput.current.value = ''
    }
  }
  const selectCrop = (file: File | undefined, shape: 'circle' | 'banner') => {
    if (!file) return
    if (!file.type.startsWith('image/')) {
      message.error('Choose an image file')
      return
    }
    setCropRequest({ file, shape })
  }
  const uploadProfileAvatar = async (file?: File) => {
    if (!file || !client) return
    if (!file.type.startsWith('image/')) {
      message.error('Choose an image file')
      return
    }
    setSavingProfile(true)
    try {
      const upload = await client.uploadContent(file, {
        name: file.name,
        type: file.type,
      })
      await client.setAvatarUrl(upload.content_uri)
      setProfileAvatar(upload.content_uri)
      message.success('Profile picture updated')
    } catch (e) {
      message.error(e instanceof Error ? e.message : 'Could not update profile picture')
    } finally {
      setSavingProfile(false)
      if (avatarInput.current) avatarInput.current.value = ''
    }
  }
  const removeProfileAvatar = async () => {
    if (!client) return
    setSavingProfile(true)
    try {
      await client.setAvatarUrl('')
      setProfileAvatar(undefined)
      message.success('Profile picture removed')
    } catch (e) {
      message.error(e instanceof Error ? e.message : 'Could not remove profile picture')
    } finally {
      setSavingProfile(false)
    }
  }
  const saveProfile = async () => {
    const savedPronouns = profilePronouns.trim()
    const savedSocialLinks = profileSocialLinks
      .filter((item) => item.title.trim() || item.link.trim() || item.img)
      .map((item) => ({
        ...item,
        title: item.title.trim(),
        link: item.link.trim(),
        img: item.img?.trim() || undefined,
      }))
    if (
      savedSocialLinks.some((item) => {
        try {
          const url = new URL(item.link)
          return !item.title || !['http:', 'https:'].includes(url.protocol)
        } catch {
          return true
        }
      })
    ) {
      message.error('Every social link needs a title and a valid HTTP or HTTPS URL')
      return
    }
    setSavingProfile(true)
    try {
      if (displayName !== savedDisplayName) {
        await matrixService.setDisplayName(displayName)
        setSavedDisplayName(displayName)
      }
      await setPublicProfileField('foxchat.pronouns', savedPronouns)
      invalidatePronouns(client?.getSafeUserId() ?? '')
      await setPublicProfileField('m.tz', profileTimezone)
      await setPublicProfileField('foxchat.social_links', savedSocialLinks)
      await setPublicProfileField('chat.commet.profile_bio', {
        body: profileBio,
      })
      await setPublicProfileField('chat.commet.profile_banner', profileBanner ?? '')
      if (client) {
        const current = client.getUser(client.getSafeUserId())?.presence
        const presence = current === 'offline' || current === 'unavailable' ? current : 'online'
        await client.setPresence({
          presence,
          status_msg: profileStatus.trim(),
        })
      }
      setProfilePronouns(savedPronouns)
      message.success('Profile updated')
    } catch (e) {
      message.error(e instanceof Error ? e.message : 'Could not update profile')
    } finally {
      setSavingProfile(false)
    }
  }
  const copyAccessToken = async () => {
    const token = client?.getAccessToken()
    if (!token) {
      message.error('No access token available')
      return
    }
    await navigator.clipboard.writeText(token)
    message.success('Access token copied to clipboard')
  }
  const saveDeviceName = async () => {
    if (!renaming || !newDeviceName.trim()) return
    try {
      await matrixService.renameDevice(renaming.deviceId, newDeviceName.trim())
      setRenaming(undefined)
      await load()
      message.success('Device renamed')
    } catch (e) {
      message.error(e instanceof Error ? e.message : 'Could not rename device')
    }
  }
  const beginRemoveDevice = async (device: MatrixDeviceSession) => {
    if (deviceDeletionManagementUri) {
      try {
        await openExternalUrl(
          deviceDeletionAccountManagementUrl(deviceDeletionManagementUri, device.deviceId),
        )
        message.info('Finish signing out this device in your account manager')
      } catch (error) {
        message.error(error instanceof Error ? error.message : 'Could not open account manager')
      }
      return
    }
    try {
      await matrixService.deleteDevice(device.deviceId)
      await load()
      message.success('Device signed out')
    } catch (e) {
      if (e instanceof MatrixError && e.data?.session) {
        setDeleting(device)
        setDeleteSession(e.data.session as string)
      } else message.error(e instanceof Error ? e.message : 'Could not delete device')
    }
  }
  const removeDevice = async () => {
    if (!deleting) return
    try {
      await matrixService.deleteDevice(
        deleting.deviceId,
        deletePassword || undefined,
        deleteSession,
      )
      setDeleting(undefined)
      setDeletePassword('')
      setDeleteSession(undefined)
      await load()
      message.success('Device signed out')
    } catch (e) {
      if (e instanceof MatrixError && e.data?.session) {
        setDeleteSession(e.data.session as string)
        message.info('Enter your account password to authorize this action')
      } else message.error(e instanceof Error ? e.message : 'Could not delete device')
    }
  }
  const deviceItems = (
    <Spin spinning={loading}>
      <AntList
        dataSource={devices}
        locale={{ emptyText: 'No devices returned by the homeserver' }}
        renderItem={(device) => (
          <AntList.Item
            actions={[
              <Button
                key="rename"
                size="small"
                onClick={() => {
                  setRenaming(device)
                  setNewDeviceName(device.displayName)
                }}
              >
                Rename
              </Button>,
              device.current ? (
                <Tag key="current" color="blue">
                  This device
                </Tag>
              ) : (
                <Button
                  key="verify"
                  size="small"
                  disabled={device.verified}
                  onClick={() => onVerify(device.deviceId)}
                >
                  {device.verified ? 'Verified' : 'Verify'}
                </Button>
              ),
              !device.current && (
                <Popconfirm
                  key="delete"
                  title="Sign out this device?"
                  description="Its access token will be invalidated."
                  onConfirm={() => void beginRemoveDevice(device)}
                >
                  <Button size="small" danger>
                    Sign out
                  </Button>
                </Popconfirm>
              ),
            ]}
          >
            <AntList.Item.Meta
              avatar={
                <Avatar style={{ background: device.current ? '#7357e8' : '#697386' }}>
                  {device.displayName[0]?.toUpperCase()}
                </Avatar>
              }
              title={
                <>
                  {device.displayName}{' '}
                  {device.verified ? (
                    <Tag color="success">Verified</Tag>
                  ) : device.crossSigned ? (
                    <Tag color="processing">Cross-signed</Tag>
                  ) : (
                    <Tag>Unverified</Tag>
                  )}
                </>
              }
              description={
                <div>
                  <code>{device.deviceId}</code>
                  <br />
                  {device.userAgent || 'Unknown client'}
                  {device.lastSeenTs && <> · {new Date(device.lastSeenTs).toLocaleString()}</>}
                  {device.lastSeenIp && <> · {device.lastSeenIp}</>}
                </div>
              }
            />
          </AntList.Item>
        )}
      />
    </Spin>
  )
  const items = [
    {
      key: 'appearance',
      label: 'Appearance',
      children: (
        <div>
          <h2>Appearance</h2>
          <AntList>
            <AntList.Item extra={<Switch checked={mode === 'dark'} onChange={onMode} />}>
              <AntList.Item.Meta
                title="Dark mode"
                description="Use the dark color scheme throughout FoxChat."
              />
            </AntList.Item>
            <ChatFontSizeSetting />
            <OwnMessageAlignmentSetting />
            <AnonymizeFilenameSetting />
            <AutoSyncSpaceRolesSetting />
          </AntList>
          <ChatBackgroundSettings />
        </div>
      ),
    },
    {
      key: 'messages',
      label: 'Messages',
      children: (
        <div>
          <h2>Message behavior</h2>
          <AntList>
            <AutoReadAllAccountsSetting />
            <TimelineAppearanceSettings />
          </AntList>
        </div>
      ),
    },
    {
      key: 'account',
      label: 'Account',
      children: (
        <div>
          <h2>Account</h2>
          <Descriptions
            column={1}
            bordered
            size="small"
            items={[
              {
                key: 'mxid',
                label: 'Matrix ID',
                children: client?.getUserId(),
              },
              {
                key: 'server',
                label: 'Homeserver',
                children: client?.getHomeserverUrl(),
              },
              {
                key: 'device',
                label: 'Current device',
                children: client?.getDeviceId(),
              },
              {
                key: 'token',
                label: 'Access token',
                children: (
                  <Button
                    size="small"
                    icon={<CopyOutlined />}
                    onClick={() => void copyAccessToken()}
                  >
                    Copy token
                  </Button>
                ),
              },
            ]}
          />
          <Divider />
          <Form layout="vertical">
            <Form.Item label="Profile picture">
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 14,
                  flexWrap: 'wrap',
                }}
              >
                <Avatar size={72} src={profileAvatarUrl}>
                  {!profileAvatarUrl &&
                    (displayName || client?.getUserId() || '?').trim().charAt(0).toUpperCase()}
                </Avatar>
                <input
                  ref={avatarInput}
                  hidden
                  style={{ display: 'none' }}
                  type="file"
                  accept="image/*"
                  onChange={(event) => selectCrop(event.target.files?.[0], 'circle')}
                />
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <Button
                    icon={<UploadOutlined />}
                    loading={savingProfile}
                    onClick={() => avatarInput.current?.click()}
                  >
                    {profileAvatar ? 'Replace picture' : 'Upload picture'}
                  </Button>
                  {profileAvatar && (
                    <Button
                      danger
                      loading={savingProfile}
                      onClick={() => void removeProfileAvatar()}
                    >
                      Remove
                    </Button>
                  )}
                </div>
              </div>
            </Form.Item>
            <Form.Item label="Display name">
              <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
            </Form.Item>
            <Form.Item label="Pronouns">
              <Input
                value={profilePronouns}
                maxLength={100}
                allowClear
                onChange={(e) => setProfilePronouns(e.target.value)}
                placeholder="for example: she/her, he/him, they/them"
              />
            </Form.Item>
            <Form.Item label="Timezone">
              <Select
                showSearch
                optionFilterProp="label"
                value={profileTimezone}
                options={TIMEZONE_OPTIONS}
                onChange={setProfileTimezone}
                placeholder="Select your timezone"
              />
            </Form.Item>
            <Form.Item label="Status">
              <Input
                value={profileStatus}
                maxLength={255}
                allowClear
                onChange={(e) => setProfileStatus(e.target.value)}
                placeholder="What are you up to?"
              />
            </Form.Item>
            <Form.Item label="Profile bio">
              <Input.TextArea
                value={profileBio}
                maxLength={1000}
                autoSize={{ minRows: 3, maxRows: 7 }}
                onChange={(e) => setProfileBio(e.target.value)}
                placeholder="Tell people a little about yourself"
              />
            </Form.Item>
            <Form.Item label="Profile banner">
              {profileBannerUrl && (
                <div
                  style={{
                    height: 150,
                    borderRadius: 12,
                    overflow: 'hidden',
                    marginBottom: 10,
                  }}
                >
                  <img
                    src={profileBannerUrl}
                    alt=""
                    style={{
                      width: '100%',
                      height: '100%',
                      objectFit: 'cover',
                    }}
                  />
                </div>
              )}
              <input
                ref={bannerInput}
                hidden
                style={{ display: 'none' }}
                type="file"
                accept="image/*"
                onChange={(event) => selectCrop(event.target.files?.[0], 'banner')}
              />
              <div style={{ display: 'flex', gap: 8 }}>
                <Button
                  icon={<UploadOutlined />}
                  loading={savingProfile}
                  onClick={() => bannerInput.current?.click()}
                >
                  {profileBanner ? 'Replace banner' : 'Upload banner'}
                </Button>
                {profileBanner && (
                  <Button danger onClick={() => setProfileBanner(undefined)}>
                    Remove
                  </Button>
                )}
              </div>
            </Form.Item>
            <SocialLinksEditor
              value={profileSocialLinks}
              onChange={setProfileSocialLinks}
              client={client}
            />
            <Button
              type="primary"
              loading={savingProfile}
              onClick={() => void saveProfile()}
              style={{ marginTop: 16 }}
            >
              Save profile
            </Button>
          </Form>
          <Divider />
          <Button
            danger
            icon={<LogoutOutlined />}
            onClick={() =>
              void matrixService
                .logout()
                .catch((error) =>
                  console.warn('[account] Could not revoke the Matrix session remotely', error),
                )
                .finally(() => location.reload())
            }
          >
            Sign out of FoxChat
          </Button>
          <Divider />
          <h3>Danger zone</h3>
          <p>
            Deactivation permanently disables the Matrix account on your homeserver. This is
            different from signing out of FoxChat.
          </p>
          <AccountDeactivation />
          <ImageCropModal
            open={!!cropRequest}
            file={cropRequest?.file}
            shape={cropRequest?.shape ?? 'circle'}
            busy={savingProfile}
            onCancel={() => {
              setCropRequest(undefined)
              if (avatarInput.current) avatarInput.current.value = ''
              if (bannerInput.current) bannerInput.current.value = ''
            }}
            onConfirm={async (cropped) => {
              if (cropRequest?.shape === 'circle') await uploadProfileAvatar(cropped)
              else await uploadProfileBanner(cropped)
              setCropRequest(undefined)
            }}
          />
        </div>
      ),
    },
    {
      key: 'devices',
      label: `Devices (${devices.length})`,
      children: (
        <div>
          <h2>Devices and sessions</h2>
          <p>
            Review every device currently signed in to this Matrix account. Verification confirms
            that its encryption keys belong to you.
          </p>
          {deviceItems}
        </div>
      ),
    },
    {
      key: 'voice',
      label: 'Voice',
      children: (
        <div>
          <h2>Voice</h2>
          <AntList>
            <MicrophoneSetting />
          </AntList>
        </div>
      ),
    },
    {
      key: 'push',
      label: 'Push notifications',
      children: (
        <div>
          <h2>Push notifications</h2>
          <PushReceiverSettings />
        </div>
      ),
    },
    {
      key: 'security',
      label: 'Security',
      children: (
        <div>
          <h2>Encryption and recovery</h2>
          <Descriptions
            column={1}
            bordered
            size="small"
            items={[
              {
                key: 'cross',
                label: 'Cross-signing',
                children: security?.crossSigningReady ? (
                  <Tag color="success">Ready</Tag>
                ) : (
                  <Tag color="warning">Not ready</Tag>
                ),
              },
              {
                key: 'public',
                label: 'Public signing keys',
                children: security?.publicCrossSigningKeys ? 'Available' : 'Unavailable',
              },
              {
                key: 'secret',
                label: 'Private keys in secret storage',
                children: security?.privateKeysInSecretStorage ? 'Available' : 'Unavailable',
              },
              {
                key: 'local',
                label: 'Private keys on this device',
                children: security?.privateKeysCachedLocally ? 'Available' : 'Incomplete',
              },
              {
                key: 'backup',
                label: 'Key backup',
                children: security?.keyBackupVersion
                  ? `${security.keyBackupActive ? 'Active' : 'Configured'} · version ${security.keyBackupVersion}`
                  : 'Not configured',
              },
              {
                key: 'backupKey',
                label: 'Backup key on this device',
                children: security?.hasBackupKey ? 'Available' : 'Missing',
              },
            ]}
          />
          <Divider />
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Button type="primary" icon={<CheckOutlined />} onClick={() => onVerify()}>
              Verify with another device
            </Button>
            <Button icon={<LockOutlined />} onClick={onRecover}>
              Restore encrypted history
            </Button>
            <Button onClick={() => void load()}>Refresh security status</Button>
            {!security?.keyBackupVersion && (
              <Button
                type="primary"
                icon={<LockOutlined />}
                onClick={() => {
                  if (onSetup) onSetup()
                  else setBackupSetupOpen(true)
                }}
              >
                Set up encrypted backup
              </Button>
            )}
          </div>
        </div>
      ),
    },
    {
      key: 'stickers',
      label: 'Stickers & emoji',
      children: <StickerSettings />,
    },
    {
      key: 'blocked',
      label: 'Blocked users',
      children: <BlockedUsersSettings />,
    },
    {
      key: 'automation',
      label: 'Automation API',
      children: <AutomationApiSettings />,
    },
    { key: 'info', label: 'Info', children: <InfoSettings /> },
  ]
  return (
    <>
      <Modal
        title="Settings"
        open={open}
        onCancel={onClose}
        footer={null}
        width={compact ? 'calc(100vw - 12px)' : 900}
        centered={!compact}
        style={
          compact
            ? {
                top: android ? 'var(--foxchat-top-inset)' : 6,
                paddingBottom: 0,
              }
            : undefined
        }
        styles={{
          container: compact
            ? {
                padding: '12px 10px',
                maxHeight:
                  'calc(var(--foxchat-viewport-height, 100dvh) - var(--foxchat-top-inset, 0px) - 12px)',
                overflow: 'hidden',
              }
            : undefined,
          header: compact ? { marginBottom: 8, paddingInline: 4 } : undefined,
          body: {
            minHeight: compact ? 0 : 520,
            height: compact
              ? 'calc(var(--foxchat-viewport-height, 100dvh) - var(--foxchat-top-inset, 0px) - 68px)'
              : undefined,
            maxHeight: compact ? undefined : '75dvh',
            overflow: 'auto',
            overscrollBehavior: 'contain',
            paddingRight: 30,
          },
        }}
      >
        <Tabs
          tabPosition={compact ? 'top' : 'left'}
          size={compact ? 'small' : 'middle'}
          tabBarGutter={compact ? 12 : undefined}
          animated={false}
          items={items}
        />
      </Modal>
      <Modal
        title="Rename device"
        open={!!renaming}
        onOk={() => void saveDeviceName()}
        onCancel={() => setRenaming(undefined)}
      >
        <Input
          value={newDeviceName}
          onChange={(e) => setNewDeviceName(e.target.value)}
          onPressEnter={() => void saveDeviceName()}
          autoFocus
        />
      </Modal>
      <Modal
        title={backupRecoveryKey ? 'Save your recovery key' : 'Set up encrypted backup'}
        open={backupSetupOpen}
        width={560}
        maskClosable={false}
        closable={!settingUpBackup && !backupRecoveryKey}
        confirmLoading={settingUpBackup}
        okText={backupRecoveryKey ? "I've saved it" : 'Set up backup'}
        okButtonProps={{
          disabled: !backupRecoveryKey && backupSetupNeedsUnlock,
        }}
        cancelButtonProps={{
          style: backupRecoveryKey ? { display: 'none' } : undefined,
        }}
        onOk={backupRecoveryKey ? finishBackupSetup : () => void setupBackup()}
        onCancel={closeBackupSetup}
      >
        {backupRecoveryKey ? (
          <>
            <p>
              Keep this recovery key somewhere safe and separate from this device. You will need it
              to restore encrypted messages if you lose access to your devices.
            </p>
            <Input.TextArea
              value={backupRecoveryKey}
              readOnly
              autoSize={{ minRows: 2 }}
              style={{ fontFamily: 'monospace' }}
            />
            <Button
              icon={<CopyOutlined />}
              onClick={() => void copyRecoveryKey()}
              style={{ marginTop: 12 }}
            >
              Copy recovery key
            </Button>
          </>
        ) : backupSetupNeedsUnlock ? (
          <p>
            Secure storage is locked on this device. Close this dialog and use Restore encrypted
            history with your existing recovery key or passphrase, then set up the backup.
          </p>
        ) : security?.hasSecretStorageKey ? (
          <p>
            This account already has secure storage. The new backup will use its existing recovery
            key or passphrase.
          </p>
        ) : (
          <Form layout="vertical">
            <p>
              Your encrypted message keys will be backed up to your homeserver. A passphrase is
              optional; the recovery key shown after setup always works.
            </p>
            <Form.Item label="Passphrase (optional)">
              <Input.Password
                value={backupPassphrase}
                onChange={(event) => setBackupPassphrase(event.target.value)}
                placeholder="Leave blank to use only a recovery key"
                autoFocus
              />
            </Form.Item>
            <Form.Item
              label="Confirm passphrase"
              validateStatus={
                backupPassphraseConfirm && backupPassphrase !== backupPassphraseConfirm
                  ? 'error'
                  : undefined
              }
              help={
                backupPassphraseConfirm && backupPassphrase !== backupPassphraseConfirm
                  ? 'The passphrases do not match'
                  : undefined
              }
            >
              <Input.Password
                value={backupPassphraseConfirm}
                disabled={!backupPassphrase}
                onChange={(event) => setBackupPassphraseConfirm(event.target.value)}
                onPressEnter={() => void setupBackup()}
                placeholder="Enter the passphrase again"
              />
            </Form.Item>
          </Form>
        )}
      </Modal>
      <Modal
        title={`Sign out ${deleting?.displayName ?? 'device'}`}
        open={!!deleting && !!deleteSession}
        okText="Authorize and sign out"
        okButtonProps={{ danger: true }}
        onOk={() => void removeDevice()}
        onCancel={() => {
          setDeleting(undefined)
          setDeletePassword('')
          setDeleteSession(undefined)
        }}
      >
        <p>
          Your homeserver requires interactive authentication. Enter your Matrix account password.
        </p>
        <Input.Password
          value={deletePassword}
          onChange={(e) => setDeletePassword(e.target.value)}
          onPressEnter={() => void removeDevice()}
          autoFocus
        />
      </Modal>
    </>
  )
}
