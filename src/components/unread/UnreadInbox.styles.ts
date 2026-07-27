import { styled } from 'styled-components'

export const Header = styled.header`
  height: 76px;
  flex: none;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 20px;
  border-bottom: 1px solid ${(p) => p.theme.border};
  background: ${(p) => p.theme.panel};

  h1 {
    margin: 0;
    font-size: 19px;
  }

  .subtitle {
    color: ${(p) => p.theme.muted};
    font-size: 12px;
  }
`

export const Feed = styled.div`
  flex: 1;
  min-height: 0;
  overflow: auto;
  overscroll-behavior: contain;
  padding: 18px clamp(12px, 4vw, 42px) 40px;
`

export const Group = styled.section`
  width: min(860px, 100%);
  margin: 0 auto 24px;

  > h2 {
    margin: 0 0 10px;
    color: ${(p) => p.theme.muted};
    font-size: 13px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
`

export const RoomBlock = styled.section`
  overflow: hidden;
  margin-bottom: 12px;
  border: 1px solid ${(p) => p.theme.border};
  border-radius: 14px;
  background: ${(p) => p.theme.panel};

  .roomHead {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 11px 14px;
    border-bottom: 1px solid ${(p) => p.theme.border};
    font-weight: 750;
  }

  .message {
    width: 100%;
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: start;
    gap: 10px;
    padding: 11px 14px;
    border: 0;
    border-bottom: 1px solid ${(p) => p.theme.border};
    background: transparent;
    color: ${(p) => p.theme.text};
    text-align: left;
    cursor: pointer;
  }

  .message:last-child {
    border-bottom: 0;
  }

  .message:hover {
    background: ${(p) => p.theme.hover};
  }

  .sender {
    display: block;
    font-size: 12px;
    font-weight: 750;
  }

  .body {
    display: block;
    margin-top: 3px;
    color: ${(p) => p.theme.muted};
    overflow-wrap: anywhere;
  }

  time {
    color: ${(p) => p.theme.muted};
    font-size: 11px;
    white-space: nowrap;
  }
`
