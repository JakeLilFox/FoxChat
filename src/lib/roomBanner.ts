import { Room } from 'matrix-js-sdk'

export const ROOM_BANNER_EVENT_TYPE = 'page.codeberg.everypizza.room.banner'
export const roomBannerContent = (room?: Room | null) =>
  room?.currentState
    .getStateEvents(ROOM_BANNER_EVENT_TYPE, '')
    ?.getContent<Record<string, any>>() ?? {}
