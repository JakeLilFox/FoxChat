import { Button } from 'antd'
import { createGlobalStyle, styled } from 'styled-components'

export const GlobalStyle = createGlobalStyle`*{box-sizing:border-box}:root{--foxchat-code-bg:${(p) => p.theme.panel};--foxchat-code-toolbar-bg:${(p) => p.theme.panel};--foxchat-code-text:${(p) => p.theme.text};--foxchat-code-muted:${(p) => p.theme.muted};--foxchat-code-border:${(p) => p.theme.border}}html,body,#root{margin:0;width:100%;height:100%;overflow:hidden;overscroll-behavior:none}body{position:fixed;inset:0;font-family:Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}button,input,textarea{font:inherit}@media(max-width:760px){.foxchat-emoji-popover{inset-inline-start:max(12px,calc((100vw - 354px)/2))!important;inset-block-start:auto!important;inset-block-end:calc(100dvh - var(--foxchat-viewport-height,100dvh) + 92px)!important}}.md-content{max-width:100%;min-width:0;overflow-wrap:anywhere;word-break:break-word}.md-content>*:not(.md-code-block){max-width:100%}.foxchat-timestamp{display:inline-flex;align-items:center;padding:0 .28em;border-radius:.3em;background:color-mix(in srgb,currentColor 10%,transparent);font:inherit;font-weight:600;white-space:nowrap;cursor:help}
.md-content strong,.md-content b{font-weight:700}
.md-content em,.md-content i{font-style:italic}
.md-content del,.md-content s{text-decoration:line-through}
.md-content code{font-family:'Fira Code','Cascadia Code','Consolas',monospace;font-size:.88em;background:${(p) => p.theme.input};padding:1px 4px;border-radius:4px}
.md-content .md-code-block{box-sizing:border-box;width:min(560px,calc(100vw - 150px));max-width:100%;min-width:0;margin:8px 0;overflow:hidden;border:1px solid ${(p) => p.theme.border};border-radius:10px;background:${(p) => p.theme.panel};box-shadow:0 5px 18px ${(p) => p.theme.shadow},0 0 0 1px color-mix(in srgb,${(p) => p.theme.accent} 22%,transparent);text-align:left}
.md-content .md-code-toolbar{height:36px;display:flex;align-items:center;justify-content:space-between;gap:10px;padding:0 7px 0 12px;border-bottom:1px solid ${(p) => p.theme.border};background:${(p) => p.theme.panel};color:${(p) => p.theme.muted};font-size:10px;font-weight:750;text-transform:uppercase;letter-spacing:.05em}.md-code-actions{display:flex;gap:2px}.md-code-actions button,.md-code-fullscreen button{width:28px;height:28px;display:grid;place-items:center;border:0;border-radius:6px;background:transparent;color:${(p) => p.theme.muted};padding:0;font-size:13px;cursor:pointer;transition:color .14s ease,transform .14s ease}.md-code-actions svg{width:14px;height:14px;fill:currentColor}.md-code-actions button:hover,.md-code-fullscreen button:hover{background:transparent;color:${(p) => p.theme.accent};transform:scale(1.1)}
.md-content pre{width:100%;max-width:100%;height:min(300px,38dvh);min-height:90px;margin:0;overflow:auto;scrollbar-gutter:stable;overscroll-behavior:contain;background:${(p) => p.theme.chat};color:${(p) => p.theme.text};padding:14px 16px;border-radius:0;font-size:.88em;line-height:1.5;tab-size:2}.md-content pre code{display:block;width:max-content;min-width:100%;min-height:100%;background:transparent;padding:0;white-space:pre;overflow-wrap:normal;word-break:normal}
.md-content .md-json-viewer pre{background:var(--foxchat-code-bg)!important}.md-content .md-json-viewer pre code{width:100%;white-space:pre-wrap;overflow-wrap:anywhere;word-break:normal}.hljs-comment,.hljs-quote{color:${(p) => p.theme.muted};font-style:italic}.hljs-keyword,.hljs-selector-tag,.hljs-literal,.hljs-section,.hljs-link{color:${(p) => p.theme.accent};font-weight:650}.hljs-string,.hljs-regexp,.hljs-addition,.hljs-attribute,.hljs-meta .hljs-string{color:#39a96b}.hljs-number,.hljs-symbol,.hljs-bullet,.hljs-variable,.hljs-template-variable{color:#d9822b}.hljs-title,.hljs-title.class_,.hljs-title.function_,.hljs-selector-id,.hljs-selector-class{color:#4f8edb}.hljs-built_in,.hljs-type,.hljs-params{color:#b66ac7}.hljs-attr,.hljs-property{color:#3f94b8}.hljs-meta,.hljs-doctag{color:#bd6e35}.hljs-deletion{color:#d85454}.hljs-emphasis{font-style:italic}.hljs-strong{font-weight:750}
.md-code-fullscreen{position:fixed;inset:0;z-index:5000;display:grid;place-items:center;padding:clamp(12px,3vw,36px);background:rgba(5,7,12,.88);backdrop-filter:blur(8px);animation:codeViewerIn .16s ease-out}.md-code-fullscreen-panel{width:100%;height:100%;min-width:0;min-height:0;display:flex;flex-direction:column;overflow:hidden;border:1px solid ${(p) => p.theme.border};border-radius:14px;background:${(p) => p.theme.input};box-shadow:0 24px 80px rgba(0,0,0,.4)}.md-code-fullscreen-head{height:48px;flex:none;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:0 12px 0 16px;border-bottom:1px solid ${(p) => p.theme.border};background:${(p) => p.theme.panel};color:${(p) => p.theme.muted};font-size:12px;font-weight:750;text-transform:uppercase}.md-code-fullscreen-head>span:last-child{display:flex;gap:6px}.md-code-fullscreen pre{flex:1;min-width:0;min-height:0;margin:0;overflow:auto;overscroll-behavior:contain;padding:20px;background:${(p) => p.theme.input};color:${(p) => p.theme.text};font:13px/1.55 'Fira Code','Cascadia Code','Consolas',monospace;tab-size:2}.md-code-fullscreen code{display:block;width:max-content;min-width:100%;white-space:pre}@keyframes codeViewerIn{from{opacity:0;transform:scale(.99)}to{opacity:1;transform:scale(1)}}@media(max-width:760px){.md-content .md-code-block{width:calc(100vw - 92px)}.md-code-fullscreen{padding:8px}.md-code-fullscreen-panel{border-radius:10px}.md-code-fullscreen pre{padding:14px}}@media(prefers-reduced-motion:reduce){.md-code-fullscreen{animation:none}}
.md-content blockquote{border-left:3px solid ${(p) => p.theme.accent};margin:6px 0;padding:4px 10px;color:${(p) => p.theme.muted};font-size:.95em}
.md-content ul,.md-content ol{margin:4px 0;padding-left:20px}
.md-content li{margin:2px 0}
.md-content p{margin:4px 0}
.md-content a,.location{color:#ff8a3d!important;text-decoration:underline;text-decoration-thickness:1px;text-underline-offset:2px}
.md-content a:hover{text-decoration-thickness:2px}
.md-content img[data-mx-emoticon],.md-content img.matrix-inline-emote,img.matrix-inline-emote{display:inline-block!important;width:1em!important;height:1em!important;min-width:0!important;min-height:0!important;max-width:1em!important;max-height:1em!important;object-fit:contain!important;object-position:center!important;vertical-align:-.15em!important;margin:0 .08em!important}
.md-content hr{border:0;border-top:1px solid ${(p) => p.theme.border};margin:8px 0}
.md-content h1,.md-content h2,.md-content h3,.md-content h4,.md-content h5,.md-content h6{margin:8px 0 4px;font-weight:700}
.md-content h1{font-size:1.3em}.md-content h2{font-size:1.15em}.md-content h3{font-size:1.05em}
.md-content table{border-collapse:collapse;width:100%;margin:6px 0}
.md-content th,.md-content td{border:1px solid ${(p) => p.theme.border};padding:4px 8px;text-align:left}
.md-content th{font-weight:700;background:${(p) => p.theme.input}}
.md-mention{border-radius:4px;padding:0 3px;background:${(p) => p.theme.accentSoft};color:${(p) => p.theme.accent};font-weight:600;cursor:pointer}
.md-room-mention{border-radius:4px;padding:0 3px;background:${(p) => p.theme.accentSoft};color:${(p) => p.theme.accent};font-weight:600;cursor:pointer}
.md-spoiler{border-radius:4px;padding:0 3px;background:${(p) => p.theme.text};color:transparent;cursor:pointer;transition:background .12s ease,color .12s ease}
.md-spoiler.revealed{background:${(p) => p.theme.input};color:inherit}
*{scrollbar-width:thin;scrollbar-color:transparent transparent}
*:hover,*.foxchat-scroll-active{scrollbar-color:color-mix(in srgb,${(p) => p.theme.muted} 55%,transparent) transparent}
*::-webkit-scrollbar{width:9px;height:9px;background:transparent}
*::-webkit-scrollbar-track,*::-webkit-scrollbar-track-piece,*::-webkit-scrollbar-corner{background:transparent}
*::-webkit-scrollbar-button,*::-webkit-scrollbar-button:single-button{display:none;width:0;height:0;background:transparent;-webkit-appearance:none}
*::-webkit-scrollbar-thumb{border:2px solid transparent;border-radius:999px;background:transparent;background-clip:padding-box}
*:hover::-webkit-scrollbar-thumb,*.foxchat-scroll-active::-webkit-scrollbar-thumb{background-color:color-mix(in srgb,${(p) => p.theme.muted} 55%,transparent)}
*:hover::-webkit-scrollbar-thumb:hover{background-color:color-mix(in srgb,${(p) => p.theme.muted} 78%,transparent)}`
export const Shell = styled.div<{ $detailsOpen?: boolean; $mobileLayout?: boolean }>`
  position: relative;
  isolation: isolate;
  height: var(--foxchat-viewport-height, 100dvh);
  min-height: 0;
  overflow: hidden;
  display: grid;
  grid-template-columns: ${(p) => (p.$mobileLayout ? 'minmax(0, 1fr)' : '350px minmax(0, 1fr)')};
  padding-right: ${(p) => (p.$detailsOpen && !p.$mobileLayout ? '320px' : '0')};
  transition: padding-right 0.2s ease;
  background: ${(p) => p.theme.bg};
  color: ${(p) => p.theme.text};
  @media (max-width: 1100px) {
    grid-template-columns: ${(p) => (p.$mobileLayout ? 'minmax(0, 1fr)' : '310px minmax(0, 1fr)')};
    padding-right: 0;
  }
  @media (max-width: 760px) {
    grid-template-columns: minmax(0, 1fr);
  }
  html.foxchat-android & {
    padding-top: var(--foxchat-top-inset);
    &::before {
      content: '';
      position: absolute;
      z-index: 30;
      top: 0;
      left: 0;
      right: 0;
      height: var(--foxchat-top-inset);
      pointer-events: none;
      background: ${(p) => p.theme.panel};
      border-bottom: 1px solid ${(p) => p.theme.border};
    }
  }
`
export const Sidebar = styled.aside<{ $mobile?: boolean }>`
  border-right: 1px solid ${(p) => p.theme.border};
  background: ${(p) => p.theme.panel};
  color: ${(p) => p.theme.text};
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  height: 100%;
  overflow: hidden;
  @media (max-width: 760px) {
    display: ${(p) => (p.$mobile ? 'flex' : 'none')};
  }
`
export const SideHeader = styled.div`
  height: 76px;
  padding: 17px 17px 11px;
  display: flex;
  align-items: center;
  gap: 9px;
`
export const SidebarBanner = styled.div`
  height: 92px;
  flex: none;
  overflow: hidden;
  background: ${(p) => p.theme.input};
  img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
`
export const Brand = styled.div`
  font-size: 20px;
  font-weight: 800;
  letter-spacing: -0.5px;
  flex: 1;
  display: flex;
  align-items: center;
  gap: 10px;
`
export const Logo = styled.div`
  width: 35px;
  height: 35px;
  border-radius: 11px;
  background: linear-gradient(135deg, #8267e8, #5f9beb);
  display: grid;
  place-items: center;
  color: white;
  font-weight: 850;
  box-shadow: 0 6px 18px #7357e840;
`
export const IconBtn = styled(Button)`
  && {
    color: ${(p) => p.theme.muted};
    border: 0;
    background: transparent;
    box-shadow: none;
  }
  &&:hover {
    color: ${(p) => p.theme.text};
    background: ${(p) => p.theme.hover}!important;
  }
`
export const SearchWrap = styled.div`
  padding: 0 17px 12px;
  .ant-input-affix-wrapper {
    background: ${(p) => p.theme.input};
    border: 0;
    border-radius: 12px;
    padding: 9px 12px;
    box-shadow: none;
  }
  .ant-input {
    background: transparent;
    color: ${(p) => p.theme.text};
  }
`
export const FilterRow = styled.div`
  padding: 0 17px 9px;
  display: flex;
  gap: 4px;
  overflow-x: auto;
  scrollbar-width: none;
  &::-webkit-scrollbar {
    display: none;
  }
  button {
    flex: none;
    max-width: 150px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    border: 0;
    border-radius: 9px;
    padding: 6px 11px;
    background: transparent;
    color: ${(p) => p.theme.muted};
    cursor: pointer;
    font-weight: 650;
    font-size: 12px;
  }
  button.active {
    background: ${(p) => p.theme.accentSoft};
    color: ${(p) => p.theme.accent};
  }
`
export const List = styled.div`
  min-height: 0;
  overflow: auto;
  padding: 0 8px 12px;
  flex: 1 1 0;
  touch-action: pan-y;
  @media (max-width: 760px) {
    padding-bottom: max(12px, calc(env(safe-area-inset-bottom, 0px) + 12px));
  }
  html.android-button-nav & {
    @media (max-width: 760px) {
      padding-bottom: calc(env(safe-area-inset-bottom, 0px) + 56px);
    }
  }
`
export const VoiceDockSlot = styled.div`
  flex: none;
  min-width: 0;
`
export const VoiceChannelGroup = styled.div`
  width: 100%;
  min-width: 0;
  content-visibility: auto;
  contain-intrinsic-size: auto 68px;
`
export const ActiveSpaceVoiceAvatar = styled.span`
  display: inline-flex;
`
export const ActiveSpaceVoiceIndicator = styled.span`
  width: 22px;
  height: 22px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  background: ${(p) => p.theme.panel};
  color: #35c978;
  border: 2px solid #35c978;
  box-shadow: 0 2px 8px rgba(53, 201, 120, 0.55);
  font-size: 13px;
`
export const VoiceParticipantRow = styled.div`display:flex;align-items:center;gap:9px;min-height:38px;margin:0 10px 2px 29px;padding:4px 9px;border-radius:10px;color:${(p) => p.theme.muted};font-size:12px;overflow:hidden;.participantAvatar{display:inline-flex;flex:none;border-radius:50%;transition:filter .15s ease}.participantAvatar.speaking{filter:drop-shadow(0 0 6px #3b9dff);animation:voiceSpeakingGlow 1.15s ease-in-out infinite}.participantAvatar.speaking .ant-avatar{box-shadow:0 0 0 3px #3b9dff}@keyframes voiceSpeakingGlow{0%,100%{filter:drop-shadow(0 0 3px #3b9dff);transform:scale(1)}50%{filter:drop-shadow(0 0 9px #3b9dff);transform:scale(1.055)}}@media(prefers-reduced-motion:reduce){.participantAvatar.speaking{animation:none}}.participantIdentity{min-width:0;display:flex;flex-direction:column}.participantName{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:650}.participantRank{font-size:10px;opacity:.8;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}}`
export const RankHeading = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 13px 11px 5px;
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: ${(p) => p.theme.muted};
  .line {
    height: 1px;
    flex: 1;
    background: ${(p) => p.theme.border};
  }
  .count {
    font-variant-numeric: tabular-nums;
    opacity: 0.75;
  }
`
export const DevJson = styled.pre`
  max-height: 65vh;
  overflow: auto;
  padding: 12px;
  border: 1px solid ${(p) => p.theme.border};
  border-radius: 8px;
  background: ${(p) => p.theme.hover};
  color: ${(p) => p.theme.text};
  font-size: 12px;
  white-space: pre-wrap;
  word-break: break-word;
`
export const devJson = (value: unknown) => {
  const seen = new WeakSet<object>()
  return JSON.stringify(
    value,
    (_key, item) => {
      if (typeof item === 'bigint') return item.toString()
      if (typeof item === 'object' && item) {
        if (seen.has(item)) return '[Circular]'
        seen.add(item)
      }
      return item
    },
    2,
  )
}
export const Row = styled.button<{
  $selected: boolean
  $dragging?: boolean
  $dropEdge?: 'before' | 'after'
}>`
  width: 100%;
  border: 0;
  background: ${(p) => (p.$selected ? p.theme.selected : 'transparent')};
  display: grid;
  grid-template-columns: 47px 1fr auto;
  gap: 10px;
  align-items: center;
  text-align: left;
  border-radius: 13px;
  padding: 10px;
  cursor: pointer;
  color: inherit;
  margin: ${(p) =>
    p.$dropEdge === 'before' ? '70px 0 2px' : p.$dropEdge === 'after' ? '2px 0 70px' : '2px 0'};
  opacity: ${(p) => (p.$dragging ? 0.38 : 1)};
  transform: ${(p) => (p.$dragging ? 'scale(.97)' : 'none')};
  position: relative;
  transition:
    margin 0.16s ease,
    opacity 0.16s ease,
    transform 0.16s ease,
    background 0.16s ease;
  &:before {
    content: ${(p) => (p.$dropEdge ? '""' : 'none')};
    position: absolute;
    left: 9px;
    right: 9px;
    ${(p) => (p.$dropEdge === 'after' ? 'bottom:-39px' : 'top:-39px')};
    height: 4px;
    border-radius: 4px;
    background: ${(p) => p.theme.accent};
    box-shadow: 0 0 0 5px ${(p) => p.theme.accentSoft};
  }
  &:hover {
    background: ${(p) => p.theme.hover};
  }
`
export const Name = styled.div`
  font-size: 13.5px;
  font-weight: 720;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`
export const Preview = styled.div`
  font-size: 12px;
  color: ${(p) => p.theme.muted};
  margin-top: 4px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`
export const TypingPreview = styled(Preview)`
  color: ${(p) => p.theme.accent};
  font-weight: 650;
  .typingDots {
    display: inline-flex;
    gap: 2px;
    margin-left: 4px;
    vertical-align: middle;
  }
  .typingDots i {
    width: 3px;
    height: 3px;
    border-radius: 50%;
    background: currentColor;
    animation: roomTypingBounce 1s infinite ease-in-out;
  }
  .typingDots i:nth-child(2) {
    animation-delay: 0.14s;
  }
  .typingDots i:nth-child(3) {
    animation-delay: 0.28s;
  }
  @keyframes roomTypingBounce {
    0%,
    60%,
    100% {
      transform: translateY(0);
      opacity: 0.45;
    }
    30% {
      transform: translateY(-3px);
      opacity: 1;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .typingDots i {
      animation: none;
    }
  }
`
export const Profile = styled.div`
  height: 70px;
  border-top: 1px solid ${(p) => p.theme.border};
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 11px 17px;
  cursor: pointer;
  &:hover {
    background: ${(p) => p.theme.hover};
  }
  &:focus-visible {
    outline: 2px solid ${(p) => p.theme.accent};
    outline-offset: -2px;
  }
  .accountPrimary {
    position: relative;
    display: block;
    width: 100%;
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
  }
  .accountName,
  .accountMxid {
    display: block;
    width: 100%;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    transition:
      opacity 0.18s ease,
      transform 0.18s ease;
  }
  .accountName {
    color: ${(p) => p.theme.text};
    font-size: 12.5px;
    font-weight: 760;
    opacity: 1;
    transform: translateY(0);
  }
  .accountMxid {
    position: absolute;
    inset: 0;
    color: ${(p) => p.theme.muted};
    font-size: 10.5px;
    opacity: 0;
    transform: translateY(5px);
  }
  &:hover .accountName,
  &:focus-within .accountName {
    opacity: 0;
    transform: translateY(-5px);
  }
  &:hover .accountMxid,
  &:focus-within .accountMxid {
    opacity: 1;
    transform: translateY(0);
  }
  @media (max-width: 760px) {
    height: auto;
    min-height: 70px;
    padding-bottom: max(11px, calc(env(safe-area-inset-bottom, 0px) + 11px));
  }
  html.android-button-nav & {
    @media (max-width: 760px) {
      padding-bottom: calc(env(safe-area-inset-bottom, 0px) + 46px);
    }
  }
`
export const Main = styled.main.attrs(
  () => ({ 'data-call-stage': 'true' }) as Record<string, string>,
)`
  position: relative;
  isolation: isolate;
  min-width: 0;
  min-height: 0;
  height: 100%;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  touch-action: pan-y;
  background: ${(p) => p.theme.chat};
  &[data-call-open='true']:after {
    content: attr(data-call-status);
    position: absolute;
    z-index: 24;
    left: 20px;
    bottom: 25px;
    padding: 6px 10px;
    border-radius: 12px;
    background: ${(p) => p.theme.panel};
    border: 1px solid ${(p) => p.theme.border};
    color: #e8b84a;
    font-size: 11px;
    font-weight: 750;
    box-shadow: 0 5px 18px ${(p) => p.theme.shadow};
  }
  &[data-call-status-state='connected']:after {
    color: #35c978;
  }
  &[data-call-status-state='failed']:after {
    color: #ff6060;
  }
  .callTile {
    transition:
      border-color 0.15s ease,
      box-shadow 0.15s ease,
      transform 0.15s ease;
  }
  .callTile:hover {
    transform: translateY(-2px);
    box-shadow: 0 10px 30px ${(p) => p.theme.shadow};
  }
  .callTile.speaking {
    animation: callTileSpeaking 1.1s ease-in-out infinite;
  }
  @keyframes callTileSpeaking {
    0%,
    100% {
      box-shadow: 0 0 0 0 rgba(59, 157, 255, 0.25);
    }
    50% {
      box-shadow:
        0 0 0 5px rgba(59, 157, 255, 0.28),
        0 0 24px rgba(59, 157, 255, 0.45);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .callTile.speaking {
      animation: none;
    }
  }
`
export const Topbar = styled.header`
  position: relative;
  z-index: 10;
  height: 76px;
  flex: none;
  border-bottom: 1px solid ${(p) => p.theme.border};
  background: ${(p) => p.theme.panel};
  display: flex;
  align-items: center;
  padding: 0 20px;
  gap: 13px;
`
export const TopInfo = styled.div`
  flex: 1;
  min-width: 0;
  overflow: hidden;
  h2 {
    font-size: 15px;
    margin: 0 0 3px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .status {
    display: block;
    max-width: 100%;
    overflow: hidden;
    color: ${(p) => p.theme.muted};
    font-size: 11.5px;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
`
export const TypingLine = styled.div`
  font-size: 11.5px;
  color: ${(p) => p.theme.accent};
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  .dots {
    display: inline-flex;
    margin-left: 3px;
    gap: 2px;
  }
  .dots i {
    width: 3px;
    height: 3px;
    border-radius: 50%;
    background: currentColor;
    animation: typingBounce 1s infinite ease-in-out;
  }
  .dots i:nth-child(2) {
    animation-delay: 0.14s;
  }
  .dots i:nth-child(3) {
    animation-delay: 0.28s;
  }
  @keyframes typingBounce {
    0%,
    60%,
    100% {
      transform: translateY(0);
      opacity: 0.45;
    }
    30% {
      transform: translateY(-3px);
      opacity: 1;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .dots i {
      animation: none;
    }
  }
`
export const PinnedBar = styled.div`
  position: relative;
  z-index: 9;
  display: flex;
  align-items: center;
  gap: 10px;
  height: 48px;
  flex: none;
  padding: 0 20px;
  border-bottom: 1px solid ${(p) => p.theme.border};
  background: ${(p) => p.theme.panel};
  .pinIcon {
    flex: none;
    color: ${(p) => p.theme.accent};
    font-size: 15px;
  }
  .pinPreview {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    text-align: left;
    border: 0;
    background: none;
    padding: 0;
    color: inherit;
    font: inherit;
    cursor: pointer;
  }
  .pinLabel {
    font-size: 10.5px;
    font-weight: 800;
    color: ${(p) => p.theme.accent};
  }
  .pinBody {
    max-width: 100%;
    font-size: 12px;
    color: ${(p) => p.theme.text};
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .pinActions {
    display: flex;
    align-items: center;
    gap: 2px;
    flex: none;
  }
  .pinActions button {
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    border: 0;
    border-radius: 50%;
    background: none;
    color: ${(p) => p.theme.muted};
    cursor: pointer;
    transition:
      background 0.15s ease,
      color 0.15s ease;
  }
  .pinActions button:hover {
    background: ${(p) => p.theme.hover};
    color: ${(p) => p.theme.text};
  }
`
export const PinnedListItem = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 260px;
  max-width: 340px;
  padding: 7px 4px;
  border-bottom: 1px solid ${(p) => p.theme.border};
  &:last-child {
    border-bottom: 0;
  }
  .jump {
    flex: 1;
    min-width: 0;
    display: block;
    text-align: left;
    border: 0;
    background: none;
    padding: 0;
    color: inherit;
    font: inherit;
    cursor: pointer;
  }
  .pinAuthor {
    display: block;
    font-size: 10.5px;
    font-weight: 800;
    color: ${(p) => p.theme.accent};
  }
  .pinSnippet {
    display: block;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    font-size: 11.5px;
    color: ${(p) => p.theme.text};
  }
  .unpin {
    flex: none;
    display: grid;
    place-items: center;
    width: 24px;
    height: 24px;
    border: 0;
    border-radius: 50%;
    background: none;
    color: ${(p) => p.theme.muted};
    cursor: pointer;
  }
  .unpin:hover {
    background: ${(p) => p.theme.hover};
    color: ${(p) => p.theme.text};
  }
`
export const Messages = styled.div<{ $background?: string; $fixedBackground?: boolean }>`
  position: relative;
  isolation: isolate;
  flex: 1 1 0;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  touch-action: pan-y;
  padding: 22px clamp(15px, 5vw, 65px);
  background-image: ${(p) =>
    p.$fixedBackground && p.$background
      ? 'none'
      : p.$background
        ? `linear-gradient(${p.theme.chat}55,${p.theme.chat}55),url("${p.$background}")`
        : `radial-gradient(${p.theme.dot} .65px,transparent .65px)`};
  background-size: ${(p) => (p.$background ? 'cover' : '18px 18px')};
  background-position: center;
  background-repeat: ${(p) => (p.$background ? 'no-repeat' : 'repeat')};
  background-attachment: scroll;
  &:before {
    content: ${(p) => (p.$fixedBackground && p.$background ? '""' : 'none')};
    position: fixed;
    z-index: -1;
    top: 0;
    left: 0;
    width: var(--foxchat-device-width, 100vw);
    height: var(--foxchat-device-height, 100dvh);
    pointer-events: none;
    background-image: ${(p) =>
      p.$fixedBackground && p.$background
        ? `linear-gradient(${p.theme.chat}55,${p.theme.chat}55),url("${p.$background}")`
        : 'none'};
    background-size: cover;
    background-position: center;
    background-repeat: no-repeat;
  }
`
export const JumpToLatest = styled.button`
  position: absolute;
  z-index: 8;
  right: clamp(20px, 5vw, 68px);
  bottom: 94px;
  display: inline-flex;
  align-items: center;
  gap: 7px;
  border: 1px solid ${(p) => p.theme.border};
  border-radius: 18px;
  padding: 8px 12px;
  background: ${(p) => p.theme.panel};
  color: ${(p) => p.theme.text};
  box-shadow: 0 6px 20px ${(p) => p.theme.shadow};
  font-size: 11px;
  font-weight: 750;
  cursor: pointer;
  transition:
    transform 0.15s ease,
    background 0.15s ease,
    color 0.15s ease;
  &:hover {
    transform: translateY(-2px);
    background: ${(p) => p.theme.hover};
    color: ${(p) => p.theme.accent};
  }
  @media (max-width: 760px) {
    right: 16px;
    bottom: 82px;
  }
`
export const Unread = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 7px 0 18px;
  color: ${(p) => p.theme.accent};
  font-size: 11px;
  font-weight: 750;
  &:before,
  &:after {
    content: '';
    height: 1px;
    flex: 1;
    background: ${(p) => p.theme.accent};
  }
`
export const TimelineDateSeparator = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 10px 0 18px;
  color: ${(p) => p.theme.muted};
  font-size: 11px;
  font-weight: 700;
  &:before,
  &:after {
    content: '';
    height: 1px;
    flex: 1;
    background: ${(p) => p.theme.border};
  }
  time {
    flex: none;
  }
`
export const TimelineDateHint = styled.div`
  position: sticky;
  z-index: 6;
  top: 8px;
  display: flex;
  justify-content: center;
  height: 0;
  pointer-events: none;
  time {
    display: block;
    padding: 5px 11px;
    border: 1px solid ${(p) => p.theme.border};
    border-radius: 20px;
    background: ${(p) => p.theme.panel};
    color: ${(p) => p.theme.muted};
    box-shadow: 0 4px 14px ${(p) => p.theme.shadow};
    font-size: 11px;
    font-weight: 700;
  }
`
export const HistoryStatus = styled.div`
  height: 28px;
  text-align: center;
  color: ${(p) => p.theme.muted};
  font-size: 11px;
`
export const TimelineLoadingSkeleton = styled.div`
  display: grid;
  gap: 18px;
  padding: 14px 0;
  .row {
    display: grid;
    grid-template-columns: 36px minmax(0, 1fr);
    gap: 10px;
    align-items: start;
  }
  .avatar,
  .line {
    background: linear-gradient(
      90deg,
      ${(p) => p.theme.border} 25%,
      ${(p) => p.theme.hover} 50%,
      ${(p) => p.theme.border} 75%
    );
    background-size: 200% 100%;
    animation: foxchatTimelineLoading 1.35s ease-in-out infinite;
  }
  .avatar {
    width: 36px;
    height: 36px;
    border-radius: 50%;
  }
  .content {
    display: grid;
    gap: 8px;
    padding-top: 2px;
  }
  .line {
    height: 10px;
    max-width: 580px;
    border-radius: 999px;
  }
  .line.name {
    width: 28%;
    height: 9px;
  }
  .line.body {
    width: var(--skeleton-width, 72%);
  }
  @keyframes foxchatTimelineLoading {
    from {
      background-position: 100% 0;
    }
    to {
      background-position: -100% 0;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .avatar,
    .line {
      animation: none;
    }
  }
`
export const Day = styled.div`
  width: max-content;
  margin: 0 auto 22px;
  background: ${(p) => p.theme.panel};
  color: ${(p) => p.theme.muted};
  border: 1px solid ${(p) => p.theme.border};
  border-radius: 20px;
  padding: 5px 11px;
  font-size: 11px;
  font-weight: 650;
`
export const MembershipLine = styled.div`
  display: block;
  width: max-content;
  max-width: 90%;
  margin: 7px auto;
  padding: 2px 7px;
  border: 0;
  border-radius: 6px;
  background: color-mix(in srgb, currentColor 10%, transparent);
  color: ${(p) => p.theme.muted};
  box-shadow: none !important;
  font-size: 11px;
  font-weight: 520;
  line-height: 1.4;
  text-align: center;
  text-shadow:
    0 1px 2px ${(p) => (p.theme.text === '#eef0f6' ? 'rgba(0,0,0,.95)' : 'rgba(255,255,255,.98)')},
    0 0 3px ${(p) => (p.theme.text === '#eef0f6' ? 'rgba(0,0,0,.65)' : 'rgba(255,255,255,.8)')};
`
export const MsgRow = styled.div<{ $mine: boolean; $continues?: boolean }>`
  display: flex;
  width: 100%;
  gap: 9px;
  margin: 0 0 ${(p) => (p.$continues ? '3px' : '17px')};
  align-items: flex-end;
  ${(p) => (p.$mine ? 'flex-direction:row-reverse' : '')};
  touch-action: pan-y;
`
export const AvatarSpace = styled.div`
  width: 31px;
  min-width: 31px;
`
export const MsgGroup = styled.div<{ $mine: boolean }>`
  position: relative;
  min-width: 0;
  max-width: min(620px, 80%);
  ${(p) => (p.$mine ? 'text-align:right' : '')};
  &:hover .messageReplyAction,
  &:focus-within .messageReplyAction,
  &:hover .quickReactionActions,
  &:focus-within .quickReactionActions {
    opacity: 1;
    transform: translateY(0);
    pointer-events: auto;
  }
`
export const MessageReplyAction = styled.button`
  position: absolute;
  z-index: 3;
  right: 5px;
  top: -15px;
  width: 28px;
  height: 24px;
  padding: 0;
  border: 1px solid ${(p) => p.theme.border};
  border-radius: 9px;
  background: ${(p) => p.theme.panel};
  color: ${(p) => p.theme.muted};
  box-shadow: 0 4px 12px ${(p) => p.theme.shadow};
  display: grid;
  place-items: center;
  cursor: pointer;
  opacity: 0;
  pointer-events: none;
  transform: translateY(3px);
  transition:
    opacity 0.14s ease,
    transform 0.14s ease,
    color 0.14s ease,
    background 0.14s ease;
  &:hover {
    color: ${(p) => p.theme.accent};
    background: ${(p) => p.theme.hover};
  }
  &:focus-visible {
    opacity: 1;
    pointer-events: auto;
    outline: 2px solid ${(p) => p.theme.accent};
    outline-offset: 2px;
  }
  @media (max-width: 760px) {
    display: none;
  }
`
export const MessageReactionAction = styled(MessageReplyAction)`
  right: 38px;
`
export const MessageMenuBackdrop = styled.button`
  position: fixed;
  inset: 0;
  z-index: 1049;
  width: 100%;
  height: 100%;
  margin: 0;
  padding: 0;
  border: 0;
  background: transparent;
  cursor: default;
`
export const QuickReactionActions = styled.div`
  position: absolute;
  z-index: 4;
  right: 70px;
  top: -15px;
  display: flex;
  gap: 2px;
  padding: 2px;
  border: 1px solid ${(p) => p.theme.border};
  border-radius: 10px;
  background: ${(p) => p.theme.panel};
  box-shadow: 0 4px 12px ${(p) => p.theme.shadow};
  opacity: 0;
  pointer-events: none;
  transform: translateY(3px);
  transition:
    opacity 0.14s ease,
    transform 0.14s ease;
  button {
    width: 25px;
    height: 20px;
    display: grid;
    place-items: center;
    padding: 0;
    border: 0;
    border-radius: 6px;
    background: transparent;
    color: ${(p) => p.theme.text};
    font-size: 14px;
    cursor: pointer;
  }
  button:hover {
    background: ${(p) => p.theme.hover};
  }
  .reactionImage {
    width: 16px !important;
    height: 16px !important;
  }
  @media (max-width: 760px) {
    display: none;
  }
`
export const ReactionPicker = styled.div`
  width: 245px;
  padding: 2px;
  .quick {
    display: flex;
    gap: 3px;
  }
  .quick button {
    width: 32px;
    height: 32px;
    border: 0;
    border-radius: 8px;
    background: transparent;
    font-size: 19px;
    cursor: pointer;
  }
  .quick button:hover {
    background: ${(p) => p.theme.hover};
  }
  .custom {
    display: flex;
    gap: 6px;
    margin-top: 7px;
  }
  .custom input {
    min-width: 0;
    flex: 1;
    border: 1px solid ${(p) => p.theme.border};
    border-radius: 8px;
    background: ${(p) => p.theme.input};
    color: ${(p) => p.theme.text};
    padding: 6px 8px;
  }
  .custom button {
    border: 0;
    border-radius: 8px;
    background: ${(p) => p.theme.accent};
    color: white;
    padding: 0 10px;
    cursor: pointer;
  }
  .custom button:disabled {
    opacity: 0.45;
    cursor: default;
  }
`
export const ReactionChips = styled.div<{ $mine: boolean }>`
  position: relative;
  z-index: 5;
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
  margin-top: 5px;
  justify-content: ${(p) => (p.$mine ? 'flex-end' : 'flex-start')};
  button {
    height: 24px;
    max-width: 170px;
    padding: 1px 7px;
    border: 1px solid ${(p) => p.theme.border};
    border-radius: 9px;
    background: ${(p) => p.theme.panel};
    color: ${(p) => p.theme.text};
    font-size: 12px;
    cursor: pointer;
    box-shadow: 0 2px 7px ${(p) => p.theme.shadow};
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }
  .reactionKey {
    display: block;
    max-width: 130px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .reactionImage {
    display: block;
    width: 18px;
    height: 18px;
    object-fit: contain;
  }
  button.mine {
    border-color: ${(p) => p.theme.accent};
    background: ${(p) => p.theme.accentSoft};
    color: ${(p) => p.theme.accent};
  }
  button:hover {
    border-color: ${(p) => p.theme.accent};
  }
`
export const Author = styled.div`
  font-size: 10.5px;
  color: ${(p) => p.theme.muted};
  margin: 0 8px 5px;
  span {
    font-weight: 720;
    color: ${(p) => p.theme.text};
    margin-right: 7px;
  }
  .pronouns,
  .timestamp {
    padding: 1px 5px;
    border-radius: 5px;
    background: color-mix(in srgb, currentColor 10%, transparent);
    font-weight: 520;
    color: inherit;
    opacity: 0.82;
    text-shadow:
      0 1px 2px ${(p) => (p.theme.text === '#eef0f6' ? 'rgba(0,0,0,.95)' : 'rgba(255,255,255,.98)')},
      0 0 3px
        ${(p) =>
          p.theme.text === '#eef0f6' ? 'rgba(0,0,0,.65)' : 'rgba(255,255,255,.8)'}.timestamp {
      margin-right: 0;
    }
  }
`
export const Bubble = styled.div<{ $mine: boolean; $rightSide?: boolean; $pending?: boolean }>`
  position: relative;
  max-width: 100%;
  min-width: 0;
  background-color: ${(p) => (p.$mine ? p.theme.accent : p.theme.bubble)}!important;
  background-image: none;
  color: ${(p) => (p.$mine ? 'white' : p.theme.text)};
  border: 1px solid ${(p) => (p.$mine ? 'transparent' : p.theme.border)};
  border-radius: ${(p) =>
    (p.$rightSide ?? p.$mine) ? '16px 16px 4px 16px' : '16px 16px 16px 4px'};
  padding: 1px 13px;
  font-size: var(--foxchat-chat-font-size, 13px);
  line-height: 1.55;
  text-align: left;
  box-shadow: 0 3px 12px ${(p) => p.theme.shadow};
  overflow-wrap: anywhere;
  word-break: break-word;
  .messageContent {
    min-width: 0;
    margin: 1em 0;
  }
  ${(p) => (p.$pending ? `animation: foxchatBubblePending 1.4s ease-in-out infinite;` : '')}
  @keyframes foxchatBubblePending {
    0%,
    100% {
      box-shadow:
        0 3px 12px ${(p) => p.theme.shadow},
        0 0 0 1px ${(p) => p.theme.accent}4d;
    }
    50% {
      box-shadow:
        0 3px 12px ${(p) => p.theme.shadow},
        0 0 0 2px ${(p) => p.theme.accent};
    }
  }
  @media (prefers-reduced-motion: reduce) {
    animation: none !important;
  }
`
export const ReadMark = styled.span<{
  $read: boolean
  $sticker?: boolean
  $pending?: boolean
  $failed?: boolean
}>`
  position: absolute;
  z-index: 1;
  right: 1px;
  bottom: -9px;
  display: inline-flex;
  padding-right: 3px;
  font-size: 12px;
  line-height: 19px;
  color: ${(p) => (p.$failed ? '#ff6b6b' : p.$read ? '#9ee7ff' : 'currentColor')};
  opacity: ${(p) => (p.$read ? 1 : 0.65)};
  > .anticon + .anticon {
    margin-left: -6px;
  }
  ${(p) =>
    p.$sticker
      ? 'right:2px;bottom:0;background:rgba(0,0,0,.45);color:white;border-radius:8px;padding:0 6px 0 3px;'
      : ''}
  ${(p) =>
    p.$pending && !p.$failed
      ? 'letter-spacing:normal;opacity:.85;animation:foxchatSendingPulse 1.3s ease-in-out infinite;'
      : ''}
  @keyframes foxchatSendingPulse {
    0%,
    100% {
      opacity: 0.35;
    }
    50% {
      opacity: 0.95;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    animation: none !important;
  }
`
export const RoomListReadMark = styled.span<{ $read: boolean }>`
  display: inline-flex;
  padding-right: 3px;
  font-size: 12px;
  line-height: 1;
  color: ${(p) => (p.$read ? '#4fc3f7' : p.theme.muted)};
  > .anticon + .anticon {
    margin-left: -6px;
  }
`
export const Edited = styled.span`
  margin-left: 6px;
  font-size: 9.5px;
  font-style: italic;
  opacity: 0.68;
`

export const ReplyPreview = styled.button<{ $mine: boolean }>`
  display: block;
  width: 100%;
  min-width: 180px;
  margin: 0 0 8px;
  margin-top: 10px;
  padding: 7px 9px;
  border: 0;
  border-left: 3px solid ${(p) => (p.$mine ? '#c9f2ff' : p.theme.accent)};
  border-radius: 7px;
  background: ${(p) => (p.$mine ? 'rgba(18,12,55,.28)' : p.theme.accentSoft)};
  color: ${(p) => (p.$mine ? '#fff' : p.theme.text)};
  text-align: left;
  cursor: pointer;
  transition:
    background 0.16s ease,
    transform 0.16s ease,
    box-shadow 0.16s ease;
  .replyAuthor {
    display: block;
    margin-bottom: 1px;
    color: ${(p) => (p.$mine ? '#c9f2ff' : p.theme.accent)};
    font-size: 10.5px;
    font-weight: 800;
  }
  .replyBody {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 11.5px;
    opacity: 0.92;
  }
  &:hover {
    background: ${(p) => (p.$mine ? 'rgba(18,12,55,.44)' : p.theme.selected)};
    transform: translateY(-1px);
    box-shadow: 0 3px 10px ${(p) => p.theme.shadow};
  }
  &:focus-visible {
    outline: 2px solid ${(p) => (p.$mine ? '#c9f2ff' : p.theme.accent)};
    outline-offset: 2px;
  }
`
export const FileCard = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  background: ${(p) => p.theme.file};
  border-radius: 10px;
  padding: 10px;
  min-width: 220px;
  .icon {
    width: 38px;
    height: 38px;
    border-radius: 9px;
    background: ${(p) => p.theme.accentSoft};
    color: ${(p) => p.theme.accent};
    display: grid;
    place-items: center;
  }
  .fileName {
    font-weight: 650;
    font-size: 12px;
  }
  .meta {
    font-size: 10.5px;
    color: ${(p) => p.theme.muted};
  }
`
export const ThreadPill = styled.button`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-top: 6px;
  padding: 4px 10px;
  border: 1px solid ${(p) => p.theme.border};
  border-radius: 999px;
  background: ${(p) => p.theme.input};
  color: ${(p) => p.theme.accent};
  font-size: 11.5px;
  font-weight: 650;
  cursor: pointer;
`
export const ThreadPanelBox = styled.div`
  display: flex;
  flex-direction: column;
  height: 100%;
  .head {
    flex: none;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 12px 14px;
    border-bottom: 1px solid ${(p) => p.theme.border};
    button {
      border: 0;
      background: transparent;
      color: ${(p) => p.theme.muted};
      cursor: pointer;
      padding: 4px;
      display: grid;
      place-items: center;
    }
  }
  .body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: 8px 10px;
  }
`
export const ThreadComposer = styled.div`
  flex: none;
  display: flex;
  align-items: flex-end;
  gap: 8px;
  padding: 10px;
  border-top: 1px solid ${(p) => p.theme.border};
  textarea {
    flex: 1;
    min-width: 0;
  }
`
export const ThreadListItem = styled.button`
  display: block;
  width: 100%;
  text-align: left;
  border: 0;
  border-radius: 10px;
  padding: 9px 10px;
  margin-bottom: 6px;
  background: ${(p) => p.theme.input};
  color: inherit;
  cursor: pointer;
  font: inherit;
  .root {
    font-size: 13px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .meta {
    font-size: 11px;
    color: ${(p) => p.theme.muted};
    margin-top: 2px;
  }
`
export const ThreadDrawerHead = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
  button {
    border: 0;
    background: transparent;
    color: ${(p) => p.theme.muted};
    cursor: pointer;
    padding: 4px;
  }
`
export const PollCard = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 220px;
  max-width: 360px;
`
export const PollQuestion = styled.div`
  font-weight: 650;
  margin-bottom: 2px;
`
export const PollAnswer = styled.button<{ $selected?: boolean }>`
  position: relative;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
  padding: 8px 10px;
  border-radius: 10px;
  border: 1px solid ${(p) => (p.$selected ? p.theme.accent : p.theme.border)};
  background: ${(p) => p.theme.input};
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
  overflow: hidden;
  &:disabled {
    cursor: default;
    opacity: 0.85;
  }
`
export const PollAnswerBar = styled.span`
  position: absolute;
  inset: 0;
  right: auto;
  background: ${(p) => p.theme.accentSoft};
  transition: width 0.2s ease;
  z-index: 0;
`
export const PollAnswerText = styled.span`
  position: relative;
  z-index: 1;
  flex: 1;
  min-width: 0;
  font-size: 13px;
`
export const PollAnswerCount = styled.span`
  position: relative;
  z-index: 1;
  flex: none;
  font-size: 11px;
  color: ${(p) => p.theme.muted};
`
export const PollFooter = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 11px;
  color: ${(p) => p.theme.muted};
  margin-top: 2px;
`
export const VoicePlayer = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 200px;
  max-width: 280px;
  color: currentColor;
  button {
    flex: none;
    display: grid;
    place-items: center;
    border: 0;
    background: transparent;
    color: currentColor;
    font-size: 30px;
    line-height: 1;
    padding: 0;
    cursor: pointer;
  }
  .time {
    flex: none;
    font-size: 11px;
    color: currentColor;
    opacity: 0.75;
    font-variant-numeric: tabular-nums;
  }
`
export const VoiceWaveform = styled.div`
  flex: 1;
  min-width: 0;
  height: 28px;
  display: flex;
  align-items: center;
  gap: 1.5px;
  cursor: pointer;
  border-radius: 4px;
  outline-offset: 3px;
  span {
    flex: 1;
    min-width: 1px;
    align-self: flex-end;
    background: currentColor;
    opacity: 0.85;
    border-radius: 2px;
  }
`
export const JsonViewerBox = styled.div`
  width: min(560px, calc(100vw - 150px));
  max-width: 100%;
  min-width: 220px;
  margin: 4px 0;
  border: 1px solid ${(p) => p.theme.border};
  border-radius: 10px;
  background: ${(p) => p.theme.panel};
  box-shadow: 0 5px 18px ${(p) => p.theme.shadow};
  overflow: hidden;
  @media (max-width: 760px) {
    width: calc(100vw - 92px);
  }
`
export const JsonViewerToolbar = styled.div`
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 0 8px 0 12px;
  border-bottom: 1px solid ${(p) => p.theme.border};
  background: ${(p) => p.theme.input};
  color: ${(p) => p.theme.muted};
  font-size: 11px;
  font-weight: 700;
  .name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .actions {
    display: flex;
    align-items: center;
    gap: 2px;
    flex: none;
  }
  .actions button,
  .actions a {
    width: 26px;
    height: 26px;
    display: grid;
    place-items: center;
    border: 0;
    border-radius: 6px;
    background: transparent;
    color: inherit;
    cursor: pointer;
    text-decoration: none;
  }
  .actions button:hover,
  .actions a:hover {
    background: ${(p) => p.theme.hover};
    color: ${(p) => p.theme.accent};
  }
`
export const JsonViewerBody = styled.div<{ $fullscreen?: boolean }>`
  ${(p) =>
    p.$fullscreen
      ? 'flex:1;min-width:0;min-height:0;overflow:auto;padding:16px;'
      : 'max-height:min(320px,40vh);overflow:auto;padding:8px 4px;'}
  font-family: 'Fira Code', 'Cascadia Code', 'Consolas', monospace;
  font-size: 12px;
  line-height: 1.65;
  overscroll-behavior: contain;
  .jsonError {
    padding: 12px;
    color: ${(p) => p.theme.muted};
    font-style: italic;
  }
`
export const JsonRow = styled.div<{ $depth: number }>`
  display: flex;
  align-items: flex-start;
  gap: 2px;
  padding-left: ${(p) => p.$depth * 16}px;
  border-radius: 4px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  &:hover {
    background: ${(p) => p.theme.hover};
  }
`
export const JsonToggleBtn = styled.button`
  flex: none;
  width: 14px;
  height: 20px;
  display: grid;
  place-items: center;
  border: 0;
  background: transparent;
  color: ${(p) => p.theme.muted};
  cursor: pointer;
  padding: 0;
  font-size: 9px;
`
export const JsonKey = styled.span`
  color: ${(p) => p.theme.accent};
  font-weight: 600;
`
export const JsonPunct = styled.span`
  color: ${(p) => p.theme.muted};
`
export const JsonMeta = styled.span`
  color: ${(p) => p.theme.muted};
  font-size: 10.5px;
  margin: 0 4px;
`
export const JsonStringSpan = styled.span`
  color: ${(p) => p.theme.jsonString};
`
export const JsonNumberSpan = styled.span`
  color: ${(p) => p.theme.jsonNumber};
`
export const JsonBooleanSpan = styled.span`
  color: ${(p) => p.theme.jsonBoolean};
  font-weight: 600;
`
export const JsonNullSpan = styled.span`
  color: ${(p) => p.theme.muted};
  font-style: italic;
`
export const JsonFullscreenOverlay = styled.div`
  position: fixed;
  inset: 0;
  z-index: 5000;
  display: grid;
  place-items: center;
  padding: clamp(12px, 3vw, 36px);
  background: rgba(0, 0, 0, 0.55);
  backdrop-filter: blur(8px);
  animation: codeViewerIn 0.16s ease-out;
  @media (prefers-reduced-motion: reduce) {
    animation: none;
  }
`
export const JsonFullscreenPanel = styled.div`
  width: 100%;
  height: 100%;
  max-width: 900px;
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
  border: 1px solid ${(p) => p.theme.border};
  border-radius: 14px;
  background: ${(p) => p.theme.panel};
  box-shadow: 0 24px 80px rgba(0, 0, 0, 0.4);
  .head {
    height: 48px;
    flex: none;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 0 12px 0 16px;
    border-bottom: 1px solid ${(p) => p.theme.border};
    background: ${(p) => p.theme.input};
    color: ${(p) => p.theme.muted};
    font-size: 12px;
    font-weight: 700;
  }
  .head .name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .head .actions {
    display: flex;
    gap: 4px;
    flex: none;
  }
  .head button,
  .head a {
    width: 32px;
    height: 32px;
    display: grid;
    place-items: center;
    border: 0;
    border-radius: 7px;
    background: transparent;
    color: inherit;
    cursor: pointer;
    text-decoration: none;
  }
  .head button:hover,
  .head a:hover {
    background: ${(p) => p.theme.hover};
    color: ${(p) => p.theme.accent};
  }
  @media (max-width: 760px) {
    max-width: 100%;
    border-radius: 10px;
  }
`
export const Media = styled.div`
  img,
  video {
    display: block;
    max-width: 100%;
    max-height: 420px;
    border-radius: 9px;
  }
  img {
    cursor: zoom-in;
  }
  audio {
    display: block;
    max-width: 100%;
    height: 38px;
  }
  .caption {
    margin-top: 7px;
  }
  .reply {
    border-left: 3px solid ${(p) => p.theme.accent};
    padding: 5px 8px;
    margin-bottom: 8px;
    color: ${(p) => p.theme.muted};
    font-size: 11px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .notice {
    font-style: italic;
    opacity: 0.8;
  }
  .location {
    display: flex;
    align-items: center;
    gap: 8px;
    color: inherit;
    text-decoration: none;
  }
`
export const MessageGalleryGrid = styled.div<{ $count: number }>`
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 4px;
  width: min(520px, 68vw);
  max-width: 100%;
  overflow: hidden;
  border-radius: 10px;
  .galleryTile {
    position: relative;
    min-width: 0;
    aspect-ratio: 1;
    overflow: hidden;
    border: 0;
    padding: 0;
    background: ${(p) => p.theme.input};
  }
  .galleryTile:nth-child(5):last-child {
    grid-column: 1 / -1;
    aspect-ratio: 2 / 1;
  }
  .galleryTile > button:not(.spoilerReveal) {
    width: 100%;
    height: 100%;
    display: grid;
    place-items: center;
    border: 0;
    padding: 0;
    background: transparent;
    cursor: zoom-in;
  }
  .galleryTile img {
    width: 100%;
    height: 100%;
    max-height: none;
    object-fit: cover;
    border-radius: 0;
  }
  .galleryTile .spoilerReveal {
    position: absolute;
    inset: 0;
    border: 0;
    background: rgba(22, 23, 29, 0.68);
    color: white;
    cursor: pointer;
    font-weight: 700;
    backdrop-filter: blur(18px);
  }
  ${(p) =>
    p.$count === 3
      ? `
    .galleryTile:first-child {
      grid-row: span 2;
      aspect-ratio: auto;
    }
  `
      : ''}
  @media (max-width: 600px) {
    width: min(100%, 76vw);
  }
`
export const LinkPreviewCard = styled.a<{ $withImage?: boolean }>`
  display: grid;
  grid-template-columns: minmax(0, 1fr) 92px;
  min-width: 220px;
  max-width: 460px;
  min-height: 76px;
  margin: 8px 0 6px;
  overflow: hidden;
  border: 1px solid ${(p) => p.theme.border};
  border-radius: 10px;
  background: ${(p) => p.theme.panel};
  color: ${(p) => p.theme.text}!important;
  text-decoration: none !important;
  box-shadow: 0 3px 10px ${(p) => p.theme.shadow};
  .previewText {
    min-width: 0;
    padding: 9px 11px;
  }
  .previewSite {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: #ff8a3d;
    font-size: 9.5px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .previewTitle {
    margin-top: 2px;
    overflow: hidden;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    font-size: 12px;
    font-weight: 750;
    line-height: 1.35;
  }
  .previewDescription {
    margin-top: 3px;
    overflow: hidden;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    color: ${(p) => p.theme.muted};
    font-size: 10.5px;
    line-height: 1.35;
  }
  .previewImage {
    width: 92px;
    height: 100%;
    min-height: 76px;
    object-fit: cover;
    background: ${(p) => p.theme.input};
    cursor: zoom-in;
  }
  @media (max-width: 480px) {
    grid-template-columns: minmax(0, 1fr) 72px;
    .previewImage {
      width: 72px;
    }
  }
  ${(p) =>
    p.$withImage &&
    `
    grid-template-columns: minmax(0, 1fr);
    max-width: 420px;
    .previewImage {
      order: -1;
      width: 100%;
      height: 200px;
      min-height: 0;
    }
    .previewMediaPlaceholder {
      order: -1;
      display: block;
      width: 100%;
      height: 200px;
      background: rgba(127, 127, 127, 0.12);
    }
    .previewVideo {
      order: -1;
      display: block;
      width: 100%;
      max-height: 260px;
      height: 200px;
      max-width: 100%;
      object-fit: contain;
      background: #000;
    }
    @media (max-width: 480px) {
      grid-template-columns: minmax(0, 1fr);
      .previewImage {
        width: 100%;
      }
      .previewVideo {
        height: 180px;
        max-height: 180px;
      }
      .previewMediaPlaceholder {
        height: 180px;
      }
    }
  `}
`
export const MediaFrame = styled.div`
  position: relative;
  display: grid;
  place-items: center;
  max-width: 100%;
  margin-top: 15px;
  margin-bottom: 15px;
  overflow: hidden;
  border-radius: 9px;
  background: ${(p) => p.theme.input};
  img,
  video {
    width: 100%;
    height: 100%;
    object-fit: contain;
  }
  .ant-spin {
    position: absolute;
  }
  &.foxchat-spoiler img {
    filter: blur(28px) brightness(0.55);
    transform: scale(1.15);
  }
`
export const SpoilerReveal = styled.button`
  position: absolute;
  inset: 0;
  z-index: 2;
  display: grid;
  place-items: center;
  border: 0;
  background: rgba(9, 10, 15, 0.48);
  color: #fff;
  cursor: pointer;
  font: inherit;
  font-size: 12px;
  font-weight: 750;
  letter-spacing: 0.02em;
  text-shadow: 0 1px 4px #000;
  span {
    padding: 7px 11px;
    border: 1px solid rgba(255, 255, 255, 0.45);
    border-radius: 999px;
    background: rgba(0, 0, 0, 0.42);
  }
`
export const UploadOverlay = styled.div`
  position: absolute;
  inset: 0;
  display: flex;
  align-items: flex-end;
  background: linear-gradient(rgba(0, 0, 0, 0) 45%, rgba(0, 0, 0, 0.55));
  .label {
    position: absolute;
    left: 10px;
    bottom: 10px;
    color: #fff;
    font-size: 11px;
    font-weight: 650;
    text-shadow: 0 1px 3px rgba(0, 0, 0, 0.6);
  }
  .cancel {
    position: absolute;
    top: 6px;
    right: 6px;
  }
  .bar {
    width: 100%;
    height: 3px;
    background: rgba(255, 255, 255, 0.3);
  }
  .fill {
    height: 100%;
    background: #fff;
    transition: width 0.15s ease;
  }
`
export const UploadCard = styled(FileCard)`
  position: relative;
  .bar {
    margin-top: 6px;
    width: 100%;
    height: 3px;
    border-radius: 2px;
    overflow: hidden;
    background: ${(p) => p.theme.border};
  }
  .fill {
    height: 100%;
    background: ${(p) => p.theme.accent};
    transition: width 0.15s ease;
  }
  .cancel {
    position: absolute;
    top: 6px;
    right: 6px;
  }
`
export const CancelUploadButton = styled.button`
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  border: 0;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.55);
  color: #fff;
  cursor: pointer;
  font-size: 12px;
  line-height: 1;
  transition: background 0.15s ease;
  &:hover {
    background: rgba(0, 0, 0, 0.75);
  }
`
export const DecryptionFailure = styled.div`
  display: flex;
  align-items: center;
  gap: 9px;
  font-size: 12px;
  font-style: italic;
  button {
    border: 1px solid currentColor;
    border-radius: 8px;
    background: transparent;
    color: inherit;
    padding: 3px 8px;
    cursor: pointer;
    font-style: normal;
    font-weight: 700;
  }
  button:hover {
    background: rgba(255, 255, 255, 0.12);
  }
`
export const StickerContent = styled.div`
  position: relative;
  width: min(175px, 50vw);
  height: min(175px, 50vw);
  max-width: 175px;
  max-height: 175px;
  min-height: 28px;
  display: grid;
  place-items: center;
  padding: 0 !important;
  border: 0 !important;
  background: transparent !important;
  box-shadow: none !important;
  .md-content,
  .matrix-formatted-message,
  .md-content > p {
    display: grid;
    width: 100%;
    height: 100%;
    margin: 0 !important;
    place-items: center;
  }
  .matrix-inline-emote,
  img {
    display: block !important;
    width: 100% !important;
    height: 100% !important;
    max-width: 175px !important;
    max-height: 175px !important;
    margin: 0 !important;
    object-fit: contain !important;
    object-position: center !important;
    vertical-align: middle !important;
    cursor: zoom-in;
  }
`
export const StickerMessage = styled.div`
  width: min(204px, 58vw);
  padding: 0 !important;
  border: 0 !important;
  background: transparent !important;
  box-shadow: none !important;
`
export const GalleryGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 5px;
  .galleryImage {
    position: relative;
    aspect-ratio: 1;
    overflow: hidden;
    border: 0;
    border-radius: 7px;
    padding: 0;
    background: ${(p) => p.theme.input};
    cursor: pointer;
  }
  .galleryImage img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .galleryLoading {
    grid-column: 1/-1;
    display: grid;
    place-items: center;
    min-height: 70px;
  }
  @media (max-width: 600px) {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
`
export const DirectoryList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: min(60vh, 480px);
  overflow-y: auto;
  overscroll-behavior: contain;
  .item {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px;
    border-radius: 12px;
    background: ${(p) => p.theme.input};
  }
  .meta {
    flex: 1;
    min-width: 0;
  }
  .name {
    font-weight: 650;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .topic {
    font-size: 12px;
    color: ${(p) => p.theme.muted};
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .members {
    font-size: 11px;
    color: ${(p) => p.theme.muted};
    margin-top: 2px;
  }
`
export const SearchResultsList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: 10px;
  max-height: min(55vh, 440px);
  overflow-y: auto;
  overscroll-behavior: contain;
  .item {
    display: block;
    width: 100%;
    text-align: left;
    border: 0;
    border-radius: 10px;
    padding: 8px 10px;
    background: ${(p) => p.theme.input};
    color: inherit;
    cursor: pointer;
    font: inherit;
  }
  .item:hover {
    background: ${(p) => p.theme.hover};
  }
  .sender {
    font-weight: 650;
    font-size: 12.5px;
  }
  .item.invitation {
    align-items: flex-start;
    margin-bottom: 8px;
    padding: 10px;
    border: 1px solid ${(p) => p.theme.border};
  }
  .sender .room {
    font-weight: 500;
    color: ${(p) => p.theme.muted};
  }
  .body {
    font-size: 13px;
    margin-top: 2px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .ts {
    font-size: 10.5px;
    color: ${(p) => p.theme.muted};
    margin-top: 3px;
  }
`
export const LinksList = styled.div`
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 4px;
  padding: 4px;
  a {
    max-width: none;
    margin: 4px 0;
  }
  .linksLoading {
    display: grid;
    place-items: center;
    min-height: 70px;
  }
`
export const ImageViewerLayer = styled.div`
  position: fixed;
  inset: 0;
  z-index: 3000;
  overflow: hidden;
  background: rgba(5, 7, 12, 0.94);
  touch-action: none;
  user-select: none;
  cursor: grab;
  animation: viewerFadeIn 0.2s ease-out both;
  @keyframes viewerFadeIn {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }
  @keyframes viewerImageIn {
    from {
      opacity: 0;
      filter: blur(3px);
    }
    to {
      opacity: 1;
      filter: blur(0);
    }
  }
  &.closing {
    animation: none;
    opacity: 0;
    transition: opacity 0.18s ease-in;
  }
  &.closing .viewerImage {
    opacity: 0;
    transition:
      transform 0.18s ease-in,
      opacity 0.15s ease-in;
  }
  &:active {
    cursor: grabbing;
  }
  .viewerImage {
    position: absolute;
    left: 50%;
    top: 50%;
    max-width: 92vw;
    max-height: 92dvh;
    object-fit: contain;
    transform-origin: center;
    will-change: transform;
    pointer-events: none;
    transition: transform 0.12s cubic-bezier(0.2, 0.75, 0.25, 1);
    animation: viewerImageIn 0.24s ease-out both;
    @media (pointer: coarse) {
      transition: none;
    }
  }
  .viewerHint {
    position: absolute;
    left: 50%;
    bottom: 18px;
    transform: translateX(-50%);
    padding: 7px 11px;
    border-radius: 20px;
    background: rgba(0, 0, 0, 0.55);
    color: #d9dce5;
    font-size: 11px;
    pointer-events: none;
    white-space: nowrap;
    animation: viewerFadeIn 0.3s 0.08s ease-out both;
  }
  .viewerCounter {
    position: absolute;
    left: 50%;
    top: 18px;
    transform: translateX(-50%);
    padding: 6px 11px;
    border-radius: 18px;
    background: rgba(0, 0, 0, 0.55);
    color: white;
    font-size: 12px;
    font-weight: 700;
    pointer-events: none;
  }
  .viewerNav {
    position: absolute;
    top: 50%;
    width: 44px;
    height: 44px;
    display: grid;
    place-items: center;
    transform: translateY(-50%);
    border: 0;
    border-radius: 50%;
    background: rgba(0, 0, 0, 0.55);
    color: white;
    font-size: 18px;
    cursor: pointer;
    transition:
      background 0.16s ease,
      opacity 0.16s ease;
  }
  .viewerPrevious {
    left: 18px;
  }
  .viewerNext {
    right: 18px;
  }
  .viewerNav:hover:not(:disabled) {
    background: rgba(35, 35, 42, 0.85);
  }
  .viewerNav:disabled {
    opacity: 0.25;
    cursor: default;
  }
  .viewerClose {
    position: absolute;
    right: 18px;
    top: 18px;
    width: 40px;
    height: 40px;
    border: 0;
    border-radius: 50%;
    background: rgba(0, 0, 0, 0.55);
    color: white;
    display: grid;
    place-items: center;
    font-size: 17px;
    cursor: pointer;
    transition:
      background 0.16s ease,
      transform 0.16s ease;
  }
  .viewerClose:hover {
    background: rgba(35, 35, 42, 0.85);
    transform: scale(1.06);
  }
  @media (max-width: 600px) {
    .viewerNav {
      width: 40px;
      height: 40px;
    }
    .viewerPrevious {
      left: 10px;
    }
    .viewerNext {
      right: 10px;
    }
    .viewerHint {
      max-width: calc(100vw - 24px);
      overflow: hidden;
      text-overflow: ellipsis;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    animation: none;
    transition: none;
    .viewerImage,
    .viewerHint {
      animation: none;
      transition: none;
    }
  }
`
export const VideoViewerLayer = styled.div`
  position: fixed;
  inset: 0;
  z-index: 3000;
  display: grid;
  place-items: center;
  background: rgba(5, 7, 12, 0.94);
  animation: foxchatVideoViewerFadeIn 0.2s ease-out both;
  @keyframes foxchatVideoViewerFadeIn {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }
  &.closing {
    animation: none;
    opacity: 0;
    transition: opacity 0.18s ease-in;
  }
  .viewerVideo {
    max-width: 92vw;
    max-height: 92dvh;
  }
  .viewerClose {
    position: absolute;
    right: 18px;
    top: 18px;
    width: 40px;
    height: 40px;
    border: 0;
    border-radius: 50%;
    background: rgba(0, 0, 0, 0.55);
    color: white;
    display: grid;
    place-items: center;
    font-size: 17px;
    cursor: pointer;
    transition:
      background 0.16s ease,
      transform 0.16s ease;
  }
  .viewerClose:hover {
    background: rgba(35, 35, 42, 0.85);
    transform: scale(1.06);
  }
  @media (prefers-reduced-motion: reduce) {
    animation: none;
    transition: none;
  }
`
export const VideoExpandButton = styled.button`
  position: absolute;
  right: 8px;
  top: 8px;
  width: 30px;
  height: 30px;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.5);
  color: white;
  cursor: pointer;
  font-size: 14px;
  transition: background 0.16s ease;
  &:hover {
    background: rgba(0, 0, 0, 0.7);
  }
`
export const ViewerContextMenu = styled.div`
  position: fixed;
  z-index: 3100;
  width: 170px;
  padding: 5px;
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 10px;
  background: #181b22;
  color: #f2f3f7;
  box-shadow: 0 14px 45px rgba(0, 0, 0, 0.55);
  cursor: default;
  button {
    display: block;
    width: 100%;
    border: 0;
    border-radius: 7px;
    padding: 8px 10px;
    background: transparent;
    color: inherit;
    text-align: left;
    cursor: pointer;
  }
  button:hover {
    background: rgba(255, 255, 255, 0.1);
  }
`
export const ComposerArea = styled.div`
  position: relative;
  z-index: 2;
  flex: none;
  max-height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding: 11px clamp(14px, 4vw, 50px) 6px;
  background: ${(p) => p.theme.chat};
  @media (max-width: 760px) {
    padding-bottom: max(6px, env(safe-area-inset-bottom, 0px));
  }
`
export const NoSendNotice = styled.div`
  width: 100%;
  max-width: 900px;
  margin: auto;
  padding: 12px 16px;
  border: 1px solid ${(p) => p.theme.border};
  background: ${(p) => p.theme.panel};
  border-radius: 16px;
  text-align: center;
  color: ${(p) => p.theme.muted};
  font-size: 13px;
`
export const TombstoneBanner = styled.div`
  width: 100%;
  max-width: 900px;
  margin: 0 auto 8px;
  padding: 10px 16px;
  border: 1px solid color-mix(in srgb, #ffb020 45%, ${(p) => p.theme.border});
  background: color-mix(in srgb, #ffb020 14%, ${(p) => p.theme.panel});
  border-radius: 14px;
  text-align: center;
  color: ${(p) => p.theme.text};
  font-size: 13px;
  flex: none;
  a {
    color: ${(p) => p.theme.accent};
    font-weight: 650;
    cursor: pointer;
  }
`
export const ComposeTray = styled.div`width:100%;max-width:900px;margin:0 auto 8px;display:flex;gap:8px;flex-wrap:wrap;flex:0 1 auto;min-height:0;max-height:min(280px,40vh);overflow-y:auto;overscroll-behavior:contain;.item{display:flex;align-items:center;gap:9px;max-width:100%;min-width:0;padding:7px 9px;background:${(p) => p.theme.panel};border:1px solid ${(p) => p.theme.border};border-radius:11px;box-shadow:0 3px 12px ${(p) => p.theme.shadow};font-size:12px}.item:has(.imagePreview){width:100%;min-width:0;display:grid;grid-template-columns:minmax(0,1fr) auto}.imagePreview{grid-column:1/-1;width:100%;max-width:100%;height:min(20vh,20rem);min-width:0;overflow:hidden;display:flex;align-items:center;justify-content:center}.imagePreview img{display:block;width:100%;height:100%;min-width:0;max-width:100%;max-height:100%;object-fit:contain;object-position:center;border-radius:7px}.replyText{min-width:0;max-width:430px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:${(p) => p.theme.muted}.replyText b{color:${(p) => p.theme.text}}.remove{flex:none;border:0;background:transparent;color:${(p) => p.theme.muted};cursor:pointer;padding:4px}`
export const Composer = styled.div`
  position: relative;
  z-index: 1;
  isolation: isolate;
  flex: none;
  width: 100%;
  max-width: 900px;
  margin: auto;
  border: 1px solid ${(p) => p.theme.border};
  background: ${(p) => p.theme.panel} !important;
  border-radius: 16px;
  display: flex;
  align-items: center;
  padding: 7px;
  gap: 2px;
  box-shadow: 0 8px 30px ${(p) => p.theme.shadow};
  textarea {
    min-width: 0;
    border: 0 !important;
    box-shadow: none !important;
    background: transparent !important;
    color: ${(p) => p.theme.text}!important;
    resize: none !important;
    padding: 8px !important;
  }
  textarea::placeholder {
    display: block;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: ${(p) => p.theme.muted}!important;
    opacity: 1;
  }
`
export const SendingAsButton = styled.button`
  width: 100%;
  max-width: 900px;
  margin: 3px auto 0;
  padding: 1px 10px;
  border: 0;
  background: transparent;
  color: ${(p) => p.theme.muted};
  font-size: 10px;
  font-weight: 650;
  line-height: 16px;
  text-align: left;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  cursor: pointer;
  &:disabled {
    cursor: default;
  }
  &:not(:disabled):hover {
    color: ${(p) => p.theme.accent};
  }
`
export const RichComposerInput = styled.div`
  min-width: 0;
  max-height: 104px;
  flex: 1;
  overflow-y: auto;
  padding: 8px;
  color: ${(p) => p.theme.text};
  font-size: 14px;
  line-height: 22px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  outline: 0;
  &:empty:before {
    content: attr(data-placeholder);
    color: ${(p) => p.theme.muted};
    pointer-events: none;
  }
  .composerEmote {
    display: inline-flex;
    width: 1.25em;
    height: 1.25em;
    align-items: center;
    justify-content: center;
    vertical-align: -0.25em;
    margin: 0 0.08em;
  }
  .composerEmote img {
    display: block;
    width: 100%;
    height: 100%;
    max-width: 1.25em;
    max-height: 1.25em;
    object-fit: contain;
    pointer-events: none;
  }
`
export const MentionMenu = styled.div`
  position: absolute;
  left: 46px;
  right: 46px;
  bottom: calc(100% + 8px);
  z-index: 20;
  max-height: 260px;
  overflow: auto;
  padding: 6px;
  background: ${(p) => p.theme.panel};
  border: 1px solid ${(p) => p.theme.border};
  border-radius: 12px;
  box-shadow: 0 12px 35px ${(p) => p.theme.shadow};
  button {
    display: flex;
    width: 100%;
    gap: 10px;
    align-items: center;
    border: 0;
    border-radius: 8px;
    padding: 8px 10px;
    color: ${(p) => p.theme.text};
    background: transparent;
    text-align: left;
    cursor: pointer;
  }
  button:hover,
  button.active {
    background: ${(p) => p.theme.hover};
  }
  .meta {
    min-width: 0;
  }
  .label {
    font-weight: 700;
  }
  .id {
    font-size: 11px;
    color: ${(p) => p.theme.muted};
    overflow: hidden;
    text-overflow: ellipsis;
  }
`

export const FollowingBar = styled.div<{ $detailsWidth: number }>`
  position: fixed;
  z-index: 10;
  left: 370px;
  right: ${(p) => 14 + p.$detailsWidth}px;
  bottom: 0;
  height: 25px;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  padding-right: clamp(20px, 4vw, 57px);
  pointer-events: none;
  color: ${(p) => p.theme.muted};
  font-size: 10px;
  transition: right 0.2s ease;
  .label {
    margin-right: 8px;
    opacity: 0.78;
  }
  .follower {
    display: inline-flex;
    margin-left: -5px;
    pointer-events: auto;
    transition: transform 0.15s ease;
  }
  .follower:hover {
    transform: translateY(-2px);
    z-index: 2;
  }
  .ant-avatar {
    border: 2px solid ${(p) => p.theme.chat};
    box-shadow: 0 1px 4px ${(p) => p.theme.shadow};
  }
  @media (max-width: 1100px) {
    right: 14px;
    left: 330px;
  }
  @media (max-width: 760px) {
    left: 10px;
    right: 10px;
    padding-right: 14px;
  }
`
export const VoiceDock = styled.div`width:100%;min-width:0;padding:11px 12px;border-top:1px solid ${(p) => p.theme.border};background:${(p) => p.theme.panel};color:${(p) => p.theme.text};box-shadow:0 -5px 18px ${(p) => p.theme.shadow};display:flex;align-items:center;gap:8px;.voiceInfo{min-width:0;flex:1}.voiceTitle{font-size:12px;font-weight:800;color:${(p) => p.theme.accent}.voiceRoom{font-size:10.5px;color:${(p) => p.theme.muted};white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.voicePeople{display:none}.speaking .ant-avatar{box-shadow:0 0 0 2px #35c77a}.ant-btn{flex:none;padding-inline:8px}`
export const VoiceVideoGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(280px, 100%), 1fr));
  gap: 10px;
  max-height: 72dvh;
  overflow: auto;
  .videoTile {
    position: relative;
    min-height: 180px;
    overflow: hidden;
    border-radius: 12px;
    background: #090b10;
  }
  .videoTile.screen {
    grid-column: 1/-1;
    min-height: min(62dvh, 560px);
  }
  video {
    display: block;
    width: 100%;
    height: 100%;
    min-height: 180px;
    max-height: 62dvh;
    object-fit: contain;
    background: #090b10;
  }
  .videoLabel {
    position: absolute;
    left: 8px;
    bottom: 8px;
    padding: 4px 7px;
    border-radius: 7px;
    background: rgba(0, 0, 0, 0.68);
    color: white;
    font-size: 10.5px;
    font-weight: 700;
  }
`
export const EmojiGrid = styled.div<{ $stickers?: boolean }>`
  display: grid;
  grid-template-columns: ${(p) => (p.$stickers ? 'repeat(4, 84px)' : 'repeat(6, 54px)')};
  gap: 6px;
  max-height: 360px;
  overflow: auto;
  padding: 4px;
  overscroll-behavior: contain;
  button {
    width: ${(p) => (p.$stickers ? '84px' : '54px')};
    height: ${(p) => (p.$stickers ? '84px' : '54px')};
    padding: ${(p) => (p.$stickers ? '6px' : '5px')};
    border: 0;
    border-radius: 10px;
    background: transparent;
    color: ${(p) => p.theme.text};
    font-size: 30px;
    cursor: pointer;
  }
  button:hover {
    background: ${(p) => p.theme.hover};
  }
  img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: contain;
  }
  @media (max-width: 760px) {
    grid-template-columns: ${(p) =>
      p.$stickers ? 'repeat(3, minmax(72px, 1fr))' : 'repeat(5, minmax(40px, 1fr))'};
    gap: 3px;
    max-height: none;
    overflow: visible;
    overscroll-behavior: auto;
    button {
      width: 100%;
      height: ${(p) => (p.$stickers ? '88px' : '43px')};
      padding: ${(p) => (p.$stickers ? '5px' : '4px')};
      font-size: 25px;
    }
  }
`
export const EmojiPanel = styled.div`
  width: min(410px, calc(100vw - 24px));
  margin: -12px;
  padding: 13px;
  border-radius: 10px;
  background: ${(p) => p.theme.panel};
  color: ${(p) => p.theme.text};
  .ant-tabs-tab,
  .ant-tabs-tab-btn,
  .ant-empty-description {
    color: ${(p) => p.theme.muted}!important;
  }
  .ant-tabs-tab-active .ant-tabs-tab-btn {
    color: ${(p) => p.theme.accent}!important;
  }
  .ant-tabs-nav:before {
    border-color: ${(p) => p.theme.border}!important;
  }
  .ant-empty {
    margin: 28px 8px;
  }
  @media (max-width: 760px) {
    width: min(330px, calc(100vw - 48px));
    max-height: min(350px, calc(var(--foxchat-viewport-height, 100dvh) - 150px));
    margin: 0;
    padding: 8px;
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
    overscroll-behavior: contain;
    .ant-tabs-nav {
      margin-bottom: 5px;
    }
    .ant-tabs-tab {
      padding: 5px 0;
      font-size: 12px;
    }
    .ant-tabs-content-holder {
      min-height: 0;
    }
  }
`
export const PackJumpBar = styled.div`
  display: flex;
  gap: 5px;
  margin: 0 0 8px;
  padding: 3px 2px 7px;
  overflow-x: auto;
  overscroll-behavior-x: contain;
  border-bottom: 1px solid ${(p) => p.theme.border};
  button {
    display: grid;
    place-items: center;
    flex: 0 0 42px;
    width: 42px;
    height: 42px;
    padding: 4px;
    border: 1px solid transparent;
    border-radius: 9px;
    background: transparent;
    color: ${(p) => p.theme.text};
    cursor: pointer;
  }
  button:hover,
  button:focus-visible {
    border-color: ${(p) => p.theme.border};
    background: ${(p) => p.theme.hover};
    outline: none;
  }
  img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: contain;
  }
`
export const PackCollection = styled.div`
  max-height: 390px;
  overflow: auto;
  padding-right: 3px;
  overscroll-behavior: contain;
  .pack {
    padding: 2px 0 12px;
  }
  .pack + .pack {
    border-top: 1px solid ${(p) => p.theme.border};
    padding-top: 10px;
  }
  .packTitle {
    margin: 0 4px 7px;
    color: ${(p) => p.theme.muted};
    font-size: 10px;
    font-weight: 780;
    text-transform: uppercase;
    letter-spacing: 0.55px;
  }
  ${EmojiGrid} {
    max-height: none;
    overflow: visible;
  }
  @media (max-width: 760px) {
    max-height: none;
    overflow: visible;
    overscroll-behavior: auto;
  }
`
export const PackEditorWrap = styled.div`
  color: ${(p) => p.theme.text};
  .packNameInput {
    max-width: 320px;
    margin-bottom: 10px;
  }
  .packActions {
    display: flex;
    gap: 8px;
    align-items: center;
    flex-wrap: wrap;
    margin-bottom: 14px;
  }
  .packList {
    display: flex;
    flex-direction: column;
    gap: 8px;
    max-height: 390px;
    overflow: auto;
  }
  .packItem {
    display: grid;
    grid-template-columns: 48px minmax(0, 1fr) max-content 32px;
    align-items: center;
    gap: 9px;
    padding: 8px;
    border: 1px solid ${(p) => p.theme.border};
    border-radius: 11px;
    background: ${(p) => p.theme.input};
  }
  .packImage {
    width: 48px;
    height: 48px;
    display: grid;
    place-items: center;
    border-radius: 8px;
    background: ${(p) => p.theme.panel};
    overflow: hidden;
  }
  .packImage img {
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
  }
  .ant-input,
  .ant-select-selector {
    background: ${(p) => p.theme.panel}!important;
    color: ${(p) => p.theme.text}!important;
    border-color: ${(p) => p.theme.border}!important;
  }
  .ant-empty-description,
  .hint {
    color: ${(p) => p.theme.muted}!important;
  }
  @media (max-width: 600px) {
    .packItem {
      grid-template-columns: 44px minmax(0, 1fr) 32px;
    }
    .packItem .usage {
      grid-column: 2/4;
    }
  }
`
export const SendBtn = styled(Button)`
  && {
    border: 0;
    background: ${(p) => p.theme.accent};
    color: white;
    border-radius: 11px;
    width: 38px;
    height: 38px;
  }
  &&:hover {
    background: ${(p) => p.theme.accentHover}!important;
    color: white !important;
  }
`
export const Details = styled.aside<{ $drawer?: boolean }>`
  border-left: 1px solid ${(p) => p.theme.border};
  background: ${(p) => p.theme.panel};
  color: ${(p) => p.theme.text};
  display: flex;
  flex-direction: column;
  overflow: auto;
  height: 100%;
  @media (max-width: 1100px) {
    display: ${(p) => (p.$drawer ? 'flex' : 'none')};
  }
`
export const DetailHead = styled.div`
  height: 76px;
  display: flex;
  align-items: center;
  padding: 0 18px;
  border-bottom: 1px solid ${(p) => p.theme.border};
  font-weight: 720;
  font-size: 14px;
  > span {
    flex: 1;
  }
`
export const Hero = styled.div`
  padding: 25px 20px;
  text-align: center;
  border-bottom: 1px solid ${(p) => p.theme.border};
  h3 {
    font-size: 16px;
    margin: 12px 0 5px;
  }
  .desc {
    font-size: 11.5px;
    color: ${(p) => p.theme.muted};
    line-height: 1.5;
  }
  .actions {
    display: flex;
    justify-content: center;
    gap: 14px;
    margin-top: 18px;
  }
  .action {
    font-size: 10px;
    color: ${(p) => p.theme.muted};
  }
`
export const Section = styled.section`
  padding: 17px;
  .head {
    display: flex;
    align-items: center;
    color: ${(p) => p.theme.muted};
    font-size: 10.5px;
    font-weight: 760;
    text-transform: uppercase;
    letter-spacing: 0.7px;
    margin-bottom: 8px;
  }
  .head > span:first-child {
    flex: 1;
  }
  .item {
    display: flex;
    width: 100%;
    min-width: 0;
    align-items: center;
    gap: 9px;
    padding: 8px;
    border-radius: 9px;
    color: ${(p) => p.theme.muted};
    font-size: 12.5px;
  }
  .item .grow {
    flex: 1 1 0;
    width: 0;
    min-width: 0;
    overflow: hidden;
  }
  .participantPrimary {
    position: relative;
    display: block;
    width: 100%;
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
  }
  .participantName,
  .participantMxid {
    display: block;
    width: 100%;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    transition:
      opacity 0.18s ease,
      transform 0.18s ease;
  }
  .participantName {
    font-weight: 700;
    opacity: 1;
    transform: translateY(0);
  }
  .participantMxid {
    position: absolute;
    inset: 0;
    color: ${(p) => p.theme.muted};
    font-size: 10.5px;
    opacity: 0;
    transform: translateY(5px);
  }
  .item:hover .participantName,
  .item:focus-within .participantName {
    opacity: 0;
    transform: translateY(-5px);
  }
  .item:hover .participantMxid,
  .item:focus-within .participantMxid {
    opacity: 1;
    transform: translateY(0);
  }
  .participantStatus {
    display: block;
    max-width: 100%;
    margin-top: 2px;
    color: ${(p) => p.theme.muted};
    font-size: 11px;
    line-height: 1.3;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
`
export const SpaceDirectoryBody = styled.div`
  flex: 1;
  overflow: auto;
  padding: 28px;
  max-width: 920px;
  width: 100%;
  margin: 0 auto;
  .intro {
    margin-bottom: 24px;
  }
  .intro h1 {
    margin: 0 0 9px;
    font-size: 24px;
  }
  .intro p {
    margin: 0;
    color: ${(p) => p.theme.muted};
    line-height: 1.6;
    white-space: pre-wrap;
  }
  .listHead {
    display: flex;
    align-items: center;
    margin: 0 2px 9px;
    color: ${(p) => p.theme.muted};
    font-size: 11px;
    font-weight: 750;
    text-transform: uppercase;
    letter-spacing: 0.65px;
  }
  .listHead span:first-child {
    flex: 1;
  }
  .channels {
    border: 1px solid ${(p) => p.theme.border};
    border-radius: 13px;
    overflow: hidden;
    background: ${(p) => p.theme.panel};
  }
  .channel {
    display: flex;
    align-items: center;
    gap: 13px;
    min-height: 68px;
    padding: 11px 14px;
    color: ${(p) => p.theme.text};
    border-bottom: 1px solid ${(p) => p.theme.border};
    transition: background 0.15s ease;
  }
  .channel:last-child {
    border-bottom: 0;
  }
  .channel:hover {
    background: ${(p) => p.theme.hover};
  }
  .channel .grow {
    flex: 1;
    min-width: 0;
  }
  .channel .topic {
    font-size: 12px;
    color: ${(p) => p.theme.muted};
    margin-top: 4px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .channel .membership {
    width: 84px;
    text-align: right;
  }
  @media (max-width: 600px) {
    padding: 18px 13px;
    .channel {
      padding: 10px;
    }
    .membership {
      width: auto;
    }
  }
`
export const RoomBanner = styled.div`
  height: clamp(130px, 22vw, 230px);
  margin: -28px -28px 25px;
  overflow: hidden;
  background: ${(p) => p.theme.input};
  img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  @media (max-width: 600px) {
    margin: -18px -13px 20px;
    height: 145px;
  }
`
export const MobileMenu = styled(IconBtn)`
  && {
    display: none;
  }
  @media (max-width: 760px) {
    && {
      display: inline-flex;
    }
  }
  [data-mobile-layout='true'] & {
    && {
      display: inline-flex;
    }
  }
`
export const PresenceWrap = styled.span`
  position: relative;
  display: inline-flex;
  flex: none;
`
export const PresenceDot = styled.span<{ $color: string }>`
  position: absolute;
  right: -1px;
  bottom: 0;
  width: 10px;
  height: 10px;
  border: 2px solid ${(p) => p.theme.panel};
  border-radius: 50%;
  background: ${(p) => p.$color};
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.25);
`
export const VoiceAvatarWrap = styled.span`
  position: relative;
  display: inline-flex;
  .voiceMark {
    position: absolute;
    right: -3px;
    bottom: -2px;
    width: 17px;
    height: 17px;
    display: grid;
    place-items: center;
    border: 2px solid ${(p) => p.theme.panel};
    border-radius: 50%;
    background: ${(p) => p.theme.accent};
    color: #fff;
    font-size: 8px;
  }
`
export const UserProfileAnchor = styled.span<{ $block?: boolean }>`
  display: ${(p) => (p.$block ? 'flex' : 'inline-flex')};
  width: ${(p) => (p.$block ? '100%' : 'auto')};
  cursor: pointer;
`
export const UserProfilePanel = styled.div`
  position: fixed;
  z-index: 2100;
  width: min(340px, calc(100vw - 24px));
  max-height: min(600px, calc(100dvh - 24px));
  overflow: auto;
  border: 1px solid ${(p) => p.theme.border};
  border-radius: 18px;
  background: ${(p) => p.theme.panel};
  color: ${(p) => p.theme.text};
  box-shadow: 0 18px 55px rgba(0, 0, 0, 0.32);
  overscroll-behavior: contain;
  .profileBanner {
    position: relative;
    width: 100%;
    aspect-ratio: 3/1;
    min-height: 108px;
    max-height: 138px;
    overflow: hidden;
    background: linear-gradient(135deg, ${(p) => p.theme.accentSoft}, ${(p) => p.theme.input});
  }
  .profileBanner:after {
    content: '';
    position: absolute;
    inset: 45% 0 0;
    background: linear-gradient(transparent, rgba(0, 0, 0, 0.25));
    pointer-events: none;
  }
  .profileBanner img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
    object-position: center;
  }
  .profileBody {
    padding: 16px 18px 19px;
  }
  .profileHead {
    position: relative;
    display: flex;
    align-items: center;
    gap: 13px;
    margin: 0 0 14px;
    padding-right: 40px;
  }
  .profileBanner + .profileBody {
    padding-top: 0;
  }
  .profileBanner + .profileBody .profileHead {
    position: relative;
    margin-top: -27px;
    align-items: flex-end;
  }
  .profileBanner + .profileBody .profileHead .ant-avatar {
    box-shadow: 0 0 0 5px ${(p) => p.theme.panel};
  }
  .profileHead .ant-avatar {
    width: 58px !important;
    height: 58px !important;
    line-height: 58px !important;
    flex: none;
  }
  .profileName {
    position: relative;
    top: 3px;
    font-size: 16px;
    font-weight: 800;
    line-height: 1.25;
    text-shadow: 0 1px 8px ${(p) => p.theme.panel};
  }
  .profilePronouns {
    font-size: 11px;
    color: ${(p) => p.theme.muted};
    margin-top: 4px;
  }
  .profileStatus {
    font-size: 12px;
    line-height: 1.45;
    white-space: pre-wrap;
    margin: -3px 0 12px;
    color: ${(p) => p.theme.muted};
    overflow-wrap: anywhere;
  }
  .profileBio {
    font-size: 12px;
    line-height: 1.55;
    white-space: pre-wrap;
    margin: 9px 0 14px;
    padding: 10px 11px;
    border-radius: 10px;
    background: ${(p) => p.theme.input};
    overflow-wrap: anywhere;
  }
  .mxid,
  .server {
    font-size: 11px;
    color: ${(p) => p.theme.muted};
    word-break: break-all;
  }
  .groupTitle {
    margin: 15px 0 6px;
    font-size: 10px;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.65px;
    color: ${(p) => p.theme.muted};
  }
  .mutual {
    display: flex;
    width: 100%;
    align-items: center;
    text-align: left;
    color: inherit;
    cursor: pointer !important;
    padding: 8px 10px;
    border-radius: 8px;
    background: ${(p) => p.theme.input};
    font-size: 12px;
    margin-top: 5px;
    transition:
      color 0.14s ease,
      background 0.14s ease,
      transform 0.14s ease,
      box-shadow 0.14s ease;
  }
  .mutual:after {
    content: '›';
    margin-left: auto;
    font-size: 17px;
    line-height: 1;
    color: ${(p) => p.theme.muted};
  }
  .mutual:hover {
    color: ${(p) => p.theme.accent};
    background: ${(p) => p.theme.accentSoft};
    transform: translateX(2px);
    box-shadow: inset 3px 0 0 ${(p) => p.theme.accent};
  }
  .mutual:focus-visible {
    outline: 2px solid ${(p) => p.theme.accent};
    outline-offset: 2px;
  }
  .socialLinks {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 6px;
    margin: 8px 0 2px;
  }
  .socialLink {
    display: flex;
    align-items: center;
    gap: 7px;
    min-width: 0;
    padding: 7px 8px;
    border-radius: 9px;
    background: ${(p) => p.theme.input};
    color: ${(p) => p.theme.text};
    font-size: 11px;
    font-weight: 700;
    text-decoration: none;
  }
  .socialLink:hover {
    color: ${(p) => p.theme.accent};
    background: ${(p) => p.theme.accentSoft};
  }
  .socialIcon {
    width: 24px;
    height: 24px;
    flex: none;
    display: grid;
    place-items: center;
    border-radius: 6px;
    background: ${(p) => p.theme.panel};
    overflow: hidden;
    font-size: 12px;
    font-weight: 900;
  }
  .socialIcon img {
    display: block;
    width: 100%;
    height: 100%;
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
    object-position: center;
  }
  .socialIcon svg {
    width: 18px;
    height: 18px;
    display: block;
  }
  .socialLink span:last-child {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
`
export const RoomDetailsProfile = styled(UserProfilePanel)`
  position: static;
  z-index: auto;
  width: 100%;
  max-height: none;
  overflow: visible;
  border: 0;
  border-radius: 0;
  box-shadow: none;
  background: transparent;
  .profileBanner {
    border-radius: 0;
  }
`
export const SocialEditorRow = styled.div`
  padding: 12px;
  margin-bottom: 10px;
  border: 1px solid ${(p) => p.theme.border};
  border-radius: 10px;
  background: ${(p) => p.theme.input};
  color: ${(p) => p.theme.text};
  @media (max-width: 700px) {
    > div:first-child {
      grid-template-columns: 1fr !important;
    }
  }
`
export const AuthPage = styled.div`
  height: 100dvh;
  display: grid;
  grid-template-columns: minmax(360px, 520px) 1fr;
  background: ${(p) => p.theme.bg};
  color: ${(p) => p.theme.text};
  @media (max-width: 800px) {
    grid-template-columns: 1fr;
  }
  .form {
    background: ${(p) => p.theme.panel};
    padding: clamp(28px, 7vw, 80px);
    display: flex;
    flex-direction: column;
    justify-content: center;
  }
  .form h1 {
    font-size: 32px;
    letter-spacing: -1px;
    margin: 25px 0 7px;
  }
  .form p {
    color: ${(p) => p.theme.muted};
    font-size: 13px;
    margin: 0 0 28px;
    line-height: 1.55;
  }
  .visual {
    background: linear-gradient(145deg, #17142b, #40307a);
    display: grid;
    place-items: center;
    color: white;
    padding: 60px;
    text-align: center;
  }
  .visual h2 {
    font-size: 34px;
    max-width: 520px;
  }
  .visual p {
    opacity: 0.7;
    max-width: 500px;
    line-height: 1.6;
  }
  @media (max-width: 800px) {
    .visual {
      display: none;
    }
  }
`
export const EmptyState = styled.div`
  height: 100%;
  display: grid;
  place-items: center;
  color: ${(p) => p.theme.muted};
  text-align: center;
  padding: 30px;
`

export const themes = {
  light: {
    bg: '#f5f6fa',
    panel: '#fff',
    chat: '#f7f8fc',
    text: '#1d2433',
    muted: '#7c8496',
    subtle: '#a5abbb',
    border: '#e8eaf1',
    input: '#f3f4f8',
    hover: '#f3f4f9',
    selected: '#eeebff',
    accent: '#7357e8',
    accentHover: '#6447dc',
    accentSoft: '#eeeaff',
    bubble: '#fff',
    file: '#f5f5fa',
    shadow: 'rgba(40,45,70,.06)',
    dot: '#dfe2eb',
    jsonString: '#0a7d3f',
    jsonNumber: '#b45309',
    jsonBoolean: '#1d4ed8',
  },
  dark: {
    bg: '#11131a',
    panel: '#191c25',
    chat: '#151821',
    text: '#eef0f6',
    muted: '#9299aa',
    subtle: '#686f80',
    border: '#292d39',
    input: '#222631',
    hover: '#232733',
    selected: '#2a2644',
    accent: '#8b72f3',
    accentHover: '#9a84f5',
    accentSoft: '#302b4f',
    bubble: '#20242e',
    file: '#292d38',
    shadow: 'rgba(0,0,0,.18)',
    dot: '#232733',
    jsonString: '#4ade80',
    jsonNumber: '#fbbf24',
    jsonBoolean: '#60a5fa',
  },
}
