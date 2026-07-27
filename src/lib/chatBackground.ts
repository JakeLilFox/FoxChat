import { matrixService } from '../matrix/MatrixClientService'

export type ChatBackground = {
  url: string
  name?: string
  info?: { mimetype?: string; size?: number }
}
export const currentChatBackground = () =>
  matrixService.matrixClient
    ?.getAccountData('chat.foxchat.appearance' as never)
    ?.getContent<{ chat_background?: ChatBackground }>().chat_background
