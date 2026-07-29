import { useMediaUrl } from '../../lib/hooks'
import { type RoomRank } from '../../lib/roleHelpers'
import { CrownOutlined, SafetyCertificateOutlined } from '@ant-design/icons'

export function RoleIcon({ rank, size = 20 }: { rank: RoomRank; size?: number }) {
  const iconUrl = useMediaUrl({ url: rank.icon }, undefined, { category: 'other-stickers' })
  const style = {
    color: rank.color,
    fontSize: size,
    flex: 'none',
    verticalAlign: 'middle',
  } as React.CSSProperties
  return iconUrl ? (
    <img
      src={iconUrl}
      title={rank.name}
      alt=""
      style={{
        width: size,
        height: size,
        objectFit: 'contain',
        flex: 'none',
        verticalAlign: 'middle',
      }}
    />
  ) : rank.level >= 100 ? (
    <CrownOutlined title={rank.name} style={style} />
  ) : (
    <SafetyCertificateOutlined title={rank.name} style={style} />
  )
}
