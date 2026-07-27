import { type Page } from '@playwright/test'

type RetryOptions = {
  label: string
  maxRetryAfterMs?: number
  maxAttempts?: number
}

export async function retryMutatingRequest(
  page: Page,
  matchUrl: (url: URL) => boolean,
  action: () => Promise<void>,
  { label, maxRetryAfterMs = 120_000, maxAttempts = 3 }: RetryOptions,
) {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const responsePromise = page.waitForRequest((request) => matchUrl(new URL(request.url())))
    await action()
    const request = await responsePromise
    const response = await request.response()
    if (!response)
      throw new Error(`${label} request failed: ${request.failure()?.errorText ?? 'no response'}`)
    if (response.ok()) return response
    const body = await response.text()
    if (response.status() === 429) {
      const failure = (() => {
        try {
          return JSON.parse(body) as { retry_after_ms?: number }
        } catch {
          return {}
        }
      })()
      if (
        attempt < maxAttempts - 1 &&
        typeof failure.retry_after_ms === 'number' &&
        failure.retry_after_ms <= maxRetryAfterMs
      ) {
        await page.waitForTimeout(failure.retry_after_ms + 250)
        continue
      }
    }
    throw new Error(`${label} returned ${response.status()}: ${body}`)
  }
  throw new Error(`${label} did not succeed after ${maxAttempts} attempts`)
}

export const pace = (page: Page, ms = 400) => page.waitForTimeout(ms)
