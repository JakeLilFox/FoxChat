export function isServerEventId(eventId: string | undefined): eventId is string {
  return eventId?.startsWith('$') ?? false
}
