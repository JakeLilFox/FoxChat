import { MemberAvatar } from '../profile'
import { ownMessagesOnRight } from '../../lib/constants'
import {
  AvatarSpace,
  Bubble,
  CancelUploadButton,
  Media,
  MediaFrame,
  MsgGroup,
  MsgRow,
  UploadCard,
  UploadOverlay,
} from '../../styles'
import { CloseOutlined, FileOutlined } from '@ant-design/icons'
import { matrixService } from '../../matrix/MatrixClientService'

export function PendingUpload({
  file,
  progress,
  previewUrl,
  onCancel,
}: {
  file: File
  progress: number
  previewUrl?: string
  onCancel: () => void
}) {
  const userId = matrixService.matrixClient?.getUserId() ?? undefined
  const user = userId ? matrixService.matrixClient?.getUser(userId) : undefined
  const percent = Math.round(Math.min(1, Math.max(0, progress)) * 100)
  const alignRight = ownMessagesOnRight()
  return (
    <MsgRow $mine={alignRight}>
      {userId ? (
        <MemberAvatar
          userId={userId}
          name={user?.displayName || userId}
          url={user?.avatarUrl}
          size={31}
          showPresenceTooltip={false}
        />
      ) : (
        <AvatarSpace />
      )}
      <MsgGroup $mine={alignRight}>
        <Bubble $mine $rightSide={alignRight} $pending data-message-box>
          {previewUrl ? (
            <Media>
              <MediaFrame style={{ width: 220, aspectRatio: '4/3' }}>
                <img src={previewUrl} alt={file.name} />
                <UploadOverlay>
                  <span className="label">Uploading {percent}%</span>
                  <CancelUploadButton
                    className="cancel"
                    type="button"
                    title="Cancel upload"
                    onClick={onCancel}
                  >
                    <CloseOutlined />
                  </CancelUploadButton>
                  <div className="bar">
                    <div className="fill" style={{ width: `${percent}%` }} />
                  </div>
                </UploadOverlay>
              </MediaFrame>
            </Media>
          ) : (
            <UploadCard>
              <CancelUploadButton
                className="cancel"
                type="button"
                title="Cancel upload"
                onClick={onCancel}
              >
                <CloseOutlined />
              </CancelUploadButton>
              <div className="icon">
                <FileOutlined />
              </div>
              <div>
                <div className="fileName">{file.name}</div>
                <div className="meta">Uploading {percent}%</div>
                <div className="bar">
                  <div className="fill" style={{ width: `${percent}%` }} />
                </div>
              </div>
            </UploadCard>
          )}
        </Bubble>
      </MsgGroup>
    </MsgRow>
  )
}
