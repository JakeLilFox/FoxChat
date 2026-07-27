import type { Browser } from 'webdriverio'

export type Point = { x: number; y: number }

type PointerAction =
  | { type: 'pointerMove'; duration: number; x: number; y: number; origin?: 'viewport' }
  | { type: 'pointerDown'; button: number }
  | { type: 'pointerUp'; button: number }
  | { type: 'pause'; duration: number }

function move(point: Point, duration = 0): PointerAction {
  return { type: 'pointerMove', duration, x: Math.round(point.x), y: Math.round(point.y) }
}
const down: PointerAction = { type: 'pointerDown', button: 0 }
const up: PointerAction = { type: 'pointerUp', button: 0 }
const pause = (duration: number): PointerAction => ({ type: 'pause', duration })

function interpolate(from: Point, to: Point, steps: number): Point[] {
  return Array.from({ length: steps }, (_, index) => {
    const t = (index + 1) / steps
    return { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t }
  })
}

async function perform(browser: Browser, fingers: PointerAction[][]) {
  await browser.performActions(
    fingers.map((actions, index) => ({
      type: 'pointer' as const,
      id: `finger${index + 1}`,
      parameters: { pointerType: 'touch' as const },
      actions,
    })),
  )
  await browser.releaseActions()
}

export async function tap(browser: Browser, point: Point) {
  await perform(browser, [[move(point), down, pause(80), up]])
}

export async function doubleTapSlow(browser: Browser, point: Point, gapMs = 400) {
  await tap(browser, point)
  await new Promise((resolve) => setTimeout(resolve, gapMs))
  await tap(browser, point)
}

export async function swipe(
  browser: Browser,
  from: Point,
  to: Point,
  { steps = 8, holdMs = 60 } = {},
) {
  const path = interpolate(from, to, steps).map((point) => move(point, 40))
  await perform(browser, [[move(from), down, pause(holdMs), ...path, up]])
}

export async function pinch(
  browser: Browser,
  center: Point,
  {
    startDistance,
    endDistance,
    steps = 10,
  }: { startDistance: number; endDistance: number; steps?: number },
) {
  if (endDistance <= startDistance)
    throw new Error('pinch() currently supports pinch-open gestures only')

  const side = Math.max(80, endDistance * 1.15)
  const percent = Math.min(0.95, Math.max(0.1, (endDistance - startDistance) / side))
  const durationMs = Math.max(500, steps * 45)
  const speed = Math.round(Math.max(200, (endDistance - startDistance) / (durationMs / 1000)))
  await browser.execute('mobile: pinchOpenGesture', {
    left: Math.round(center.x - side / 2),
    top: Math.round(center.y - side / 2),
    width: Math.round(side),
    height: Math.round(side),
    percent,
    speed,
  })
}
