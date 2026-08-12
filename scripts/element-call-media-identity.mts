const liveKitMediaProps =
  '"data-lk-local-participant":e.participant.isLocal,"data-lk-source":n?.source'
const identifiedLiveKitMediaProps =
  '"data-lk-local-participant":e.participant.isLocal,"data-foxchat-participant-identity":e.participant.identity,"data-lk-source":n?.source'

export const injectElementCallMediaIdentity = (source: string) => {
  const replacements = source.split(liveKitMediaProps).length - 1
  return {
    source: replacements
      ? source.replaceAll(liveKitMediaProps, identifiedLiveKitMediaProps)
      : source,
    replacements,
  }
}
