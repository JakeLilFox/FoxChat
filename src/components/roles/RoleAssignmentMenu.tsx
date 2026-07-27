import {
  type RoleAssignRequest,
  assignableRoles,
  effectivePowerLevel,
  roomRank,
} from '../../lib/roleHelpers'
import { containingSpacePath } from '../../lib/spaceHelpers'
import { DevJson, devJson } from '../../styles'
import { useEffect } from 'react'
import { Collapse, Dropdown, Input, App as AntApp } from 'antd'
import { CodeOutlined } from '@ant-design/icons'
import { EventType, Room, RoomType } from 'matrix-js-sdk'
import { matrixService } from '../../matrix/MatrixClientService'

export function RoleAssignmentMenu({
  request,
  onClose,
}: {
  request: RoleAssignRequest
  onClose: () => void
}) {
  const { message, modal } = AntApp.useApp()
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (!(event.target as HTMLElement).closest('.ant-dropdown')) onClose()
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('pointerdown', outside, true)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('pointerdown', outside, true)
      document.removeEventListener('keydown', escape)
    }
  }, [onClose])
  const client = matrixService.matrixClient
  const blocked = client?.isUserIgnored(request.userId) ?? false
  const toggleBlock = async () => {
    try {
      await matrixService.setUserBlocked(request.userId, !blocked)
      message.success(
        blocked
          ? `${request.name || request.userId} unblocked`
          : `${request.name || request.userId} blocked`,
      )
    } catch (error) {
      message.error(error instanceof Error ? error.message : 'Could not update blocked users')
    } finally {
      onClose()
    }
  }
  const path = containingSpacePath(request.room.roomId, client)
  const space =
    request.room.getType() === RoomType.Space ? request.room : client?.getRoom(path[0] ?? '')
  const ownId = client?.getUserId()
  const ownLevel = ownId ? effectivePowerLevel(request.room, ownId) : 0
  const targetLevel = effectivePowerLevel(request.room, request.userId)
  const power =
    request.room.currentState.getStateEvents(EventType.RoomPowerLevels, '')?.getContent() ?? {}
  const canKick =
    !!ownId &&
    ownId !== request.userId &&
    ownLevel > targetLevel &&
    ownLevel >= (typeof power.kick === 'number' ? power.kick : 50)
  const canBan =
    !!ownId &&
    ownId !== request.userId &&
    ownLevel > targetLevel &&
    ownLevel >= (typeof power.ban === 'number' ? power.ban : 50)
  const canAssignRoom =
    !!ownId &&
    ownId !== request.userId &&
    ownLevel > targetLevel &&
    request.room.currentState.maySendStateEvent(EventType.RoomPowerLevels, ownId)
  const spacePower =
    space?.currentState.getStateEvents(EventType.RoomPowerLevels, '')?.getContent() ?? {}
  const spaceOwnLevel = space && ownId ? effectivePowerLevel(space, ownId) : 0
  const spaceTargetLevel = space ? effectivePowerLevel(space, request.userId) : 0
  const isSpaceMember = ['join', 'invite'].includes(
    space?.getMember(request.userId)?.membership ?? '',
  )
  const canSpaceKick =
    !!space &&
    request.room.roomId !== space.roomId &&
    !!ownId &&
    ownId !== request.userId &&
    isSpaceMember &&
    spaceOwnLevel > spaceTargetLevel &&
    spaceOwnLevel >= (typeof spacePower.kick === 'number' ? spacePower.kick : 50)
  const canSpaceBan =
    !!space &&
    request.room.roomId !== space.roomId &&
    !!ownId &&
    ownId !== request.userId &&
    isSpaceMember &&
    spaceOwnLevel > spaceTargetLevel &&
    spaceOwnLevel >= (typeof spacePower.ban === 'number' ? spacePower.ban : 50)
  const canAssignSpace =
    !!space &&
    !!ownId &&
    ownId !== request.userId &&
    spaceOwnLevel > spaceTargetLevel &&
    space.currentState.maySendStateEvent(EventType.RoomPowerLevels, ownId)
  const channelSource = request.room.currentState.getStateEvents(
    'in.cinny.room.power_level_tags',
    '',
  )
    ? request.room
    : (space ?? request.room)
  const apply = async (target: Room, level: number, propagate: boolean) => {
    try {
      const result = await matrixService.assignRoomRole(
        target.roomId,
        request.userId,
        level,
        propagate,
      )
      message.success(
        propagate
          ? `Role assigned across ${result.synced.length} rooms`
          : `Role assigned in ${target.name}`,
      )
    } catch (error) {
      message.error(error instanceof Error ? error.message : 'Could not assign role')
    } finally {
      onClose()
    }
  }
  const roleItems = (
    target: Room,
    roles: ReturnType<typeof assignableRoles>,
    propagate: boolean,
    maxLevel: number,
  ) =>
    roles
      .filter((role) => role.level <= maxLevel)
      .map((role) => ({
        key: `${target.roomId}:${role.level}`,
        label: (
          <span style={{ color: role.color }}>
            {role.name} · {role.level}
          </span>
        ),
        onClick: () => void apply(target, role.level, propagate),
      }))
  const userDevTools = async () => {
    onClose()
    const member = request.room.getMember(request.userId)
    const memberEvent = request.room.currentState.getStateEvents(
      EventType.RoomMember,
      request.userId,
    )
    const rank = roomRank(request.room, request.userId)
    const matrixUser = client?.getUser(request.userId)
    let publicProfile: Record<string, unknown> | null = null
    let profileError: string | null = null
    try {
      publicProfile =
        ((await client?.getProfileInfo(request.userId)) as Record<string, unknown>) ?? null
    } catch (error) {
      profileError =
        error instanceof Error ? error.message : 'The public profile endpoint could not be fetched'
    }
    let publicPresence: {
      presence?: string
      status_msg?: string
      last_active_ago?: number
      currently_active?: boolean
    } | null = null
    let presenceError: string | null = null
    try {
      publicPresence = (await client?.getPresence(request.userId)) ?? null
    } catch (error) {
      presenceError =
        error instanceof Error ? error.message : 'The presence endpoint could not be fetched'
    }
    const customProfileFields = Object.fromEntries(
      Object.entries(publicProfile ?? {}).filter(
        ([key]) => key !== 'displayname' && key !== 'avatar_url',
      ),
    )
    const cachedUserModel = matrixUser ? Object.fromEntries(Object.entries(matrixUser)) : null
    const memberships = (client?.getRooms() ?? []).flatMap((target) => {
      const targetMember = target.getMember(request.userId)
      return targetMember
        ? [
            {
              room_id: target.roomId,
              room_name: target.name,
              room_type: target.getType() ?? 'm.room',
              membership: targetMember.membership,
              display_name: targetMember.name,
              avatar_url: targetMember.getMxcAvatarUrl(),
              power_level: effectivePowerLevel(target, request.userId),
              member_event: targetMember.events.member?.toJSON() ?? null,
              cached_member_model: Object.fromEntries(Object.entries(targetMember)),
            },
          ]
        : []
    })
    const data = {
      user_id: request.userId,
      custom_profile_fields: customProfileFields,
      cached_user_model: cachedUserModel,
      user_summary: {
        user_id: request.userId,
        displayname:
          publicProfile?.displayname ??
          member?.name ??
          request.name ??
          matrixUser?.displayName ??
          null,
        avatar_url:
          publicProfile?.avatar_url ??
          member?.getMxcAvatarUrl() ??
          request.avatarUrl ??
          matrixUser?.avatarUrl ??
          null,
        status_msg: publicPresence?.status_msg ?? matrixUser?.presenceStatusMsg ?? null,
        pronouns:
          typeof publicProfile?.['foxchat.pronouns'] === 'string'
            ? publicProfile['foxchat.pronouns']
            : null,
      },
      presence_endpoint: {
        endpoint: '/_matrix/client/v3/presence/' + encodeURIComponent(request.userId) + '/status',
        data: publicPresence,
        error: presenceError,
      },
      public_profile_endpoint: {
        endpoint: `/_matrix/client/v3/profile/${encodeURIComponent(request.userId)}`,
        data: publicProfile,
        error: profileError,
        note: 'This is the only account-level profile data another Matrix user can normally fetch. Nonstandard banner, bio, or pronoun fields are shown here if the homeserver exposes them.',
      },
      account_data: {
        accessible: false,
        note: 'Matrix account data is private to the account owner and cannot be fetched for another user.',
      },
      presence: matrixUser
        ? {
            presence: matrixUser.presence,
            status_message: matrixUser.presenceStatusMsg,
            last_active_ago: matrixUser.lastActiveAgo,
            currently_active: matrixUser.currentlyActive,
          }
        : null,
      display_name: member?.name || request.name || null,
      avatar_url: member?.getMxcAvatarUrl() || request.avatarUrl || null,
      homeserver: request.userId.split(':').slice(1).join(':') || null,
      room_id: request.room.roomId,
      room_name: request.room.name,
      membership: member?.membership || null,
      power_level: rank.level,
      room_power_level: effectivePowerLevel(request.room, request.userId),
      role: rank,
      state_event: memberEvent?.toJSON() ?? null,
      known_room_memberships: memberships,
    }
    modal.info({
      title: `User developer tools · ${member?.name || request.name || request.userId}`,
      width: 900,
      content: (
        <Collapse
          defaultActiveKey={['user-summary']}
          items={[
            {
              key: 'user-summary',
              label: 'Combined user summary',
              children: <DevJson>{JSON.stringify(data.user_summary, null, 2)}</DevJson>,
            },
            {
              key: 'public-profile',
              label: 'Public profile endpoint',
              children: <DevJson>{JSON.stringify(data.public_profile_endpoint, null, 2)}</DevJson>,
            },
            {
              key: 'custom-profile',
              label: `Custom profile namespaces (${Object.keys(customProfileFields).length})`,
              children: <DevJson>{devJson(data.custom_profile_fields)}</DevJson>,
            },
            {
              key: 'cached-user',
              label: 'Complete cached SDK user model',
              children: <DevJson>{devJson(data.cached_user_model)}</DevJson>,
            },
            {
              key: 'account-data',
              label: 'Account data availability',
              children: <DevJson>{JSON.stringify(data.account_data, null, 2)}</DevJson>,
            },
            {
              key: 'presence-endpoint',
              label: 'Presence endpoint',
              children: <DevJson>{JSON.stringify(data.presence_endpoint, null, 2)}</DevJson>,
            },
            {
              key: 'presence',
              label: 'Cached presence model',
              children: <DevJson>{JSON.stringify(data.presence, null, 2)}</DevJson>,
            },
            {
              key: 'room-profile',
              label: 'Current room profile and role',
              children: (
                <DevJson>
                  {JSON.stringify(
                    {
                      user_id: data.user_id,
                      display_name: data.display_name,
                      avatar_url: data.avatar_url,
                      homeserver: data.homeserver,
                      room_id: data.room_id,
                      room_name: data.room_name,
                      membership: data.membership,
                      power_level: data.power_level,
                      room_power_level: data.room_power_level,
                      role: data.role,
                    },
                    null,
                    2,
                  )}
                </DevJson>
              ),
            },
            {
              key: 'member-state',
              label: 'Room member state event',
              children: <DevJson>{JSON.stringify(data.state_event, null, 2)}</DevJson>,
            },
            {
              key: 'known-rooms',
              label: `Known room memberships (${memberships.length})`,
              children: <DevJson>{devJson(data.known_room_memberships)}</DevJson>,
            },
          ]}
        />
      ),
      okText: 'Close',
    })
  }
  const moderate = (action: 'kick' | 'ban', target = request.room) => {
    let reason = ''
    modal.confirm({
      title: `${action === 'ban' ? 'Ban' : 'Kick'} ${request.name || request.userId}?`,
      content: (
        <Input
          placeholder="Reason (optional)"
          onChange={(event) => {
            reason = event.target.value
          }}
        />
      ),
      okText: action === 'ban' ? 'Ban member' : 'Kick member',
      okButtonProps: { danger: true },
      onOk: async () => {
        if (action === 'ban')
          await matrixService.banRoomMember(target.roomId, request.userId, reason)
        else await matrixService.kickRoomMember(target.roomId, request.userId, reason)
        message.success(
          `${request.name || request.userId} was ${action === 'ban' ? 'banned' : 'kicked'}`,
        )
        onClose()
      },
    })
  }
  const items = [
    ...(space && canAssignSpace
      ? [
          {
            key: 'space',
            label: `Space · ${space.name}`,
            children: roleItems(space, assignableRoles(space), true, spaceOwnLevel),
          },
        ]
      : []),
    ...(request.room.roomId !== space?.roomId && canAssignRoom
      ? [
          {
            key: 'channel',
            label: `This channel · ${request.room.name}`,
            children: roleItems(request.room, assignableRoles(channelSource), false, ownLevel),
          },
        ]
      : []),
    { type: 'divider' as const },
    {
      key: 'user-devtools',
      label: 'Developer tools',
      icon: <CodeOutlined />,
      onClick: userDevTools,
    },
    ...(request.userId !== ownId
      ? [
          {
            key: 'block-user',
            label: blocked ? 'Unblock user' : 'Block user',
            danger: !blocked,
            onClick: () => void toggleBlock(),
          },
        ]
      : []),
    ...(canSpaceKick || canSpaceBan ? [{ type: 'divider' as const }] : []),
    ...(canSpaceKick
      ? [
          {
            key: 'kick-space-member',
            label: 'Kick from Space',
            danger: true,
            onClick: () => moderate('kick', space!),
          },
        ]
      : []),
    ...(canSpaceBan
      ? [
          {
            key: 'ban-space-member',
            label: 'Ban from Space',
            danger: true,
            onClick: () => moderate('ban', space!),
          },
        ]
      : []),
    ...(canKick || canBan ? [{ type: 'divider' as const }] : []),
    ...(canKick
      ? [
          {
            key: 'kick-member',
            label: 'Kick from room',
            danger: true,
            onClick: () => moderate('kick'),
          },
        ]
      : []),
    ...(canBan
      ? [
          {
            key: 'ban-member',
            label: 'Ban from room',
            danger: true,
            onClick: () => moderate('ban'),
          },
        ]
      : []),
  ]
  return (
    <Dropdown
      open
      trigger={[]}
      menu={{ items }}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <span
        style={{
          position: 'fixed',
          left: request.x,
          top: request.y,
          width: 1,
          height: 1,
          zIndex: 9999,
        }}
      />
    </Dropdown>
  )
}
