import { SocialBrandIcon } from './SocialBrandIcon'
import { useMediaUrl } from '../../lib/hooks'
import { type SocialLink, socialKind } from '../../lib/social'
import { MatrixClient } from 'matrix-js-sdk'

export function SocialLinkIcon({ item, client }: { item: SocialLink; client?: MatrixClient }) {
  const media = useMediaUrl({ url: item.img }, client, { category: 'other-stickers' })
  const custom = item.img?.startsWith('mxc://') ? media : item.img
  return (
    <span className="socialIcon">
      {custom ? (
        <img
          src={custom}
          alt=""
          width={24}
          height={24}
          style={{
            width: 24,
            height: 24,
            maxWidth: 24,
            maxHeight: 24,
            objectFit: 'contain',
            objectPosition: 'center',
            display: 'block',
          }}
        />
      ) : (
        <SocialBrandIcon kind={socialKind(item.link)} />
      )}
    </span>
  )
}
