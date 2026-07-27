import { dumpsysNotifications } from './adb'

export type FoundNotification = {
  raw: string
  body: string | undefined
}

export function findRoomNotification(roomId: string): FoundNotification | undefined {
  const dump = dumpsysNotifications()
  const groupTag = `foxchat.room.${roomId}`
  const groupIndex = dump.indexOf(groupTag)
  if (groupIndex === -1) return undefined

  const rest = dump.slice(groupIndex)
  const nextRecord = rest.indexOf('NotificationRecord(', 1)
  const block = nextRecord === -1 ? rest : rest.slice(0, nextRecord)

  const bodyMatch =
    block.match(/android\.text=(?:String \()?"?([^"\n]+)"?\)?/) ??
    block.match(/tickerText=([^\n]+)/)

  return { raw: block, body: bodyMatch?.[1]?.trim() }
}

export async function waitForDecryptedNotification(
  roomId: string,
  expectedBody: string,
  { timeoutMs = 90_000, intervalMs = 3000 } = {},
): Promise<FoundNotification> {
  const deadline = Date.now() + timeoutMs
  let last: FoundNotification | undefined
  while (Date.now() < deadline) {
    last = findRoomNotification(roomId)
    if (last?.body && last.body.includes(expectedBody)) return last
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
  throw new Error(
    `Notification for room ${roomId} never showed decrypted body "${expectedBody}" within ${timeoutMs}ms. ` +
      `Last seen: ${last ? JSON.stringify(last) : 'no notification found at all'}`,
  )
}
