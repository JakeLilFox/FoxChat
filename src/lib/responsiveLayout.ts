export const MOBILE_LAYOUT_BREAKPOINT = 760

// Both flags must come from the live viewport (matchMedia), not window.screen: on Android
// the WebView does not reliably refresh window.screen.width/height when a foldable's
// display changes between its cover and inner screens, which left the unfolded layout
// stuck in mobile mode.
export function shouldUseMobileLayout(
  narrowViewport: boolean,
  android: boolean,
  narrowHeightViewport: boolean,
) {
  if (narrowViewport) return true
  return android && narrowHeightViewport
}
