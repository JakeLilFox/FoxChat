import { useState } from 'react'

type Method = {
  name: string
  parameters: string
  result: string
}

type ApiEvent = {
  name: string
  data: string
}

type MethodExample = {
  params: Record<string, unknown>
  result: unknown
}

const methods: Method[] = [
  {
    name: 'system.ping',
    parameters: 'None',
    result: 'Returns protocol health and version information.',
  },
  {
    name: 'rooms.list',
    parameters: 'None',
    result: 'Returns joined and known rooms with names, membership, unread counts, and avatars.',
  },
  {
    name: 'room.get',
    parameters: 'room_id',
    result: 'Returns the current status of one room.',
  },
  {
    name: 'room.read',
    parameters: 'room_id',
    result: 'Marks the latest known event in the room as read.',
  },
  {
    name: 'message.send',
    parameters: 'room_id, body',
    result: 'Sends a plain Matrix text message.',
  },
  {
    name: 'user.get',
    parameters: 'user_id, optional room_id',
    result: 'Returns display name, avatar, banner, presence, and room membership.',
  },
  {
    name: 'user.avatar.get',
    parameters: 'user_id, optional room_id',
    result: 'Returns Matrix and downloadable HTTP avatar URLs.',
  },
  {
    name: 'user.banner.get',
    parameters: 'user_id, optional room_id',
    result: 'Returns chat.commet.profile_banner when the user published one.',
  },
  {
    name: 'call.current',
    parameters: 'None',
    result: 'Reports whether FoxChat is in a call and returns its room and local input state.',
  },
  {
    name: 'call.status',
    parameters: 'room_id',
    result: 'Returns call activity and local input and share state.',
  },
  {
    name: 'call.open',
    parameters: 'room_id',
    result: 'Opens or joins the room call in FoxChat.',
  },
  {
    name: 'call.leave',
    parameters: 'room_id',
    result: 'Leaves the currently open call.',
  },
  {
    name: 'call.users',
    parameters: 'room_id',
    result: 'Returns participants, speaking state, and local playback settings.',
  },
  {
    name: 'call.input.get',
    parameters: 'room_id',
    result: 'Returns local microphone, camera, and screen share state.',
  },
  {
    name: 'call.input.set',
    parameters: 'room_id, optional microphone_muted, camera_enabled, screen_sharing',
    result: 'Changes local call inputs.',
  },
  {
    name: 'call.screenshare.view',
    parameters: 'room_id, user_id',
    result: 'Focuses the active screen share from one user.',
  },
  {
    name: 'call.screenshare.leave',
    parameters: 'room_id, user_id',
    result: 'Stops viewing the specified screen share.',
  },
  {
    name: 'call.user_audio.set',
    parameters: 'user_id, optional source, volume, muted',
    result:
      'Changes local playback. Source accepts microphone or screen_share_audio. Volume accepts 0 through 200. Muted applies to screen share audio.',
  },
]

const events: ApiEvent[] = [
  { name: 'call.started', data: 'room_id' },
  { name: 'call.ended', data: 'room_id' },
  { name: 'call.user_joined', data: 'room_id, user_id' },
  { name: 'call.user_left', data: 'room_id, user_id' },
  { name: 'call.input_changed', data: 'room_id, input' },
  { name: 'call.screenshare_started', data: 'room_id, user_id' },
  { name: 'call.screenshare_ended', data: 'room_id, user_id' },
  {
    name: 'call.screenshare_joined',
    data: 'room_id, user_id. FoxChat began viewing the share.',
  },
  { name: 'call.screenshare_left', data: 'room_id, user_id' },
  {
    name: 'message.received',
    data: 'Room, sender, event ID, timestamp, body, and message type.',
  },
  {
    name: 'notification.received',
    data: 'The message event shape when Matrix push rules request a notification.',
  },
]

const inputState = {
  microphone_muted: false,
  camera_enabled: true,
  screen_sharing: false,
}

const methodExamples: Record<string, MethodExample> = {
  'system.ping': {
    params: {},
    result: { pong: true, version: 1 },
  },
  'rooms.list': {
    params: {},
    result: [
      {
        room_id: '!room:example.org',
        name: 'Project room',
        membership: 'join',
        unread_count: 3,
        avatar_url: 'mxc://example.org/roomAvatar',
      },
    ],
  },
  'room.get': {
    params: { room_id: '!room:example.org' },
    result: {
      room_id: '!room:example.org',
      name: 'Project room',
      membership: 'join',
      unread_count: 3,
      avatar_url: 'mxc://example.org/roomAvatar',
    },
  },
  'room.read': {
    params: { room_id: '!room:example.org' },
    result: {
      room_id: '!room:example.org',
      event_id: '$latestEvent',
      read: true,
    },
  },
  'message.send': {
    params: {
      room_id: '!room:example.org',
      body: 'Hello from my automation',
    },
    result: {
      room_id: '!room:example.org',
      event_id: '$sentEvent',
    },
  },
  'user.get': {
    params: {
      user_id: '@alice:example.org',
      room_id: '!room:example.org',
    },
    result: {
      user_id: '@alice:example.org',
      display_name: 'Alice',
      avatar_url: 'mxc://example.org/aliceAvatar',
      avatar_http_url:
        'https://example.org/_matrix/client/v1/media/download/example.org/aliceAvatar',
      banner_url: 'mxc://example.org/aliceBanner',
      presence: 'online',
      status_message: 'Available',
      membership: 'join',
    },
  },
  'user.avatar.get': {
    params: {
      user_id: '@alice:example.org',
      room_id: '!room:example.org',
    },
    result: {
      user_id: '@alice:example.org',
      avatar_url: 'mxc://example.org/aliceAvatar',
      avatar_http_url:
        'https://example.org/_matrix/client/v1/media/download/example.org/aliceAvatar',
    },
  },
  'user.banner.get': {
    params: { user_id: '@alice:example.org' },
    result: {
      user_id: '@alice:example.org',
      banner_url: 'mxc://example.org/aliceBanner',
    },
  },
  'call.current': {
    params: {},
    result: {
      active: true,
      room_id: '!room:example.org',
      input: inputState,
      screenshares: ['@alice:example.org'],
      viewed_screenshares: ['@alice:example.org'],
    },
  },
  'call.status': {
    params: { room_id: '!room:example.org' },
    result: {
      room_id: '!room:example.org',
      active: true,
      local: {
        room_id: '!room:example.org',
        active: true,
        input: inputState,
        screenshares: ['@alice:example.org'],
        viewed_screenshares: ['@alice:example.org'],
        users: ['@me:example.org', '@alice:example.org'],
      },
    },
  },
  'call.open': {
    params: { room_id: '!room:example.org' },
    result: {
      room_id: '!room:example.org',
      opening: true,
    },
  },
  'call.leave': {
    params: { room_id: '!room:example.org' },
    result: {
      room_id: '!room:example.org',
      active: false,
    },
  },
  'call.users': {
    params: { room_id: '!room:example.org' },
    result: [
      {
        user_id: '@alice:example.org',
        display_name: 'Alice',
        speaking: true,
        microphone_volume: 100,
        screenshare_volume: 80,
        screenshare_muted: false,
      },
    ],
  },
  'call.input.get': {
    params: { room_id: '!room:example.org' },
    result: {
      room_id: '!room:example.org',
      ...inputState,
    },
  },
  'call.input.set': {
    params: {
      room_id: '!room:example.org',
      microphone_muted: true,
      camera_enabled: false,
      screen_sharing: false,
    },
    result: {
      room_id: '!room:example.org',
      accepted: true,
    },
  },
  'call.screenshare.view': {
    params: {
      room_id: '!room:example.org',
      user_id: '@alice:example.org',
    },
    result: {
      room_id: '!room:example.org',
      user_id: '@alice:example.org',
      viewing: true,
    },
  },
  'call.screenshare.leave': {
    params: {
      room_id: '!room:example.org',
      user_id: '@alice:example.org',
    },
    result: {
      room_id: '!room:example.org',
      user_id: '@alice:example.org',
      viewing: false,
    },
  },
  'call.user_audio.set': {
    params: {
      user_id: '@alice:example.org',
      source: 'screen_share_audio',
      volume: 80,
      muted: false,
    },
    result: {
      user_id: '@alice:example.org',
      source: 'screen_share_audio',
      volume: 80,
      muted: false,
    },
  },
}

const messageEventData = {
  room_id: '!room:example.org',
  room_name: 'Project room',
  event_id: '$messageEvent',
  sender: '@alice:example.org',
  sender_display_name: 'Alice',
  timestamp: 1784894400000,
  message: {
    msgtype: 'm.text',
    body: 'Hello from Alice',
  },
}

const eventExamples: Record<string, Record<string, unknown>> = {
  'call.started': { room_id: '!room:example.org' },
  'call.ended': { room_id: '!room:example.org' },
  'call.user_joined': {
    room_id: '!room:example.org',
    user_id: '@alice:example.org',
  },
  'call.user_left': {
    room_id: '!room:example.org',
    user_id: '@alice:example.org',
  },
  'call.input_changed': {
    room_id: '!room:example.org',
    input: {
      microphone_muted: true,
      camera_enabled: false,
      screen_sharing: false,
    },
  },
  'call.screenshare_started': {
    room_id: '!room:example.org',
    user_id: '@alice:example.org',
  },
  'call.screenshare_ended': {
    room_id: '!room:example.org',
    user_id: '@alice:example.org',
  },
  'call.screenshare_joined': {
    room_id: '!room:example.org',
    user_id: '@alice:example.org',
  },
  'call.screenshare_left': {
    room_id: '!room:example.org',
    user_id: '@alice:example.org',
  },
  'message.received': messageEventData,
  'notification.received': messageEventData,
}

const sections = [
  ['overview', 'Overview'],
  ['installation', 'Bridge installation'],
  ['authentication', 'Authentication'],
  ['requests', 'Requests'],
  ['methods', 'Methods'],
  ['current_call', 'Current call'],
  ['subscriptions', 'Subscriptions'],
  ['events', 'Events'],
  ['custom_specs', 'Matrix extensions'],
  ['client', 'JavaScript client'],
  ['limits', 'Guarantees and limits'],
] as const

function CodeBlock({ label, children }: { label: string; children: string }) {
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    await navigator.clipboard.writeText(children)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1400)
  }

  return (
    <div className="codeBlock">
      <div className="codeHeader">
        <span>{label}</span>
        <button type="button" onClick={() => void copy()}>
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre>
        <code>{children}</code>
      </pre>
    </div>
  )
}

function ReferenceTable({ columns, rows }: { columns: string[]; rows: string[][] }) {
  return (
    <div className="tableScroll">
      <table>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column}>{column}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row[0]}>
              {row.map((cell, index) => (
                <td key={`${row[0]}:${columns[index]}`}>
                  {index === 0 ? <code>{cell}</code> : cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

const formatted = (value: unknown) => JSON.stringify(value, null, 2)

function MethodExamples() {
  return (
    <div className="exampleList">
      {methods.map((method, index) => {
        const example = methodExamples[method.name]
        const id = `method_${index + 1}`
        return (
          <details className="referenceExample" key={method.name}>
            <summary>
              <code>{method.name}</code>
              <span>{method.parameters}</span>
            </summary>
            <div className="exampleBody">
              <CodeBlock label="Request frame">
                {formatted({
                  type: 'request',
                  id,
                  method: method.name,
                  params: example.params,
                })}
              </CodeBlock>
              <CodeBlock label="Response frame">
                {formatted({
                  type: 'response',
                  id,
                  ok: true,
                  result: example.result,
                })}
              </CodeBlock>
            </div>
          </details>
        )
      })}
    </div>
  )
}

function EventExamples() {
  return (
    <div className="exampleList">
      {events.map((event) => (
        <details className="referenceExample" key={event.name}>
          <summary>
            <code>{event.name}</code>
            <span>{event.data}</span>
          </summary>
          <div className="exampleBody">
            <CodeBlock label="Delivered event frame">
              {formatted({
                type: 'event',
                subscription_id: 'room_events',
                event: event.name,
                timestamp: 1784894400000,
                data: eventExamples[event.name],
              })}
            </CodeBlock>
          </div>
        </details>
      ))}
    </div>
  )
}

export default function ApiSpecs() {
  return (
    <div className="docsPage">
      <header className="topbar">
        <a className="brand" href="/">
          <img src="/favicon.png" alt="" />
          <span>FoxChat</span>
        </a>
        <div className="topbarTitle">Developer reference</div>
        <a className="homeLink" href="/">
          FoxChat home
        </a>
      </header>

      <div className="docsShell">
        <aside className="sectionIndex">
          <div className="indexLabel">Local Automation API</div>
          <nav aria-label="API reference sections">
            {sections.map(([id, label]) => (
              <a key={id} href={`#${id}`}>
                {label}
              </a>
            ))}
          </nav>
          <div className="versionCard">
            <span>Protocol</span>
            <strong>foxchat.automation.v1</strong>
          </div>
        </aside>

        <main className="reference">
          <section className="intro" id="overview">
            <div className="eyebrow">Protocol version 1</div>
            <h1>Local Automation API</h1>
            <p className="lede">
              Control FoxChat from stream decks, overlays, bots, and other trusted applications on
              the same computer.
            </p>
            <dl className="facts">
              <div>
                <dt>Transport</dt>
                <dd>WebSocket</dd>
              </div>
              <div>
                <dt>Address</dt>
                <dd>
                  <code>ws://127.0.0.1:29331/v1</code>
                </dd>
              </div>
              <div>
                <dt>Frames</dt>
                <dd>JSON text</dd>
              </div>
              <div>
                <dt>Authentication</dt>
                <dd>API key</dd>
              </div>
            </dl>
            <p>
              Enable the server in <strong>Settings, Automation API</strong>. The desktop app hosts
              it directly. The web app connects through FoxChat Bridge. The server is disabled by
              default and listens only on <code>127.0.0.1</code>.
            </p>
          </section>

          <section id="installation">
            <h2>Bridge installation</h2>
            <p>
              Browser users need FoxChat Bridge. Download the executable for the current platform
              from the FoxChat homepage, then install it for the current user.
            </p>
            <CodeBlock label="Windows">{'FoxChatBridge-windows-x86_64.exe --install'}</CodeBlock>
            <CodeBlock label="Linux">
              {'chmod +x FoxChatBridge-linux-x86_64\n./FoxChatBridge-linux-x86_64 --install'}
            </CodeBlock>
            <p>
              Installation does not require administrator or root access. Windows uses the current
              user Run registry key. Linux uses an XDG autostart entry.
            </p>
            <p>
              The newest authenticated FoxChat browser tab becomes the Matrix provider. When a newer
              tab connects, the bridge closes the older provider and its consumer connections.
              Consumers must reconnect and authenticate again.
            </p>
            <div className="notice">
              Keep the bridge on <code>127.0.0.1</code>. Browsers permit a secure FoxChat page to
              open a loopback WebSocket without a local TLS certificate. Do not expose this
              connection on a LAN address.
            </div>
          </section>

          <section id="authentication">
            <h2>Connection and authentication</h2>
            <ol className="steps">
              <li>Open the WebSocket connection.</li>
              <li>Send the authentication frame within five seconds.</li>
              <li>Wait for the authenticated response before any request.</li>
            </ol>
            <CodeBlock label="Connection address">{'ws://127.0.0.1:29331/v1'}</CodeBlock>
            <CodeBlock label="First frame">
              {'{"type":"authenticate","api_key":"YOUR_API_KEY"}'}
            </CodeBlock>
            <CodeBlock label="Accepted">
              {'{"type":"authenticated","protocol":"foxchat.automation.v1"}'}
            </CodeBlock>
            <p>
              Failed authentication closes the socket. Rotating the key in settings disconnects
              existing connections when the server restarts.
            </p>
          </section>

          <section id="requests">
            <h2>Request and response frames</h2>
            <p>
              Every request needs a string ID chosen by the caller. FoxChat returns the same ID in
              its response.
            </p>
            <CodeBlock label="Request">
              {`{
  "type": "request",
  "id": "request_1",
  "method": "message.send",
  "params": {
    "room_id": "!room:example.org",
    "body": "Hello from my automation"
  }
}`}
            </CodeBlock>
            <CodeBlock label="Success">
              {
                '{"type":"response","id":"request_1","ok":true,"result":{"room_id":"!room:example.org","event_id":"$event"}}'
              }
            </CodeBlock>
            <CodeBlock label="Failure">
              {
                '{"type":"response","id":"request_1","ok":false,"error":{"code":"not_found","message":"Room is not available"}}'
              }
            </CodeBlock>
            <h3>Error codes</h3>
            <div className="tokenGrid">
              {[
                'invalid_request',
                'invalid_params',
                'not_found',
                'not_ready',
                'call_unavailable',
                'method_not_found',
                'internal_error',
              ].map((code) => (
                <code key={code}>{code}</code>
              ))}
            </div>
          </section>

          <section id="methods">
            <h2>Methods</h2>
            <ReferenceTable
              columns={['Method', 'Parameters', 'Result']}
              rows={methods.map((method) => [method.name, method.parameters, method.result])}
            />
            <p className="tableNote">
              Call input and screen share viewing require the corresponding call to be open in
              FoxChat. Otherwise the response contains <code>call_unavailable</code>. Volume and
              mute settings affect only local playback.
            </p>
            <h3>Request and response examples</h3>
            <p>Open a method to see a complete request frame and its successful response.</p>
            <MethodExamples />
          </section>

          <section id="current_call">
            <h2>Current call</h2>
            <p>
              Use <code>call.current</code> when the room ID is not known.
            </p>
            <CodeBlock label="Request">
              {'{"type":"request","id":"current_call","method":"call.current","params":{}}'}
            </CodeBlock>
            <CodeBlock label="No active call">
              {
                '{"type":"response","id":"current_call","ok":true,"result":{"active":false,"room_id":null}}'
              }
            </CodeBlock>
            <CodeBlock label="Active call">
              {`{
  "type": "response",
  "id": "current_call",
  "ok": true,
  "result": {
    "active": true,
    "room_id": "!room:example.org",
    "input": {
      "microphone_muted": false,
      "camera_enabled": false,
      "screen_sharing": false
    },
    "screenshares": [],
    "viewed_screenshares": []
  }
}`}
            </CodeBlock>
          </section>

          <section id="subscriptions">
            <h2>Event subscriptions</h2>
            <p>
              Event selectors accept an exact name, <code>*</code>, or a trailing wildcard such as{' '}
              <code>call.*</code>. Subscription IDs are chosen by the caller.
            </p>
            <CodeBlock label="Subscribe">
              {`{
  "type": "subscribe",
  "id": "room_call_events",
  "events": ["call.*", "message.received"],
  "filters": {
    "room_id": "!room:example.org"
  }
}`}
            </CodeBlock>
            <CodeBlock label="Acknowledgement">
              {'{"type":"subscribed","id":"room_call_events"}'}
            </CodeBlock>
            <CodeBlock label="Unsubscribe">
              {'{"type":"unsubscribe","id":"room_call_events"}'}
            </CodeBlock>
            <p>
              Filters use equality checks. Supported filter keys are <code>room_id</code> and{' '}
              <code>user_id</code>. A matching field can appear at the data root or inside its room
              or user object.
            </p>
            <CodeBlock label="Delivered event">
              {`{
  "type": "event",
  "subscription_id": "room_call_events",
  "event": "call.user_joined",
  "timestamp": 1784894400000,
  "data": {
    "room_id": "!room:example.org",
    "user_id": "@alice:example.org"
  }
}`}
            </CodeBlock>
          </section>

          <section id="events">
            <h2>Events</h2>
            <ReferenceTable
              columns={['Event', 'Data']}
              rows={events.map((event) => [event.name, event.data])}
            />
            <p className="tableNote">
              Message events can include messages sent by the current user. Compare the sender with
              the Matrix user ID when only incoming messages are wanted.
            </p>
            <h3>Delivered event examples</h3>
            <p>
              Each example includes the subscription envelope and the complete event data object.
            </p>
            <EventExamples />
          </section>

          <section id="custom_specs">
            <div className="eyebrow">FoxChat owned formats</div>
            <h2>Matrix extensions</h2>
            <p>
              FoxChat stores these fields through normal Matrix events, account data, and profile
              APIs. Unknown fields can be ignored by clients that do not implement them.
            </p>

            <article className="specCard">
              <div className="specHeading">
                <div>
                  <code>page.codeberg.everypizza.msc4193.spoiler</code>
                  <h3>Spoiler images</h3>
                </div>
                <dl className="specMeta">
                  <div>
                    <dt>Scope</dt>
                    <dd>Message content</dd>
                  </div>
                  <div>
                    <dt>Value</dt>
                    <dd>Boolean</dd>
                  </div>
                </dl>
              </div>
              <p>
                Set <code>page.codeberg.everypizza.msc4193.spoiler</code> to <code>true</code> on an{' '}
                <code>m.image</code> message. FoxChat obscures the image until the reader chooses to
                reveal it.
              </p>
              <CodeBlock label="m.room.message content">
                {`{
  "msgtype": "m.image",
  "body": "spoiler.png",
  "url": "mxc://example.org/image",
  "info": {
    "mimetype": "image/png",
    "size": 184320
  },
  "page.codeberg.everypizza.msc4193.spoiler": true
}`}
              </CodeBlock>
              <p className="specNote">
                FoxChat does not send an alternate spoiler representation. Clients that do not
                understand the field display a normal image.
              </p>
            </article>

            <article className="specCard">
              <div className="specHeading">
                <div>
                  <code>foxchat.gallery</code>
                  <h3>Image galleries</h3>
                </div>
                <dl className="specMeta">
                  <div>
                    <dt>Scope</dt>
                    <dd>Message content</dd>
                  </div>
                  <div>
                    <dt>Value</dt>
                    <dd>UUID string</dd>
                  </div>
                </dl>
              </div>
              <p>
                Every gallery image is sent as its own standard <code>m.room.message</code> event
                with <code>msgtype: "m.image"</code>. Images from the same sender that carry the
                same <code>foxchat.gallery</code> UUID are displayed together by FoxChat.
              </p>
              <CodeBlock label="Two separate m.room.message content objects">
                {`[
  {
    "msgtype": "m.image",
    "body": "first.jpg",
    "url": "mxc://example.org/first",
    "info": {
      "mimetype": "image/jpeg",
      "size": 241320
    },
    "foxchat.gallery": "8e44f189-f714-4eab-a01a-a753f6ef7c9c"
  },
  {
    "msgtype": "m.image",
    "body": "second.jpg",
    "url": "mxc://example.org/second",
    "info": {
      "mimetype": "image/jpeg",
      "size": 198402
    },
    "foxchat.gallery": "8e44f189-f714-4eab-a01a-a753f6ef7c9c"
  }
]`}
              </CodeBlock>
              <ReferenceTable
                columns={['Rule', 'Behavior']}
                rows={[
                  ['Event model', 'One normal Matrix image event is sent for every image.'],
                  ['Maximum size', 'A gallery UUID groups at most five image events.'],
                  [
                    'Overflow',
                    'Additional images receive a new UUID in consecutive batches of five.',
                  ],
                  [
                    'Single image',
                    'A standalone image has no gallery field; an overflow batch of one keeps its new UUID.',
                  ],
                  [
                    'Viewer navigation',
                    'Arrows and horizontal swipes move within the gallery while the image is at 1× zoom.',
                  ],
                  [
                    'Zoomed image',
                    'Horizontal gestures pan the enlarged image instead of changing images.',
                  ],
                ]}
              />
              <p className="specNote">
                Clients that do not understand <code>foxchat.gallery</code> ignore the field and
                display each event as an ordinary image message.
              </p>
            </article>

            <article className="specCard">
              <div className="specHeading">
                <div>
                  <code>chat.foxchat.appearance</code>
                  <h3>Chat background</h3>
                </div>
                <dl className="specMeta">
                  <div>
                    <dt>Scope</dt>
                    <dd>Account data</dd>
                  </div>
                  <div>
                    <dt>State key</dt>
                    <dd>None</dd>
                  </div>
                </dl>
              </div>
              <p>
                The account data event stores a Matrix media URI for the image shown behind message
                timelines. The setting follows the Matrix account between FoxChat installations.
              </p>
              <CodeBlock label="Account data content">
                {`{
  "chat_background": {
    "url": "mxc://example.org/background",
    "name": "mountains.jpg",
    "info": {
      "mimetype": "image/jpeg",
      "size": 428310
    }
  }
}`}
              </CodeBlock>
              <p className="specNote">Removing the background stores an empty content object.</p>
            </article>

            <article className="specCard">
              <div className="specHeading">
                <div>
                  <code>foxchat.pronouns</code>
                  <br />
                  <code>foxchat.social_links</code>
                  <h3>Public profile fields</h3>
                </div>
                <dl className="specMeta">
                  <div>
                    <dt>Scope</dt>
                    <dd>Matrix profile</dd>
                  </div>
                  <div>
                    <dt>Visibility</dt>
                    <dd>Public</dd>
                  </div>
                </dl>
              </div>
              <p>
                Pronouns are stored as a trimmed string. Social links are an ordered array. Every
                link needs a title and an HTTP or HTTPS address. The optional image can contain an
                MXC or web URI.
              </p>
              <CodeBlock label="Profile response fields">
                {`{
  "foxchat.pronouns": "they/them",
  "foxchat.social_links": [
    {
      "title": "Website",
      "link": "https://alice.example",
      "img": "mxc://example.org/siteIcon"
    },
    {
      "title": "Bluesky",
      "link": "https://bsky.app/profile/alice.example"
    }
  ]
}`}
              </CodeBlock>
              <ReferenceTable
                columns={['Field', 'Type', 'Rules']}
                rows={[
                  ['foxchat.pronouns', 'string', 'Empty string means no published pronouns.'],
                  [
                    'foxchat.social_links',
                    'array',
                    'Items use title, link, and optional img fields.',
                  ],
                ]}
              />
            </article>

            <article className="specCard">
              <div className="specHeading">
                <div>
                  <code>chat.foxchat.space_role_sync</code>
                  <h3>Space role synchronization state</h3>
                </div>
                <dl className="specMeta">
                  <div>
                    <dt>Scope</dt>
                    <dd>Room state</dd>
                  </div>
                  <div>
                    <dt>State key</dt>
                    <dd>Empty</dd>
                  </div>
                </dl>
              </div>
              <p>
                FoxChat records the Space permission values most recently propagated to child rooms.
                This lets a later sync calculate which permissions changed without replacing
                unrelated child room settings.
              </p>
              <CodeBlock label="State event content">
                {`{
  "permissions": {
    "events_default": 0,
    "state_default": 50,
    "invite": 50,
    "kick": 50,
    "ban": 50,
    "redact": 50
  }
}`}
              </CodeBlock>
              <p className="specNote">
                This event is synchronization metadata. The applicable{' '}
                <code>m.room.power_levels</code> event remains authoritative.
              </p>
            </article>

            <h3>External formats supported by FoxChat</h3>
            <p>
              These identifiers come from other clients or Matrix proposals. FoxChat supports them
              for compatibility.
            </p>
            <ReferenceTable
              columns={['Identifier', 'Owner or source', 'FoxChat use']}
              rows={[
                ['chat.commet.profile_bio', 'Commet', 'Reads and writes profile biography text.'],
                [
                  'chat.commet.profile_banner',
                  'Commet',
                  'Reads and writes a profile banner MXC URI.',
                ],
                [
                  'in.cinny.room.power_level_tags',
                  'Cinny',
                  'Reads and writes named room and Space roles.',
                ],
                [
                  'im.ponies.room_emotes',
                  'Image pack ecosystem',
                  'Reads and writes room emoji and sticker packs.',
                ],
                [
                  'im.ponies.user_emotes',
                  'Image pack ecosystem',
                  'Reads and writes personal emoji and sticker packs.',
                ],
                [
                  'org.matrix.msc3417.call',
                  'Matrix MSC3417',
                  'Creates and recognizes voice channel rooms.',
                ],
                [
                  'org.matrix.msc3245.voice',
                  'Matrix MSC3245',
                  'Marks audio messages as voice messages.',
                ],
                [
                  'org.matrix.msc1767.audio',
                  'Matrix MSC1767',
                  'Stores voice duration and waveform data.',
                ],
              ]}
            />
          </section>

          <section id="client">
            <h2>Minimal JavaScript client</h2>
            <CodeBlock label="JavaScript">
              {`const socket = new WebSocket("ws://127.0.0.1:29331/v1");

socket.addEventListener("open", () => {
  socket.send(JSON.stringify({
    type: "authenticate",
    api_key: process.env.FOXCHAT_API_KEY,
  }));
});

socket.addEventListener("message", ({ data }) => {
  const frame = JSON.parse(data);

  if (frame.type === "authenticated") {
    socket.send(JSON.stringify({
      type: "subscribe",
      id: "calls",
      events: ["call.*"],
      filters: {},
    }));

    socket.send(JSON.stringify({
      type: "request",
      id: crypto.randomUUID(),
      method: "call.status",
      params: { room_id: "!room:example.org" },
    }));
  }
});`}
            </CodeBlock>
          </section>

          <section id="limits">
            <h2>Guarantees and limits</h2>
            <dl className="guarantees">
              <div>
                <dt>Authentication</dt>
                <dd>Every operation requires a valid API key.</dd>
              </div>
              <div>
                <dt>Private data</dt>
                <dd>Matrix access tokens and encryption keys are never exposed.</dd>
              </div>
              <div>
                <dt>Permissions</dt>
                <dd>Matrix permissions still apply to every API action.</dd>
              </div>
              <div>
                <dt>Consumers</dt>
                <dd>
                  Multiple automation consumers and subscriptions are supported. The web bridge
                  accepts one FoxChat Matrix provider at a time.
                </dd>
              </div>
              <div>
                <dt>Delivery</dt>
                <dd>
                  Events are delivered while FoxChat is running. They are not stored in a durable
                  queue. Query current state after reconnecting.
                </dd>
              </div>
              <div>
                <dt>Flow control</dt>
                <dd>Slow or disconnected clients are removed without blocking FoxChat.</dd>
              </div>
            </dl>
          </section>

          <footer className="docsFooter">
            <span>FoxChat Local Automation API</span>
            <a href="/">Return to FoxChat</a>
          </footer>
        </main>
      </div>
    </div>
  )
}
