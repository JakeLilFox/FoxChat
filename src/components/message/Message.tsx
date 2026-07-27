import { CustomReactionChooser } from './CustomReactionChooser'
import { JsonFilePreview } from './JsonFilePreview'
import { LinkPreview } from './LinkPreview'
import { MarkdownText } from './MarkdownText'
import { MatrixMessageText } from './MatrixMessageText'
import { PollMessage } from './PollMessage'
import { PresenceAvatar } from '../profile'
import { ReactionImage } from './ReactionImage'
import { RoleIcon } from '../roles'
import { UserProfileTrigger } from '../profile'
import { UserPronouns } from '../profile'
import { VoiceMessagePlayer } from './VoiceMessagePlayer'
import {
  colorFor,
  initials,
  OWN_MESSAGES_ON_RIGHT_CHANGED_EVENT,
  ownMessagesOnRight,
} from '../../lib/constants'
import { recentStorage, rememberRecent, useRecents } from '../../lib/emojiData'
import { eventBody } from '../../lib/eventHelpers'
import { formatFileSize } from '../../lib/format'
import { useMediaUrl } from '../../lib/hooks'
import { showImageViewer } from '../../lib/media'
import { firstPreviewUrl } from '../../lib/messageText'
import { roomRank } from '../../lib/roleHelpers'
import { fittedMediaSize, messagePosition } from '../../lib/timelineHelpers'
import {
  closeMessageMenuUrl,
  messageMenuOpenFromUrl,
  openMessageMenuUrl,
  openThreadUrl,
} from '../../lib/urlState'
import { showVideoViewer } from '../../lib/media'
import { isAndroidApp } from '../../platform/nativeBackground'
import {
  Author,
  AvatarSpace,
  Bubble,
  DecryptionFailure,
  DevJson,
  Edited,
  FileCard,
  Media,
  MediaFrame,
  MessageMenuBackdrop,
  MessageReactionAction,
  MessageReplyAction,
  MsgGroup,
  MsgRow,
  QuickReactionActions,
  ReactionChips,
  ReactionPicker,
  ReadMark,
  ReplyPreview,
  SpoilerReveal,
  StickerContent,
  StickerMessage,
  ThreadPill,
  VideoExpandButton,
  devJson,
} from '../../styles'
import { memo, useEffect, useRef, useState } from 'react'
import {
  Avatar,
  Button,
  Collapse,
  Dropdown,
  Input,
  Modal,
  Popover,
  Spin,
  Tooltip,
  App as AntApp,
} from 'antd'
import {
  CheckOutlined,
  CodeOutlined,
  CopyOutlined,
  DeleteOutlined,
  DownloadOutlined,
  EditOutlined,
  EnvironmentOutlined,
  ExpandOutlined,
  FileOutlined,
  FlagOutlined,
  LockOutlined,
  MessageOutlined,
  PushpinOutlined,
  RollbackOutlined,
  SmileOutlined,
} from '@ant-design/icons'
import { EventStatus, EventType, M_POLL_START, MatrixEvent, RelationType } from 'matrix-js-sdk'
import { matrixService } from '../../matrix/MatrixClientService'

const QUICK_REACTIONS = ['👍', '❤️', '😂', '🎉', '😮', '😢']
// Ignore the click that follows a mobile menu dismissal.
let suppressMessageMenuOpenUntil = 0
export const Message = memo(function Message({
  event,
}: {
  event: MatrixEvent
  revision?: number | string
}) {
  const { message, modal } = AntApp.useApp()
  const savedReactions = useRecents<string>(recentStorage.reactions)
  const quickReactions = [...new Set([...savedReactions, ...QUICK_REACTIONS])].slice(0, 5)
  const client = matrixService.clientForEvent(event)
  const userId = client?.getUserId()
  const ownAccountUserIds = new Set(
    matrixService.availableAccounts().map((account) => account.userId),
  )
  const mine = matrixService
    .roomAccounts(event.getRoomId() ?? '')
    .some((account) => account.userId === event.getSender())
  const [rightIsMine, setRightIsMine] = useState(ownMessagesOnRight)
  useEffect(() => {
    const onChange = (change: Event) => setRightIsMine((change as CustomEvent<boolean>).detail)
    window.addEventListener(OWN_MESSAGES_ON_RIGHT_CHANGED_EVENT, onChange)
    return () => window.removeEventListener(OWN_MESSAGES_ON_RIGHT_CHANGED_EVENT, onChange)
  }, [])
  const alignRight = mine && rightIsMine
  const sendFailed = event.status === EventStatus.NOT_SENT || event.status === EventStatus.CANCELLED
  const pending = event.status != null && !sendFailed
  const c = event.getContent()
  const imageSpoiler = c['page.codeberg.everypizza.msc4193.spoiler'] === true
  const [spoilerRevealed, setSpoilerRevealed] = useState(false)
  const sender = event.sender
  const name = sender?.name || event.getSender() || 'Unknown'
  const mediaUrl = useMediaUrl(c, client)
  const senderAvatar = useMediaUrl({ url: sender?.getMxcAvatarUrl() }, client)
  const type = event.getType() === 'm.sticker' ? 'm.sticker' : c.msgtype
  const [menu, setMenu] = useState<{
    x: number
    y: number
    image?: boolean
    selection?: string
  }>()
  const [reactionText, setReactionText] = useState('')
  const [reportOpen, setReportOpen] = useState(false)
  const [reportReason, setReportReason] = useState('')
  const [reporting, setReporting] = useState(false)
  // Android back closes the message menu before leaving the room.
  const rowRef = useRef<HTMLDivElement>(null)
  const selectedMessageText = () => {
    const selection = window.getSelection()
    const text = selection?.toString() ?? ''
    if (!text.trim() || !selection || !rowRef.current) return undefined
    const belongsToMessage = [selection.anchorNode, selection.focusNode].some(
      (node) => !!node && rowRef.current?.contains(node),
    )
    return belongsToMessage ? text : undefined
  }
  const openMenu = (value: { x: number; y: number; image?: boolean }) => {
    if (isAndroidApp()) openMessageMenuUrl()
    setMenu({ ...value, selection: selectedMessageText() })
  }
  const closeMenu = () => {
    setMenu((current) => {
      if (!current) return current
      if (isAndroidApp()) closeMessageMenuUrl()
      return undefined
    })
  }
  useEffect(() => {
    if (!isAndroidApp() || !menu) return
    const sync = () => {
      if (!messageMenuOpenFromUrl()) setMenu(undefined)
    }
    window.addEventListener('popstate', sync)
    return () => window.removeEventListener('popstate', sync)
  }, [menu])
  // Close on outside pointer events even when stacking hides the backdrop.
  useEffect(() => {
    if (!menu) return
    const outside = (event: PointerEvent) => {
      if (!(event.target as HTMLElement).closest('.ant-dropdown')) {
        suppressMessageMenuOpenUntil = Date.now() + 200
        closeMenu()
      }
    }
    document.addEventListener('pointerdown', outside, true)
    return () => document.removeEventListener('pointerdown', outside, true)
  }, [menu])
  const onReply = () => {
    closeMenu()
    window.dispatchEvent(new CustomEvent('foxchat-reply', { detail: event }))
  }
  const onEdit = () => {
    closeMenu()
    window.dispatchEvent(new CustomEvent('foxchat-edit', { detail: event }))
  }
  const touchStart = useRef<{ x: number; y: number } | undefined>(undefined)
  const replyId = c['m.relates_to']?.['m.in_reply_to']?.event_id as string | undefined
  const room = client?.getRoom(event.getRoomId())
  const senderRank = room && event.getSender() ? roomRank(room, event.getSender()!) : undefined
  const localReply = replyId ? room?.findEventById(replyId) : undefined
  const [preloadedReply, setPreloadedReply] = useState<MatrixEvent | null>()
  useEffect(() => {
    let cancelled = false
    if (!replyId || localReply) {
      setPreloadedReply(undefined)
      return
    }
    const roomId = event.getRoomId()
    if (roomId)
      void matrixService.loadReplyEvent(roomId, replyId).then((value) => {
        if (!cancelled) setPreloadedReply(value ?? null)
      })
    return () => {
      cancelled = true
    }
  }, [event, replyId, localReply])
  const reply = localReply ?? preloadedReply ?? undefined
  const canDelete =
    !!userId && (mine || room?.currentState.maySendRedactionForEvent(event, userId) === true)
  const canEdit =
    mine && event.getType() === EventType.RoomMessage && c.msgtype === 'm.text' && !!event.getId()
  const canPin =
    !!userId &&
    !!event.getId() &&
    room?.currentState.maySendStateEvent(EventType.RoomPinnedEvents, userId) === true
  const thread = event.getId() ? room?.getThread(event.getId()!) : undefined
  const isPinned =
    !!event.getId() &&
    (
      room?.currentState
        .getStateEvents(EventType.RoomPinnedEvents, '')
        ?.getContent<{ pinned?: string[] }>()?.pinned ?? []
    ).includes(event.getId()!)
  const edited = !!event.replacingEvent()
  const readerIds = mine
    ? (room?.getUsersReadUpTo(event).filter((reader) => !ownAccountUserIds.has(reader)) ?? [])
    : []
  const readByOther = readerIds.length > 0
  const readerNames = [
    ...new Set(readerIds.map((reader) => room?.getMember(reader)?.name || reader)),
  ]
  const receiptTitle = sendFailed
    ? 'Failed to send · click to remove'
    : pending
      ? 'Sending… · click to cancel'
      : room && room.getJoinedMemberCount() > 2 && readerNames.length
        ? `Read by ${readerNames.join(', ')}`
        : readByOther
          ? 'Read'
          : 'Sent'
  const { grouped, continues } = room
    ? messagePosition(room, event)
    : { grouped: false, continues: false }
  const imageBlob = async () => {
    if (!mediaUrl) throw new Error('Image is not available')
    const response = await fetch(mediaUrl)
    if (!response.ok) throw new Error('Could not load image')
    return response.blob()
  }
  const clipboardPng = async (blob: Blob) => {
    if (blob.type === 'image/png') return blob
    const bitmap = await createImageBitmap(blob)
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0)
    bitmap.close()
    const png = await new Promise<Blob | undefined>((resolve) =>
      canvas.toBlob((value) => resolve(value ?? undefined), 'image/png'),
    )
    if (!png) throw new Error('Could not convert image for the clipboard')
    return png
  }
  const copyImage = async () => {
    closeMenu()
    try {
      if (typeof ClipboardItem === 'undefined' || !navigator.clipboard?.write)
        throw new Error('Image copying is not supported on this platform')
      const png = await clipboardPng(await imageBlob())
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })])
      message.success('Image copied')
    } catch (error) {
      message.error(error instanceof Error ? error.message : 'Could not copy image')
    }
  }
  const saveImage = async () => {
    closeMenu()
    try {
      const blob = await imageBlob()
      const extension = blob.type.split('/')[1]?.replace('jpeg', 'jpg') || 'png'
      const invalid = '<>:"/\\|?*'
      const wanted = [...(body || 'image')]
        .map((char) => (char.charCodeAt(0) < 32 || invalid.includes(char) ? '_' : char))
        .join('')
      const filename = /\.[a-z0-9]{2,5}$/i.test(wanted) ? wanted : `${wanted}.${extension}`
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = filename
      anchor.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (error) {
      message.error(error instanceof Error ? error.message : 'Could not save image')
    }
  }
  const remove = () => {
    closeMenu()
    modal.confirm({
      title: 'Delete this message?',
      content: 'The message will be redacted for everyone in the room. This cannot be undone.',
      okText: 'Delete message',
      okButtonProps: { danger: true },
      onOk: () => matrixService.redactMessage(event),
    })
  }
  const togglePin = async () => {
    closeMenu()
    try {
      await matrixService.setPinned(event, !isPinned)
    } catch (error) {
      message.error(error instanceof Error ? error.message : 'Could not update pinned messages')
    }
  }
  const cancelSending = () => {
    if (!matrixService.cancelPendingMessage(event))
      message.info('Already sending, this message can no longer be cancelled')
  }
  const openReport = () => {
    closeMenu()
    setReportReason('')
    setReportOpen(true)
  }
  const submitReport = async () => {
    const roomId = event.getRoomId()
    const eventId = event.getId()
    if (!roomId || !eventId) return
    setReporting(true)
    try {
      await matrixService.reportEvent(roomId, eventId, reportReason.trim())
      message.success('Message reported')
      setReportOpen(false)
    } catch (error) {
      message.error(error instanceof Error ? error.message : 'Could not report message')
    } finally {
      setReporting(false)
    }
  }
  const showDeveloperTools = () => {
    closeMenu()
    const raw = {
      event: event.toJSON(),
      effective_content: event.getContent(),
      original_content: event.getOriginalContent(),
      unsigned: event.getUnsigned(),
      metadata: {
        event_id: event.getId(),
        room_id: event.getRoomId(),
        sender: event.getSender(),
        type: event.getType(),
        state_key: event.getStateKey(),
        timestamp: event.getTs(),
        local_timestamp: event.localTimestamp,
        status: event.status,
        encrypted: event.isEncrypted(),
        decryption_failure: event.isDecryptionFailure(),
        redacted: event.isRedacted(),
        redaction_event: event.getRedactionEvent() ?? null,
        replacing_event: event.replacingEvent()?.toJSON() ?? null,
      },
      sender_model: sender ? Object.fromEntries(Object.entries(sender)) : null,
      reactions: reactions.map(([key, items]) => ({
        key,
        count: items.size,
        senders: [...items].map((reaction) => reaction.getSender()),
        events: [...items].map((reaction) => reaction.toJSON()),
      })),
      rendering: {
        body: eventBody(event),
        message_type: type,
        mine,
        grouped,
        continues,
        reply_event_id: replyId,
        reaction_count: reactions.reduce((total, [, items]) => total + items.size, 0),
        read_by: readerIds,
      },
    }
    modal.info({
      title: `Message developer tools · ${event.getId() ?? 'local event'}`,
      width: 900,
      content: (
        <Collapse
          defaultActiveKey={['raw-event']}
          items={[
            {
              key: 'raw-event',
              label: 'Raw Matrix event',
              children: <DevJson>{devJson(raw.event)}</DevJson>,
            },
            {
              key: 'effective-content',
              label: 'Effective / decrypted content',
              children: <DevJson>{devJson(raw.effective_content)}</DevJson>,
            },
            {
              key: 'original-content',
              label: 'Original content',
              children: <DevJson>{devJson(raw.original_content)}</DevJson>,
            },
            {
              key: 'metadata',
              label: 'Metadata and local state',
              children: (
                <DevJson>
                  {devJson({
                    metadata: raw.metadata,
                    unsigned: raw.unsigned,
                    rendering: raw.rendering,
                  })}
                </DevJson>
              ),
            },
            {
              key: 'reactions',
              label: `Reactions (${raw.rendering.reaction_count})`,
              children: <DevJson>{devJson(raw.reactions)}</DevJson>,
            },
            {
              key: 'sender',
              label: 'Cached sender model',
              children: <DevJson>{devJson(raw.sender_model)}</DevJson>,
            },
          ]}
        />
      ),
      okText: 'Close',
    })
  }
  const jumpToReply = () => {
    const roomId = event.getRoomId()
    if (!replyId || !roomId) return
    window.dispatchEvent(
      new CustomEvent('foxchat-jump-to-event', {
        detail: { eventId: replyId, roomId },
      }),
    )
  }
  const replyPreview = replyId ? (
    <ReplyPreview
      $mine={mine}
      type="button"
      onClick={jumpToReply}
      title={reply ? 'Jump to replied message' : 'Replied message'}
    >
      <span className="replyAuthor">
        {reply ? `↩ ${reply.sender?.name || reply.getSender()}` : '↩ Reply'}
      </span>
      <span className="replyBody">
        {reply
          ? eventBody(reply)
          : preloadedReply === null
            ? 'Original message unavailable'
            : 'Loading original message…'}
      </span>
    </ReplyPreview>
  ) : null
  const replyFallback = (body: string) => {
    const lines = body.split('\n')
    while (lines[0]?.startsWith('> ')) lines.shift()
    if (lines[0] === '') lines.shift()
    return lines.join('\n')
  }
  const relationSet = event.getId()
    ? room?.relations.getChildEventsForEvent(
        event.getId()!,
        RelationType.Annotation,
        EventType.Reaction,
      )
    : undefined
  const reactions = relationSet?.getSortedAnnotationsByKey() ?? []
  const toggleReaction = async (key: string) => {
    key = key.trim()
    if (!key) return
    if (!key.startsWith('mxc://')) key = key.slice(0, 64)
    try {
      const own = reactions.find(([reaction]) => reaction === key)?.[1]
      const existing = own
        ? [...own].reverse().find((reaction) => reaction.getSender() === userId)
        : undefined
      if (existing) await matrixService.redactMessage(existing)
      else {
        rememberRecent(recentStorage.reactions, key, (item) => item)
        await matrixService.sendReaction(event, key)
      }
    } catch (error) {
      message.error(error instanceof Error ? error.message : 'Could not update reaction')
    }
  }
  const submitReactionText = () => {
    const value = reactionText.trim().slice(0, 64)
    if (!value) return
    setReactionText('')
    void toggleReaction(value)
  }
  const openCustomReaction = () => {
    let close: () => void = () => undefined
    const instance = modal.info({
      title: 'React with custom emoji',
      width: 620,
      footer: null,
      closable: true,
      maskClosable: true,
      content: (
        <CustomReactionChooser
          room={room!}
          onSelect={(emote) => {
            close()
            void toggleReaction(emote.url)
          }}
        />
      ),
    })
    close = instance.destroy
  }
  const reactionPicker = (
    <ReactionPicker>
      <div className="quick">
        {quickReactions.map((reaction) => (
          <button
            key={reaction}
            type="button"
            aria-label={
              reaction.startsWith('mxc://') ? 'React with custom emoji' : `React with ${reaction}`
            }
            onClick={(click) => {
              click.preventDefault()
              click.stopPropagation()
              void toggleReaction(reaction)
            }}
          >
            {reaction.startsWith('mxc://') ? (
              <ReactionImage reactionKey={reaction} client={client} />
            ) : (
              reaction
            )}
          </button>
        ))}
      </div>
      <div className="custom">
        <input
          value={reactionText}
          maxLength={64}
          placeholder="Custom reaction"
          aria-label="Custom reaction"
          onChange={(input) => setReactionText(input.target.value)}
          onKeyDown={(key) => {
            if (key.key === 'Enter') {
              key.preventDefault()
              submitReactionText()
            }
          }}
        />
        <button
          type="button"
          disabled={!reactionText.trim()}
          onClick={(click) => {
            click.stopPropagation()
            submitReactionText()
          }}
        >
          Add
        </button>
        <button
          type="button"
          onClick={(click) => {
            click.stopPropagation()
            openCustomReaction()
          }}
        >
          Emoji
        </button>
      </div>
    </ReactionPicker>
  )
  const body = replyFallback(String(c.body ?? ''))
  const copyText = async (text: string, success: string) => {
    closeMenu()
    try {
      await navigator.clipboard.writeText(text)
      message.success(success)
    } catch (error) {
      message.error(error instanceof Error ? error.message : 'Could not copy message')
    }
  }
  const previewUrl =
    type === 'm.text' || type === 'm.notice' || type === 'm.emote'
      ? firstPreviewUrl(body)
      : undefined
  const linkPreview = previewUrl ? (
    <LinkPreview url={previewUrl} client={client} timestamp={event.getTs()} />
  ) : null
  const caption =
    body && body !== c.filename ? (
      <div className="caption">
        <MarkdownText text={body} />
      </div>
    ) : null
  const stickerSize = fittedMediaSize(c.info, 175, 175, 175, 175)
  const visualSize = fittedMediaSize(c.info, 520, 420, 320, 240)
  const stickerLike = type === 'm.sticker'
  const isPollStart = M_POLL_START.matches(event.getType())
  let content: React.ReactNode
  if (event.isDecryptionFailure())
    content = (
      <DecryptionFailure>
        <span>Unable to decrypt · waiting for message keys</span>
        <button
          type="button"
          onClick={(click) => {
            click.stopPropagation()
            void matrixService.retryEventDecryption(event).then((decrypted) => {
              if (!decrypted) message.info('The key is still missing. FoxChat will keep retrying.')
            })
          }}
        >
          Retry
        </button>
      </DecryptionFailure>
    )
  else if (isPollStart)
    content = <PollMessage event={event} room={room} userId={userId} canEnd={canDelete} />
  else if (type === 'm.key.verification.request')
    content = (
      <div>
        <strong>Device verification request</strong>
        <p style={{ margin: '6px 0 10px' }}>
          Compare emoji on both devices to verify this encrypted conversation.
        </p>
        <Button
          size="small"
          icon={<LockOutlined />}
          onClick={(click) => {
            click.stopPropagation()
            try {
              matrixService.openRoomVerification(room!)
            } catch (error) {
              message.info(
                error instanceof Error
                  ? error.message
                  : 'This verification request is no longer active',
              )
            }
          }}
        >
          Open verification
        </Button>
      </div>
    )
  else if (type === 'm.sticker')
    content = (
      <StickerMessage>
        {replyPreview}
        <StickerContent
          data-message-box
          style={{ aspectRatio: `${stickerSize.width}/${stickerSize.height}` }}
        >
          {mediaUrl ? (
            <img
              src={mediaUrl}
              alt={body}
              loading="lazy"
              onClick={() => showImageViewer(mediaUrl, body || 'Sticker')}
            />
          ) : (
            <Spin size="small" />
          )}
          {mine && (
            <Tooltip title={receiptTitle}>
              <ReadMark
                $read={readByOther}
                $sticker
                $pending={pending}
                $failed={sendFailed}
                role={pending || sendFailed ? 'button' : undefined}
                tabIndex={pending || sendFailed ? 0 : undefined}
                style={pending || sendFailed ? { cursor: 'pointer' } : undefined}
                onClick={
                  pending || sendFailed
                    ? (click) => {
                        click.stopPropagation()
                        cancelSending()
                      }
                    : undefined
                }
                onKeyDown={
                  pending || sendFailed
                    ? (key) => {
                        if (key.key === 'Enter' || key.key === ' ') {
                          key.preventDefault()
                          cancelSending()
                        }
                      }
                    : undefined
                }
              >
                {sendFailed ? (
                  '!'
                ) : pending ? (
                  '…'
                ) : (
                  <>
                    <CheckOutlined />
                    {readByOther && <CheckOutlined />}
                  </>
                )}
              </ReadMark>
            </Tooltip>
          )}
        </StickerContent>
      </StickerMessage>
    )
  else if (type === 'm.image')
    content = (
      <Media>
        <MediaFrame
          className={imageSpoiler && !spoilerRevealed ? 'foxchat-spoiler' : undefined}
          style={{
            width: visualSize.width,
            aspectRatio: `${visualSize.width}/${visualSize.height}`,
          }}
        >
          {mediaUrl ? (
            <img
              src={mediaUrl}
              alt={body}
              loading="lazy"
              onClick={() => {
                if (!imageSpoiler || spoilerRevealed) showImageViewer(mediaUrl, body || 'Image')
              }}
            />
          ) : (
            <Spin size="small" />
          )}
          {imageSpoiler && !spoilerRevealed && (
            <SpoilerReveal
              type="button"
              aria-label="Reveal spoiler image"
              onClick={() => setSpoilerRevealed(true)}
            >
              <span>Reveal spoiler</span>
            </SpoilerReveal>
          )}
        </MediaFrame>
        {caption}
      </Media>
    )
  else if (type === 'm.video')
    content = (
      <Media>
        <MediaFrame
          style={{
            width: visualSize.width,
            aspectRatio: `${visualSize.width}/${visualSize.height}`,
          }}
        >
          {mediaUrl ? (
            <>
              <video src={mediaUrl} controls preload="metadata" playsInline />
              <Tooltip title="Open fullscreen">
                <VideoExpandButton
                  type="button"
                  aria-label="Open video fullscreen"
                  onClick={() => showVideoViewer(mediaUrl, body || 'Video')}
                >
                  <ExpandOutlined />
                </VideoExpandButton>
              </Tooltip>
            </>
          ) : (
            <Spin size="small" />
          )}
        </MediaFrame>
        {caption}
      </Media>
    )
  else if (type === 'm.audio' && mediaUrl && c['org.matrix.msc3245.voice'])
    content = (
      <VoiceMessagePlayer
        src={mediaUrl}
        duration={Number(c['org.matrix.msc1767.audio']?.duration ?? c.info?.duration ?? 0)}
        waveform={
          Array.isArray(c['org.matrix.msc1767.audio']?.waveform)
            ? c['org.matrix.msc1767.audio'].waveform
            : []
        }
      />
    )
  else if (type === 'm.audio' && mediaUrl)
    content = (
      <Media>
        <audio src={mediaUrl} controls preload="metadata" />
        {caption}
      </Media>
    )
  else if (
    type === 'm.file' &&
    (c.info?.mimetype === 'application/json' || /\.json$/i.test(String(c.filename ?? body ?? '')))
  )
    content = (
      <JsonFilePreview
        url={mediaUrl}
        filename={String(c.filename ?? body ?? 'file.json')}
        size={c.info?.size}
      />
    )
  else if (type === 'm.file')
    content = (
      <a
        href={mediaUrl ?? undefined}
        target="_blank"
        rel="noreferrer"
        download={c.filename ?? body}
        style={{ color: 'inherit', textDecoration: 'none' }}
      >
        <FileCard>
          <div className="icon">
            <FileOutlined />
          </div>
          <div>
            <div className="fileName">{(c.filename ?? body) || 'Attachment'}</div>
            <div className="meta">
              {c.info?.mimetype || 'File'}
              {c.info?.size ? ` · ${formatFileSize(c.info.size)}` : ''}
            </div>
          </div>
        </FileCard>
      </a>
    )
  else if (type === 'm.location' && c.geo_uri)
    content = (
      <a
        className="location"
        href={`https://www.openstreetmap.org/?mlat=${encodeURIComponent(String(c.geo_uri).replace('geo:', '').split(',')[0])}&mlon=${encodeURIComponent(String(c.geo_uri).replace('geo:', '').split(',')[1] ?? '')}`}
        target="_blank"
        rel="noreferrer"
      >
        <EnvironmentOutlined /> {body || c.geo_uri}
      </a>
    )
  else if (type === 'm.emote')
    content = (
      <div>
        <i>
          * {name} <MatrixMessageText content={c} body={body} />
        </i>
      </div>
    )
  else if (type === 'm.notice')
    content = (
      <div className="notice">
        <MatrixMessageText content={c} body={body} />
      </div>
    )
  else
    content = (
      <>
        <MatrixMessageText content={c} body={body} />
        {edited && <Edited>(edited)</Edited>}
      </>
    )
  const rendered = stickerLike ? (
    content
  ) : (
    <Bubble $mine={mine} $rightSide={alignRight} $pending={pending} data-message-box>
      {replyPreview}
      <div className="messageContent">{content}</div>
      {linkPreview}
      {thread && (
        <ThreadPill
          type="button"
          onClick={(click) => {
            click.stopPropagation()
            openThreadUrl(event.getId()!)
          }}
        >
          <MessageOutlined /> {Math.max(0, thread.events.length - 1)} repl
          {thread.events.length - 1 === 1 ? 'y' : 'ies'}
        </ThreadPill>
      )}
      {mine && (
        <Tooltip title={receiptTitle}>
          <ReadMark
            $read={readByOther}
            $pending={pending}
            $failed={sendFailed}
            role={pending || sendFailed ? 'button' : undefined}
            tabIndex={pending || sendFailed ? 0 : undefined}
            style={pending || sendFailed ? { cursor: 'pointer' } : undefined}
            onClick={
              pending || sendFailed
                ? (click) => {
                    click.stopPropagation()
                    cancelSending()
                  }
                : undefined
            }
            onKeyDown={
              pending || sendFailed
                ? (key) => {
                    if (key.key === 'Enter' || key.key === ' ') {
                      key.preventDefault()
                      cancelSending()
                    }
                  }
                : undefined
            }
          >
            {sendFailed ? (
              '!'
            ) : pending ? (
              '…'
            ) : (
              <>
                <CheckOutlined />
                {readByOther && <CheckOutlined />}
              </>
            )}
          </ReadMark>
        </Tooltip>
      )}
    </Bubble>
  )
  const row = (
    <MsgRow
      ref={rowRef}
      $mine={alignRight}
      $continues={continues}
      onClick={(click) => {
        if (
          !window.matchMedia('(max-width:760px)').matches ||
          (click.target as HTMLElement).closest('a,button,audio,video')
        )
          return
        click.preventDefault()
        if (Date.now() < suppressMessageMenuOpenUntil) return
        openMenu({ x: click.clientX, y: click.clientY })
      }}
      onContextMenu={(e) => {
        e.preventDefault()
        openMenu({
          x: e.clientX,
          y: e.clientY,
          image: !!mediaUrl && !!(e.target as HTMLElement).closest('img'),
        })
      }}
      onTouchStart={(e) => {
        const touch = e.changedTouches[0]
        touchStart.current = touch ? { x: touch.clientX, y: touch.clientY } : undefined
      }}
      onTouchEnd={(e) => {
        const start = touchStart.current
        const end = e.changedTouches[0]
        touchStart.current = undefined
        if (start && end && end.clientX - start.x < -70 && Math.abs(end.clientY - start.y) < 55)
          onReply()
      }}
      onTouchCancel={() => {
        touchStart.current = undefined
      }}
    >
      {grouped ? (
        <AvatarSpace />
      ) : (
        <UserProfileTrigger
          userId={event.getSender() ?? ''}
          name={name}
          avatarUrl={sender?.getMxcAvatarUrl()}
          room={room ?? undefined}
        >
          <PresenceAvatar userId={event.getSender()}>
            <Avatar
              size={31}
              src={senderAvatar}
              style={{
                background: colorFor(event.getSender() ?? name),
                fontSize: 10,
              }}
            >
              {!senderAvatar && initials(name)}
            </Avatar>
          </PresenceAvatar>
        </UserProfileTrigger>
      )}
      <MsgGroup $mine={alignRight}>
        {!grouped && (
          <Author>
            <span style={{ color: senderRank?.color }}>{mine ? 'You' : name}</span>
            <UserPronouns userId={event.getSender()} client={client} />
            {senderRank && <RoleIcon rank={senderRank} size={17} />}
            <span className="timestamp">
              {new Date(event.getTs()).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
              })}
            </span>
            {event.isEncrypted() && <LockOutlined style={{ marginLeft: 5 }} />}
          </Author>
        )}
        {rendered}
        <QuickReactionActions className="quickReactionActions">
          {quickReactions.map((reaction) => (
            <button
              key={reaction}
              type="button"
              aria-label={`React with ${reaction}`}
              onClick={(click) => {
                click.preventDefault()
                click.stopPropagation()
                void toggleReaction(reaction)
              }}
            >
              {reaction.startsWith('mxc://') ? (
                <ReactionImage reactionKey={reaction} client={client} />
              ) : (
                reaction
              )}
            </button>
          ))}
        </QuickReactionActions>
        <Popover content={reactionPicker} trigger="click">
          <MessageReactionAction
            className="messageReplyAction"
            type="button"
            aria-label="Add reaction"
            onMouseDown={(action) => action.preventDefault()}
            onClick={(action) => {
              action.preventDefault()
              action.stopPropagation()
            }}
          >
            <SmileOutlined />
          </MessageReactionAction>
        </Popover>
        <Tooltip title="Reply">
          <MessageReplyAction
            className="messageReplyAction"
            type="button"
            aria-label={`Reply to ${name}`}
            onMouseDown={(action) => action.preventDefault()}
            onClick={(action) => {
              action.preventDefault()
              action.stopPropagation()
              onReply()
            }}
          >
            ↩
          </MessageReplyAction>
        </Tooltip>
        {reactions.length > 0 && (
          <ReactionChips $mine={alignRight}>
            {reactions.map(([key, items]) => {
              const reacted = [...items].some((reaction) => reaction.getSender() === userId)
              const names = [...items]
                .map(
                  (reaction) =>
                    room?.getMember(reaction.getSender() ?? '')?.name || reaction.getSender(),
                )
                .filter(Boolean)
                .join(', ')
              return (
                <Tooltip
                  key={key}
                  title={
                    <>
                      <div>
                        {key.startsWith('mxc://') ? (
                          <ReactionImage reactionKey={key} client={client} />
                        ) : (
                          key
                        )}
                      </div>
                      <small>{names}</small>
                    </>
                  }
                >
                  <button
                    type="button"
                    className={reacted ? 'mine' : ''}
                    onClick={(click) => {
                      click.stopPropagation()
                      void toggleReaction(key)
                    }}
                  >
                    <span className="reactionKey">
                      {key.startsWith('mxc://') ? (
                        <ReactionImage reactionKey={key} client={client} />
                      ) : (
                        key
                      )}
                    </span>
                    <span>{items.size}</span>
                  </button>
                </Tooltip>
              )
            })}
          </ReactionChips>
        )}
      </MsgGroup>
    </MsgRow>
  )
  return (
    <>
      {menu && (
        <MessageMenuBackdrop
          type="button"
          aria-label="Close message menu"
          onPointerDown={(event) => {
            event.preventDefault()
            event.stopPropagation()
            closeMenu()
          }}
        />
      )}
      {row}
      {menu && (
        <Dropdown
          destroyOnHidden
          open
          onOpenChange={(open) => {
            if (!open) closeMenu()
          }}
          placement="bottomLeft"
          menu={{
            items: [
              ...(menu?.image
                ? [
                    {
                      key: 'copy-image',
                      label: 'Copy image',
                      icon: <CopyOutlined />,
                      onClick: () => void copyImage(),
                    },
                    {
                      key: 'save-image',
                      label: 'Save image',
                      icon: <DownloadOutlined />,
                      onClick: () => void saveImage(),
                    },
                    { type: 'divider' as const },
                  ]
                : []),
              ...(menu.selection
                ? [
                    {
                      key: 'copy-selection',
                      label: 'Copy selection',
                      icon: <CopyOutlined />,
                      onClick: () => void copyText(menu.selection!, 'Selection copied'),
                    },
                    {
                      key: 'copy-message',
                      label: 'Copy entire message',
                      icon: <CopyOutlined />,
                      onClick: () => void copyText(body, 'Entire message copied'),
                    },
                  ]
                : [
                    {
                      key: 'copy-message',
                      label: 'Copy message',
                      icon: <CopyOutlined />,
                      onClick: () => void copyText(body, 'Message copied'),
                    },
                  ]),
              { key: 'reply', label: 'Reply', icon: <RollbackOutlined />, onClick: onReply },
              ...(event.getId()
                ? [
                    {
                      key: 'reply-thread',
                      label: 'Reply in thread',
                      icon: <MessageOutlined />,
                      onClick: () => {
                        closeMenu()
                        openThreadUrl(event.getId()!)
                      },
                    },
                  ]
                : []),
              ...(canPin
                ? [
                    {
                      key: 'pin',
                      label: isPinned ? 'Unpin message' : 'Pin message',
                      icon: <PushpinOutlined />,
                      onClick: () => void togglePin(),
                    },
                  ]
                : []),
              {
                key: 'react',
                label: 'React',
                icon: <SmileOutlined />,
                children: [
                  ...quickReactions.map((reaction) => ({
                    key: `react-${reaction}`,
                    label: reaction.startsWith('mxc://') ? (
                      <ReactionImage reactionKey={reaction} client={client} />
                    ) : (
                      reaction
                    ),
                    onClick: () => void toggleReaction(reaction),
                  })),
                  {
                    key: 'react-custom',
                    label: 'Custom reaction…',
                    onClick: openCustomReaction,
                  },
                ],
              },
              ...(canEdit
                ? [{ key: 'edit', label: 'Edit', icon: <EditOutlined />, onClick: onEdit }]
                : []),
              { type: 'divider' as const },
              {
                key: 'report',
                label: 'Report message',
                icon: <FlagOutlined />,
                onClick: openReport,
              },
              {
                key: 'devtools',
                label: 'Developer tools',
                icon: <CodeOutlined />,
                onClick: showDeveloperTools,
              },
              ...(canDelete
                ? [
                    {
                      key: 'delete',
                      label: 'Delete message',
                      icon: <DeleteOutlined />,
                      danger: true,
                      onClick: remove,
                    },
                  ]
                : []),
            ],
          }}
        >
          <span
            aria-hidden
            style={{
              position: 'fixed',
              left: menu?.x ?? 0,
              top: menu?.y ?? 0,
              width: 1,
              height: 1,
              pointerEvents: 'none',
            }}
          />
        </Dropdown>
      )}
      <Modal
        title="Report message"
        open={reportOpen}
        onCancel={() => setReportOpen(false)}
        onOk={() => void submitReport()}
        okText="Report"
        okButtonProps={{ danger: true, loading: reporting }}
      >
        <p>
          This sends a report to your homeserver&apos;s administrators. Let them know what&apos;s
          wrong with this message.
        </p>
        <Input.TextArea
          autoFocus
          rows={3}
          value={reportReason}
          onChange={(e) => setReportReason(e.target.value)}
          placeholder="Reason (optional)"
        />
      </Modal>
    </>
  )
})
