import { Button, Collapse, Modal, Tabs } from 'antd'
import { CodeOutlined } from '@ant-design/icons'
import { Room } from 'matrix-js-sdk'

export function RoomDevToolsModal({ room, onClose }: { room: Room; onClose: () => void }) {
  const state = [...room.currentState.events.values()]
    .flatMap((events) => [...events.values()])
    .sort(
      (a, b) =>
        a.getType().localeCompare(b.getType()) ||
        (a.getStateKey() ?? '').localeCompare(b.getStateKey() ?? ''),
    )
  const stateJson = JSON.stringify(
    state.map((event) => event.toJSON()),
    null,
    2,
  )
  const summary = {
    room_id: room.roomId,
    name: room.name,
    canonical_alias: room.getCanonicalAlias(),
    room_type: room.getType() ?? null,
    membership: room.getMyMembership(),
    encrypted: room.hasEncryptionStateEvent(),
    joined_members: room.getJoinedMemberCount(),
    state_events: state.length,
  }
  const codeStyle: React.CSSProperties = {
    maxHeight: '60vh',
    overflow: 'auto',
    padding: 14,
    borderRadius: 8,
    background: '#11131a',
    color: '#e8eaf2',
    fontSize: 12,
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
  }
  return (
    <Modal
      title={`Developer tools · ${room.name}`}
      open
      footer={null}
      width={900}
      onCancel={onClose}
      destroyOnHidden
    >
      <Tabs
        items={[
          {
            key: 'summary',
            label: 'Summary',
            children: <pre style={codeStyle}>{JSON.stringify(summary, null, 2)}</pre>,
          },
          {
            key: 'state',
            label: `State events (${state.length})`,
            children: (
              <>
                <Button
                  size="small"
                  icon={<CodeOutlined />}
                  onClick={() => void navigator.clipboard.writeText(stateJson)}
                  style={{ marginBottom: 10 }}
                >
                  Copy JSON
                </Button>
                <Collapse
                  size="small"
                  items={state.map((event, index) => ({
                    key: event.getId() ?? `${event.getType()}-${event.getStateKey() ?? index}`,
                    label: (
                      <span>
                        <code>{event.getType()}</code> · state key{' '}
                        <code>{event.getStateKey() || '∅'}</code>
                      </span>
                    ),
                    children: (
                      <pre style={codeStyle}>{JSON.stringify(event.toJSON(), null, 2)}</pre>
                    ),
                  }))}
                />
              </>
            ),
          },
        ]}
      />
    </Modal>
  )
}
