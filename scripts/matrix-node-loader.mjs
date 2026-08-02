// matrix-js-sdk 42.0.0 contains two extensionless directory imports in its OAuth
// modules. Browsers/bundlers resolve them, but Node's ESM loader intentionally does not.
// Keep this narrowly scoped so it can be removed once the SDK publishes explicit paths.
export async function resolve(specifier, context, nextResolve) {
  if (
    specifier === '../http-api' &&
    /[/\\]matrix-js-sdk[/\\]lib[/\\]oauth[/\\]/.test(context.parentURL ?? '')
  ) {
    return nextResolve('../http-api/index.js', context)
  }
  return nextResolve(specifier, context)
}
