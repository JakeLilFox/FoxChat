import { ImagePackEditor } from '../../ImagePackEditor'
import { RoomAvatar } from '../../rooms'
import {
  type MatrixEmotePack,
  imagePackRoomsTypes,
  roomImagePackTypes,
  setAllAccountImagePacksEnabled,
  useAllAccountImagePacks,
} from '../../../lib/emojiData'
import { useState } from 'react'
import { Avatar, Button, Divider, Select, Switch, App as AntApp, List as AntList } from 'antd'
import { DeleteOutlined, SmileOutlined } from '@ant-design/icons'
import { matrixService } from '../../../matrix/MatrixClientService'

export function StickerSettings() {
  const { message } = AntApp.useApp()
  const client = matrixService.matrixClient
  const [, refresh] = useState(0)
  const allAccountPacks = useAllAccountImagePacks()
  const multiAccount = matrixService.savedAccounts().length > 1
  const combinedAccounts = matrixService.combinedAccountsEnabled()
  const [favorite, setFavorite] = useState<string>()
  const [adding, setAdding] = useState(false)
  const personal =
    client?.getAccountData('m.image_pack' as never)?.getContent<MatrixEmotePack>() ??
    client?.getAccountData('im.ponies.user_emotes' as never)?.getContent<MatrixEmotePack>()
  const favoriteRooms = [
    ...new Set(
      imagePackRoomsTypes.flatMap((type) =>
        Object.keys(
          client?.getAccountData(type as never)?.getContent<{ rooms?: Record<string, unknown> }>()
            .rooms ?? {},
        ),
      ),
    ),
  ]
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
        renderItem={(roomId) => (
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
          </AntList.Item>
        )}
      />
    </div>
  )
}
