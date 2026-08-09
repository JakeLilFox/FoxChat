// @vitest-environment jsdom

import {
  PushRuleActionName,
  PushRuleKind,
  TweakName,
  type IPushRule,
  type MatrixClient,
} from 'matrix-js-sdk'
import { describe, expect, it, vi } from 'vitest'
import {
  MatrixClientService,
  type RoomNotificationMode,
} from '../../src/matrix/MatrixClientService'

const ROOM_ID = '!room:example.org'

const notificationService = () => {
  const rules = new Map<string, IPushRule>()
  const addPushRule = vi.fn(
    async (_scope: string, _kind: PushRuleKind, ruleId: string, rule: IPushRule) => {
      rules.set(ruleId, { ...rule, rule_id: ruleId })
    },
  )
  const deletePushRule = vi.fn(async (_scope: string, _kind: PushRuleKind, ruleId: string) => {
    rules.delete(ruleId)
  })
  const getPushRules = vi.fn(async () => ({ global: {}, device: {} }))
  const client = {
    getRoom: () => undefined,
    getRoomPushRule: (_scope: string, roomId: string) => rules.get(roomId),
    addPushRule,
    deletePushRule,
    getPushRules,
  } as unknown as MatrixClient
  const service = new MatrixClientService()
  ;(
    service as unknown as {
      clientForRoomAccount: (roomId: string, accountId?: string) => MatrixClient
    }
  ).clientForRoomAccount = () => client
  return { service, rules, addPushRule, getPushRules }
}

describe('room notification modes', () => {
  it.each<{
    mode: RoomNotificationMode
    expectedActions: IPushRule['actions']
  }>([
    {
      mode: 'all',
      expectedActions: [
        PushRuleActionName.Notify,
        { set_tweak: TweakName.Sound, value: 'default' },
      ],
    },
    {
      mode: 'mentions',
      expectedActions: [
        PushRuleActionName.DontNotify,
        { set_tweak: TweakName.Highlight, value: false },
      ],
    },
    { mode: 'none', expectedActions: [PushRuleActionName.DontNotify] },
  ])('persists and reads the $mode mode', async ({ mode, expectedActions }) => {
    const { service, rules } = notificationService()

    await service.setRoomNotificationMode(ROOM_ID, mode)

    expect(rules.get(ROOM_ID)?.actions).toEqual(expectedActions)
    expect(service.getRoomNotificationMode(ROOM_ID)).toBe(mode)
  })

  it('writes exactly one room rule when enabling all messages', async () => {
    const { service, addPushRule, getPushRules } = notificationService()

    await service.setRoomNotificationMode(ROOM_ID, 'all')

    expect(addPushRule).toHaveBeenCalledOnce()
    expect(addPushRule).toHaveBeenCalledWith(
      'global',
      PushRuleKind.RoomSpecific,
      ROOM_ID,
      expect.objectContaining({ actions: expect.arrayContaining([PushRuleActionName.Notify]) }),
    )
    expect(getPushRules).toHaveBeenCalledOnce()
  })
})
