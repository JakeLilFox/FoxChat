import 'styled-components'

declare module 'styled-components' {
  export interface DefaultTheme {
    bg: string
    panel: string
    chat: string
    text: string
    muted: string
    subtle: string
    border: string
    input: string
    hover: string
    selected: string
    accent: string
    accentHover: string
    accentSoft: string
    bubble: string
    file: string
    shadow: string
    dot: string
    jsonString: string
    jsonNumber: string
    jsonBoolean: string
  }
}
