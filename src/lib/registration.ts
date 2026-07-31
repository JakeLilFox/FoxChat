export const REGISTRATION_DUMMY_STAGE = 'm.login.dummy'
export const REGISTRATION_TERMS_STAGE = 'm.login.terms'
export const REGISTRATION_TOKEN_STAGES = new Set([
  'm.login.registration_token',
  'org.matrix.msc3231.login.registration_token',
])

export type RegistrationPolicy = {
  id: string
  name: string
  url: string
  version?: string
}

export type RegistrationChallenge = {
  baseUrl: string
  session: string
  stage: string
  completed: string[]
  policies: RegistrationPolicy[]
  fallbackUrl: string
  error?: string
}

type UiaResponse = {
  session?: unknown
  completed?: unknown
  flows?: unknown
  params?: unknown
  error?: unknown
}

const nativeStages = new Set([
  REGISTRATION_DUMMY_STAGE,
  REGISTRATION_TERMS_STAGE,
  ...REGISTRATION_TOKEN_STAGES,
])

const registrationPolicies = (params: unknown, baseUrl: string): RegistrationPolicy[] => {
  if (!params || typeof params !== 'object') return []
  const terms = (params as Record<string, unknown>)[REGISTRATION_TERMS_STAGE]
  if (!terms || typeof terms !== 'object') return []
  const policies = (terms as Record<string, unknown>).policies
  if (!policies || typeof policies !== 'object') return []

  return Object.entries(policies as Record<string, unknown>).flatMap(([id, rawPolicy]) => {
    if (!rawPolicy || typeof rawPolicy !== 'object') return []
    const policy = rawPolicy as Record<string, unknown>
    const localized = Object.entries(policy)
      .filter(([key, value]) => key !== 'version' && value && typeof value === 'object')
      .map(([language, value]) => {
        const document = value as Record<string, unknown>
        return { language, name: document.name, url: document.url }
      })
    const preferred =
      localized.find(({ language }) => language === 'en') ??
      localized.find(({ language }) => language.startsWith('en-')) ??
      localized[0]
    if (typeof preferred?.url !== 'string' || !preferred.url) return []
    let url: string
    try {
      const parsed = new URL(preferred.url, baseUrl)
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return []
      url = parsed.toString()
    } catch {
      return []
    }
    return [
      {
        id,
        name: typeof preferred.name === 'string' && preferred.name ? preferred.name : id,
        url,
        version: typeof policy.version === 'string' ? policy.version : undefined,
      },
    ]
  })
}

export function registrationChallengeFromUia(
  baseUrl: string,
  response: UiaResponse,
): RegistrationChallenge | undefined {
  if (typeof response.session !== 'string' || !response.session) return undefined
  const completed = Array.isArray(response.completed)
    ? response.completed.filter((stage): stage is string => typeof stage === 'string')
    : []
  const completedSet = new Set(completed)
  const flows = Array.isArray(response.flows)
    ? response.flows
        .map((flow) =>
          flow && typeof flow === 'object' && Array.isArray((flow as { stages?: unknown }).stages)
            ? (flow as { stages: unknown[] }).stages.filter(
                (stage): stage is string => typeof stage === 'string',
              )
            : [],
        )
        .filter((stages) => stages.length && completed.every((stage) => stages.includes(stage)))
    : []

  const selectedFlow = flows
    .filter((stages) => stages.some((stage) => !completedSet.has(stage)))
    .sort((left, right) => {
      const unsupportedLeft = left.filter((stage) => !nativeStages.has(stage)).length
      const unsupportedRight = right.filter((stage) => !nativeStages.has(stage)).length
      return unsupportedLeft - unsupportedRight || left.length - right.length
    })[0]
  const stage = selectedFlow?.find((candidate) => !completedSet.has(candidate))
  if (!stage) return undefined

  const normalizedBaseUrl = baseUrl.replace(/\/$/, '')
  return {
    baseUrl: normalizedBaseUrl,
    session: response.session,
    stage,
    completed,
    policies:
      stage === REGISTRATION_TERMS_STAGE
        ? registrationPolicies(response.params, normalizedBaseUrl)
        : [],
    fallbackUrl: `${normalizedBaseUrl}/_matrix/client/v3/auth/${encodeURIComponent(stage)}/fallback/web?session=${encodeURIComponent(response.session)}`,
    error: typeof response.error === 'string' ? response.error : undefined,
  }
}
