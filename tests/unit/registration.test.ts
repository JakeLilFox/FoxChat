import { describe, expect, it } from 'vitest'
import {
  REGISTRATION_DUMMY_STAGE,
  REGISTRATION_TERMS_STAGE,
  registrationChallengeFromUia,
} from '../../src/lib/registration'

describe('Matrix registration challenges', () => {
  it('prefers a fully supported flow over an external authentication flow', () => {
    const challenge = registrationChallengeFromUia('https://matrix.example/', {
      session: 'registration session',
      flows: [{ stages: ['m.login.recaptcha'] }, { stages: [REGISTRATION_DUMMY_STAGE] }],
    })

    expect(challenge?.stage).toBe(REGISTRATION_DUMMY_STAGE)
    expect(challenge?.fallbackUrl).toBe(
      'https://matrix.example/_matrix/client/v3/auth/m.login.dummy/fallback/web?session=registration%20session',
    )
  })

  it('continues a selected multi-stage flow after its completed stages', () => {
    const challenge = registrationChallengeFromUia('https://matrix.example', {
      session: 'session-id',
      completed: ['m.login.registration_token'],
      flows: [
        { stages: ['m.login.dummy'] },
        { stages: ['m.login.registration_token', REGISTRATION_TERMS_STAGE] },
      ],
      params: {
        [REGISTRATION_TERMS_STAGE]: {
          policies: {
            privacy_policy: {
              version: '2.1',
              de: { name: 'Datenschutz', url: 'https://matrix.example/privacy/de' },
              en: { name: 'Privacy policy', url: 'https://matrix.example/privacy' },
            },
          },
        },
      },
    })

    expect(challenge?.stage).toBe(REGISTRATION_TERMS_STAGE)
    expect(challenge?.policies).toEqual([
      {
        id: 'privacy_policy',
        name: 'Privacy policy',
        url: 'https://matrix.example/privacy',
        version: '2.1',
      },
    ])
  })

  it('rejects malformed UIA responses instead of inventing a registration step', () => {
    expect(registrationChallengeFromUia('https://matrix.example', { flows: [] })).toBeUndefined()
    expect(
      registrationChallengeFromUia('https://matrix.example', {
        session: 'session-id',
        flows: [{ stages: [] }],
      }),
    ).toBeUndefined()
  })
})
