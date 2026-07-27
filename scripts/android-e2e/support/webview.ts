import type { Browser, ChainablePromiseElement } from 'webdriverio'

type Scope = Browser | ChainablePromiseElement

function xpathLiteral(value: string): string {
  if (!value.includes("'")) return `'${value}'`
  if (!value.includes('"')) return `"${value}"`
  const parts = value.split("'").map((part) => `'${part}'`)
  return `concat(${parts.join(`,"'",`)})`
}

function accessibleName(name: string): string {
  const literal = xpathLiteral(name)
  return `(normalize-space(string(.))=${literal} or @aria-label=${literal})`
}

const ROLE_TAG: Record<string, string> = {
  button: '(self::button or @role="button")',
  dialog: '@role="dialog"',
  tab: '@role="tab"',
  tabpanel: '@role="tabpanel"',
  switch: '@role="switch"',
  textbox: '(self::input or self::textarea or @role="textbox")',
  heading: '(self::h1 or self::h2 or self::h3 or self::h4 or @role="heading")',
  menuitem: '@role="menuitem"',
}

export async function switchToWebview(
  browser: Browser,
  { timeoutMs = 60_000 }: { timeoutMs?: number } = {},
) {
  const deadline = Date.now() + timeoutMs
  let lastContexts: Awaited<ReturnType<Browser['getContexts']>> = []
  while (Date.now() < deadline) {
    lastContexts = await browser.getContexts()
    const webview = lastContexts.find((context) => {
      const id = typeof context === 'string' ? context : context.id
      return id.toUpperCase().includes('WEBVIEW')
    })
    if (webview) {
      await browser.switchContext(typeof webview === 'string' ? webview : webview.id)
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }
  throw new Error(
    `No WEBVIEW context appeared within ${timeoutMs}ms; last contexts: ${JSON.stringify(lastContexts)}`,
  )
}

export async function switchToNative(browser: Browser) {
  await browser.switchContext('NATIVE_APP')
}

export function testId(scope: Scope, id: string) {
  return scope.$(`.//*[@data-testid=${xpathLiteral(id)}]`)
}

export function byLabel(scope: Scope, text: string) {
  const item = `ancestor::div[contains(concat(" ",normalize-space(@class)," ")," ant-form-item ")][1]`
  const literal = xpathLiteral(text)
  return scope.$(
    `.//label[normalize-space(string(.))=${literal}]/${item}//input | .//label[normalize-space(string(.))=${literal}]/${item}//textarea`,
  )
}

export function byRole(scope: Scope, role: keyof typeof ROLE_TAG, name?: string) {
  const tag = ROLE_TAG[role]
  if (!tag) throw new Error(`Unhandled role "${role}" in byRole() - add it to ROLE_TAG`)
  if (!name) return scope.$(`.//*[${tag}]`)
  if (role === 'dialog' || role === 'tab' || role === 'tabpanel') {
    const literal = xpathLiteral(name)
    return scope.$(
      `.//*[${tag} and (@aria-label=${literal} or .//*[contains(@class,"title") and normalize-space(string(.))=${literal}] or normalize-space(string(.))=${literal})]`,
    )
  }
  return scope.$(`.//*[${tag} and ${accessibleName(name)}]`)
}

export function byText(scope: Scope, value: string, { exact = true } = {}) {
  const predicate = exact
    ? `normalize-space(string(.))=${xpathLiteral(value)}`
    : `contains(normalize-space(string(.)),${xpathLiteral(value)})`
  return scope.$(`.//*[${predicate} and not(.//*[${predicate}])]`)
}

export function byCss(scope: Scope, selector: string) {
  return scope.$(selector)
}

export async function elementScreenRect(browser: Browser, cssSelector: string) {
  const rect = await browser.execute((selector) => {
    const el = document.querySelector(selector)
    if (!el) return null
    const box = el.getBoundingClientRect()
    return {
      x: box.x,
      y: box.y,
      width: box.width,
      height: box.height,
      dpr: window.devicePixelRatio,
    }
  }, cssSelector)
  if (!rect) throw new Error(`Element not found for screen-rect lookup: ${cssSelector}`)
  await switchToNative(browser)
  return {
    x: rect.x * rect.dpr,
    y: rect.y * rect.dpr,
    width: rect.width * rect.dpr,
    height: rect.height * rect.dpr,
  }
}
