export const MOBILE_LAYOUT_BREAKPOINT = 760

export function shouldUseMobileLayout(
  narrowViewport: boolean,
  android: boolean,
  screenWidth: number,
  screenHeight: number,
) {
  if (narrowViewport) return true
  return android && Math.min(screenWidth, screenHeight) <= MOBILE_LAYOUT_BREAKPOINT
}
