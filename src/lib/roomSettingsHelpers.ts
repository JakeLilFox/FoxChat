import { Room } from 'matrix-js-sdk'

export const showRoomSettings = (room: Room) =>
  window.dispatchEvent(new CustomEvent<Room>('foxchat-room-settings', { detail: room }))
export const showRoomDevTools = (room: Room) =>
  window.dispatchEvent(new CustomEvent<Room>('foxchat-room-devtools', { detail: room }))
