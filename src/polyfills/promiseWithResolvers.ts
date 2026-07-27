type PromiseResolvers<T> = {
  promise: Promise<T>
  resolve: (value: T | PromiseLike<T>) => void
  reject: (reason?: unknown) => void
}

type PromiseConstructorWithResolvers = PromiseConstructor & {
  withResolvers?: <T>() => PromiseResolvers<T>
}

/**
 * Promise.withResolvers only reached Android System WebView in Chromium 119.
 * The Matrix Rust crypto request queue uses it, while the emulator image (and
 * some supported Android devices) can still have an older WebView.
 */
export function createPromiseResolvers<T>(): PromiseResolvers<T> {
  let resolve!: PromiseResolvers<T>['resolve']
  let reject!: PromiseResolvers<T>['reject']
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

const promiseConstructor = Promise as PromiseConstructorWithResolvers
if (typeof promiseConstructor.withResolvers !== 'function') {
  promiseConstructor.withResolvers = createPromiseResolvers
}
