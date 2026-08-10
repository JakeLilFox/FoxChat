import { ImagePackEditor } from '../../ImagePackEditor'
import { MatrixEmoteImage } from '../../message'
import { RoomAvatar } from '../../rooms'
import {
  type MatrixEmote,
  type MatrixEmotePack,
  type RoomImagePackLocation,
  orderedImageEntries,
  preferNonEmptyPack,
  roomImagePackTypes,
  setAllAccountImagePacksEnabled,
  useAllAccountImagePacks,
} from '../../../lib/emojiData'
import { useEffect, useState } from 'react'
import { MatrixClient } from 'matrix-js-sdk'
import {
  Avatar,
  Button,
  Checkbox,
  Collapse,
  Divider,
  Select,
  Switch,
  App as AntApp,
  List as AntList,
} from 'antd'
import { DeleteOutlined, SmileOutlined } from '@ant-design/icons'
import { matrixService } from '../../../matrix/MatrixClientService'

const packPreviewEmote = (
  location: RoomImagePackLocation,
  client: MatrixClient | undefined,
): MatrixEmote | undefined => {
  const [name, image] = orderedImageEntries(location.pack)[0] ?? []
  if (!name || !image?.url) return undefined
  return {
    name,
    body: image.body || name,
    url: image.url,
    info: image.info,
    usage: image.usage,
    client,
  }
}

export function StickerSettings() {
  const { message } = AntApp.useApp()
  const client = matrixService.matrixClient
  const [, refresh] = useState(0)
  const allAccountPacks = useAllAccountImagePacks()
  const multiAccount = matrixService.savedAccounts().length > 1
  const combinedAccounts = matrixService.combinedAccountsEnabled()
  const [favorite, setFavorite] = useState<string>()
  const [adding, setAdding] = useState(false)
  const personal = preferNonEmptyPack([
    client?.getAccountData('m.image_pack' as never)?.getContent<MatrixEmotePack>(),
    client?.getAccountData('im.ponies.user_emotes' as never)?.getContent<MatrixEmotePack>(),
  ])
  const favoriteRooms = Object.keys(matrixService.favoriteImagePackRooms(client))
  const availablePacks = (client?.getRooms() ?? [])
    .flatMap((room) => {
      const count = roomImagePackTypes
        .flatMap((type) => room.currentState.getStateEvents(type))
        .reduce(
          (total, event) =>
            total + Object.keys(event.getContent<MatrixEmotePack>().images ?? {}).length,
          0,
        )
      return count && !favoriteRooms.includes(room.roomId)
        ? [
            {
              value: room.roomId,
              label: `${room.name} · ${count} image${count === 1 ? '' : 's'}`,
            },
          ]
        : []
    })
    .sort((a, b) => a.label.localeCompare(b.label))
  const add = async () => {
    if (!favorite) return
    setAdding(true)
    try {
      await matrixService.addFavoriteImagePack(favorite)
      setFavorite(undefined)
      refresh((value) => value + 1)
      message.success('Favorite pack added')
    } catch (error) {
      message.error(error instanceof Error ? error.message : 'Could not add favorite pack')
    } finally {
      setAdding(false)
    }
  }
  const remove = async (roomId: string) => {
    try {
      await matrixService.removeFavoriteImagePack(roomId)
      refresh((value) => value + 1)
    } catch (error) {
      message.error(error instanceof Error ? error.message : 'Could not remove favorite pack')
    }
  }
  const favoriteRoomsKey = favoriteRooms.join(' ')
  const [roomPacks, setRoomPacks] = useState<Record<string, RoomImagePackLocation[]>>({})
  useEffect(() => {
    let cancelled = false
    void Promise.all(
      favoriteRooms.map(
        async (roomId) => [roomId, await matrixService.roomImagePacks(roomId, client)] as const,
      ),
    ).then((entries) => {
      if (!cancelled) setRoomPacks(Object.fromEntries(entries))
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, favoriteRoomsKey])
  const setPackSelection = async (roomId: string, stateKeys: string[] | undefined) => {
    try {
      await matrixService.setFavoriteImagePackSelection(roomId, stateKeys)
      refresh((value) => value + 1)
    } catch (error) {
      message.error(error instanceof Error ? error.message : 'Could not update selected packs')
    }
  }
  const togglePackChecked = async (
    roomId: string,
    packs: RoomImagePackLocation[],
    stateKey: string,
    checked: boolean,
  ) => {
    const allStateKeys = packs.flatMap((location) => location.stateKeys)
    const current = matrixService.favoriteImagePackSelection(roomId, client) ?? allStateKeys
    const target = packs.find((location) => location.stateKey === stateKey)
    const targetStateKeys = target?.stateKeys ?? [stateKey]
    const next = checked
      ? [...new Set([...current, ...targetStateKeys])]
      : current.filter((key) => !targetStateKeys.includes(key))
    const isEverything = allStateKeys.every((key) => next.includes(key))
    await setPackSelection(roomId, isEverything ? undefined : next)
  }
  return (
    <div>
      <h2>Personal stickers</h2>
      <p>Upload images in bulk, review their generated names, and save the whole pack at once.</p>
      <AntList
        bordered
        style={{ marginBottom: 16 }}
        dataSource={[true]}
        renderItem={() => (
          <AntList.Item
            extra={
              <Switch
                aria-label="Show emoji and stickers from every account"
                checked={allAccountPacks}
                disabled={!multiAccount || !combinedAccounts}
                onChange={setAllAccountImagePacksEnabled}
              />
            }
          >
            <AntList.Item.Meta
              title="Show emoji and stickers from every account"
              description={
                multiAccount && combinedAccounts
                  ? 'Merge personal and favorite packs from all accounts in the emoji picker.'
                  : 'Available when multiple accounts use the Combined layout.'
              }
            />
          </AntList.Item>
        )}
      />
      <ImagePackEditor pack={personal} onSaved={() => refresh((value) => value + 1)} />
      <Divider />
      <h2>Favorite packs</h2>
      <p>
        Choose a sticker or emoji pack from your joined rooms. Favorite packs are available in every
        room.
      </p>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <Select
          style={{ flex: 1 }}
          showSearch
          allowClear
          optionFilterProp="label"
          value={favorite}
          options={availablePacks}
          onChange={setFavorite}
          placeholder={
            availablePacks.length ? 'Select a room pack' : 'No additional room packs available'
          }
        />
        <Button type="primary" disabled={!favorite} loading={adding} onClick={() => void add()}>
          Add pack
        </Button>
      </div>
      <AntList
        bordered
        locale={{ emptyText: 'No favorite packs' }}
        dataSource={favoriteRooms}
        renderItem={(roomId) => {
          const packs = roomPacks[roomId] ?? []
          const selection = matrixService.favoriteImagePackSelection(roomId, client)
          const isSelected = (location: RoomImagePackLocation) =>
            !selection || location.stateKeys.some((stateKey) => selection.includes(stateKey))
          const selectedPackCount = packs.filter(isSelected).length
          const filtering = selection !== undefined && selectedPackCount < packs.length
          return (
            <AntList.Item
              actions={[
                <Button
                  key="remove"
                  danger
                  type="text"
                  icon={<DeleteOutlined />}
                  onClick={() => void remove(roomId)}
                >
                  Remove
                </Button>,
              ]}
            >
              <div style={{ width: '100%' }}>
                <AntList.Item.Meta
                  avatar={
                    client?.getRoom(roomId) ? (
                      <RoomAvatar room={client.getRoom(roomId)!} size={36} />
                    ) : (
                      <Avatar size={36}>
                        <SmileOutlined />
                      </Avatar>
                    )
                  }
                  title={client?.getRoom(roomId)?.name || roomId}
                  description={roomId}
                />
                {packs.length > 1 && (
                  <Collapse
                    ghost
                    size="small"
                    style={{ marginTop: 6, marginLeft: 48 }}
                    items={[
                      {
                        key: 'packs',
                        label: (
                          <span style={{ fontSize: 12, opacity: 0.75 }}>
                            {packs.length} packs ·{' '}
                            {filtering ? `${selectedPackCount} shown` : 'all shown'}
                          </span>
                        ),
                        extra: filtering && (
                          <Button
                            type="link"
                            size="small"
                            onClick={(event) => {
                              event.stopPropagation()
                              void setPackSelection(roomId, undefined)
                            }}
                          >
                            Show all
                          </Button>
                        ),
                        children: (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                            {packs.map((location) => {
                              const checked = isSelected(location)
                              const preview = packPreviewEmote(location, client)
                              return (
                                <label
                                  key={location.stateKey}
                                  style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 8,
                                    width: '100%',
                                    boxSizing: 'border-box',
                                    padding: '6px 10px',
                                    border: '1px solid rgba(128, 128, 128, 0.35)',
                                    borderRadius: 8,
                                    cursor: 'pointer',
                                  }}
                                >
                                  <Checkbox
                                    checked={checked}
                                    onChange={(event) =>
                                      void togglePackChecked(
                                        roomId,
                                        packs,
                                        location.stateKey,
                                        event.target.checked,
                                      )
                                    }
                                  />
                                  <span
                                    style={{
                                      width: 28,
                                      height: 28,
                                      flex: '0 0 auto',
                                      display: 'inline-flex',
                                      alignItems: 'center',
                                      justifyContent: 'center',
                                      overflow: 'hidden',
                                    }}
                                  >
                                    {preview ? (
                                      <MatrixEmoteImage
                                        emote={preview}
                                        style={{
                                          width: '100%',
                                          height: '100%',
                                          objectFit: 'contain',
                                        }}
                                      />
                                    ) : (
                                      <SmileOutlined style={{ fontSize: 16, opacity: 0.5 }} />
                                    )}
                                  </span>
                                  {location.pack.pack?.display_name || 'Unnamed pack'}
                                </label>
                              )
                            })}
                          </div>
                        ),
                      },
                    ]}
                  />
                )}
              </div>
            </AntList.Item>
          )
        }}
      />
    </div>
  )
}
