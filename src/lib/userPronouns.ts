const pronounCache = new Map<string, Promise<string>>()

export const invalidatePronouns = (userId: string) => {
  for (const key of pronounCache.keys())
    if (key.endsWith(`\u0000${userId}`)) pronounCache.delete(key)
}

export const cachedPronouns = (
  accountUserId: string,
  userId: string,
  load: () => Promise<string>,
) => {
  const key = `${accountUserId}\u0000${userId}`
  const cached = pronounCache.get(key)
  if (cached) return cached
  const request = load()
  pronounCache.set(key, request)
  return request
}
