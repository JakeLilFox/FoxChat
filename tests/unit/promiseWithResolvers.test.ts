import { describe, expect, it } from 'vitest'
import { createPromiseResolvers } from '../../src/polyfills/promiseWithResolvers'

describe('Promise.withResolvers compatibility', () => {
  it('provides externally callable resolve and reject functions', async () => {
    const resolved = createPromiseResolvers<string>()
    resolved.resolve('published')
    await expect(resolved.promise).resolves.toBe('published')

    const rejected = createPromiseResolvers<never>()
    rejected.reject(new Error('upload failed'))
    await expect(rejected.promise).rejects.toThrow('upload failed')
  })
})
