export type ElementCallMedia = {
  id: string
  stream: MediaStream
  label: string
  screen: boolean
  muted: boolean
  own: boolean
  userId?: string
}

export const reconcileElementCallMedia = (candidates: ElementCallMedia[]) => {
  const reconciled = new Map<string, ElementCallMedia>()
  for (const candidate of candidates) {
    const kind = candidate.screen ? 'screen' : 'camera'
    const key = candidate.userId
      ? `${kind}:user:${candidate.userId}`
      : `${kind}:stream:${candidate.id}`
    // Re-insertion ensures a replacement takes the old stream's position in DOM discovery order.
    reconciled.delete(key)
    reconciled.set(key, candidate)
  }
  return [...reconciled.values()]
}

export const sameElementCallMedia = (left: ElementCallMedia, right: ElementCallMedia) =>
  left.id === right.id &&
  left.stream === right.stream &&
  left.label === right.label &&
  left.screen === right.screen &&
  left.muted === right.muted &&
  left.own === right.own &&
  left.userId === right.userId

export const sameElementCallMediaList = (left: ElementCallMedia[], right: ElementCallMedia[]) =>
  left.length === right.length &&
  left.every((candidate, index) => sameElementCallMedia(candidate, right[index]))
