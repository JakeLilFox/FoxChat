# FoxChat Local Automation API v1

FoxChat can expose a local WebSocket API for stream decks, overlays, bots, and
other trusted desktop automation. Enable it under **Settings → Automation API**.

The desktop app hosts the API directly. The web app uses the separately
installed FoxChat Bridge. In both cases the server is disabled by default,
binds only to `127.0.0.1`, and never listens on a LAN interface. Every
connection must authenticate before it can subscribe or make requests.

## Browser bridge installation

Download the CI-built executable for your platform, then install it for the
current user:

```text
# Windows
FoxChatBridge-windows-x86_64.exe --install

# Linux
chmod +x FoxChatBridge-linux-x86_64
./FoxChatBridge-linux-x86_64 --install
```

Installation does not require administrator/root access. On Windows it uses
the current user's Run registry key. On Linux it installs an XDG autostart
entry. The bridge then starts at login.

The newest authenticated FoxChat browser tab is the only active Matrix
provider. When a newer tab connects, the bridge closes the older provider and
all consumer connections. Consumers should reconnect and authenticate again.

The FoxChat website is HTTPS, but the loopback WebSocket intentionally remains
`ws://`: Chrome-family and Firefox browsers allow loopback WebSockets from a
secure page without a locally trusted TLS certificate. Current Chromium
versions may ask the user to allow local-network access. Keep the address as
`127.0.0.1`; do not change it to a LAN/private IP.

## Connection and authentication

Connect to:

```text
ws://127.0.0.1:29331/v1
```

The port is configurable. The first frame, sent within five seconds, must be:

```json
{"type":"authenticate","api_key":"YOUR_API_KEY"}
```

Success:

```json
{"type":"authenticated","protocol":"foxchat.automation.v1"}
```

Failed authentication closes the socket. Rotate the key in settings if it is
ever exposed; existing connections are disconnected when the server restarts.
Because this is an unencrypted loopback connection, do not proxy it or bind it
to another interface.

## Requests

Requests use caller-generated string IDs:

```json
{
  "type": "request",
  "id": "request-1",
  "method": "message.send",
  "params": {
    "room_id": "!room:example.org",
    "body": "Hello from my automation"
  }
}
```

Success:

```json
{"type":"response","id":"request-1","ok":true,"result":{"room_id":"!room:example.org","event_id":"$event"}}
```

Failure:

```json
{"type":"response","id":"request-1","ok":false,"error":{"code":"not_found","message":"Room is not available"}}
```

Common error codes are `invalid_request`, `invalid_params`, `not_found`,
`not_ready`, `call_unavailable`, `method_not_found`, and `internal_error`.

### Available methods

| Method | Parameters | Result/purpose |
| --- | --- | --- |
| `system.ping` | none | Protocol health and version |
| `rooms.list` | none | Joined/known rooms, sorted the same way as the room list in the app |
| `room.get` | `room_id` | One room’s status |
| `room.read` | `room_id` | Mark the latest known event as read |
| `room.timeline` | `room_id`; optional `limit`, `before_event_id`, `after_event_id` | A page of a room’s message timeline, for scrolling through history |
| `messages.recent` | optional `since_ts`, `room_id`, `limit` | The last N messages across all rooms (or one room), including your own; with `since_ts`, only what's new since that cursor. Includes basic info for each contributing room |
| `message.send` | `room_id`, `body` | Send a plain Matrix text message |
| `user.get` | `user_id`, optional `room_id` | Display name, avatar, banner, presence, and room membership |
| `user.avatar.get` | `user_id`, optional `room_id` | Matrix and downloadable HTTP avatar URLs |
| `user.banner.get` | `user_id`, optional `room_id` | The user’s `chat.commet.profile_banner`, when published |
| `call.current` | none | Whether FoxChat is currently in a call and, when active, its `room_id` and local input/share state |
| `call.status` | `room_id` | Whether a MatrixRTC call is active and local input/share state |
| `call.open` | `room_id` | Open/join the room’s call in FoxChat |
| `call.leave` | `room_id` | Leave the currently open call |
| `call.users` | `room_id` | Participants, speaking state, and local playback settings |
| `call.input.get` | `room_id` | Local microphone, camera, and screen-share state |
| `call.input.set` | `room_id`; optional `microphone_muted`, `camera_enabled`, `screen_sharing` | Change local call inputs |
| `call.screenshare.view` | `room_id`, `user_id` | Focus/join a user’s active screen-share view |
| `call.screenshare.leave` | `room_id`, `user_id` | Stop viewing that screen share |
| `call.user_audio.set` | `user_id`, optional `source`, `volume`, `muted` | Set local playback. `source` is `microphone` or `screen_share_audio`; volume is 0–200. `muted` applies to screen-share audio. |

Call input and screen-share viewing commands require that the corresponding
call is currently open in FoxChat. They return `call_unavailable` otherwise.
Volume changes are local playback preferences and do not mute another user for
other participants.

### Listing rooms

`rooms.list` returns every joined room, sorted exactly like the room list in
FoxChat itself: pinned rooms first (in the order you pinned them), then
everything else by most recent activity.

```json
{"type":"request","id":"list-1","method":"rooms.list","params":{}}
```

```json
{
  "type": "response",
  "id": "list-1",
  "ok": true,
  "result": [
    {
      "room_id": "!room:example.org",
      "name": "Alice",
      "membership": "join",
      "unread_count": 2,
      "avatar_url": "mxc://example.org/abc123",
      "pinned": true,
      "last_activity_ts": 1784894400000,
      "last_message": "See you tomorrow!"
    }
  ]
}
```

`room.get` returns the same shape for a single `room_id`. `name` is the
display name as FoxChat shows it — a direct message shows the other person’s
name, a room with a local nickname shows that nickname, and everything else
falls back to the room’s Matrix name — not necessarily the raw
`m.room.name` state event. `pinned` reflects the `m.favourite` room tag.
`last_message` is a short, human-readable preview of the newest message
(media/polls/etc. are summarized, e.g. `Image`), matching what the room list
subtitle shows.

### Room timeline

`room.timeline` returns a page of a room’s message timeline, letting a
consumer scroll through history the same way the app does.

With no `before_event_id`/`after_event_id`, it returns the most recent
messages (newest last, i.e. oldest-to-newest reading order):

```json
{"type":"request","id":"tl-1","method":"room.timeline","params":{"room_id":"!room:example.org","limit":30}}
```

```json
{
  "type": "response",
  "id": "tl-1",
  "ok": true,
  "result": {
    "room_id": "!room:example.org",
    "messages": [
      {
        "room_id": "!room:example.org",
        "room_name": "Alice",
        "event_id": "$event1",
        "sender": "@alice:example.org",
        "sender_display_name": "Alice",
        "timestamp": 1784894400000,
        "body": "Hey, are we still on for tomorrow?",
        "msgtype": "m.text"
      }
    ],
    "start_reached": false
  }
}
```

To scroll **up** for older messages, pass `before_event_id` set to the
`event_id` of the oldest message you already have — the response returns the
`limit` messages immediately before it, plus `start_reached: true` once
there’s nothing older left in the room:

```json
{"type":"request","id":"tl-2","method":"room.timeline","params":{"room_id":"!room:example.org","before_event_id":"$event1","limit":30}}
```

To scroll **down** toward the present from a point in the past, pass
`after_event_id` instead — the response returns up to `limit` messages after
it, plus `end_reached: true` once you’ve caught back up to the live timeline:

```json
{"type":"request","id":"tl-3","method":"room.timeline","params":{"room_id":"!room:example.org","after_event_id":"$event1","limit":30}}
```

`limit` defaults to 30 and is capped at 100. Only visible message events are
included — no state events, redactions, or the original copy of an edited
message (edits are applied in place, so `body` already reflects the latest
edit). Fetching backward history that FoxChat hasn’t loaded yet triggers the
same pagination the app uses when you scroll up, so the first call for a
quiet room may take a moment; an `before_event_id`/`after_event_id` that
can’t be found anywhere in the room’s history (including after exhausting
backward pagination) returns `not_found`.

#### Stickers and images

Sticker and `m.image` messages carry a `media` object with the file already
downloaded and decrypted — no separate request, and no need to handle
`m.room.encrypted` file keys yourself:

```json
{
  "room_id": "!room:example.org",
  "room_name": "Alice",
  "event_id": "$event2",
  "sender": "@alice:example.org",
  "sender_display_name": "Alice",
  "timestamp": 1784894400000,
  "body": "cat.png",
  "msgtype": "m.image",
  "media": {
    "mimetype": "image/png",
    "size": 48213,
    "base64": "iVBORw0KGgoAAAANSUhEUgAAA..."
  }
}
```

`base64` is omitted (leaving just `mimetype`/`size`) when the file is larger
than 5 MB or could not be downloaded — check for its presence before trying
to decode. Other attachment types (video, audio, files) are not inlined; they
still appear with their `msgtype` and a `body` naming the file.

### New messages across rooms

`messages.recent` answers two related questions: “give me the last N
messages, no matter which room they’re in” (call it with no cursor), and
“what’s new since I last checked” (call it with `since_ts`, as a polling
alternative to subscribing to `message.received`). Either way it spans every
joined room at once (or one room, with `room_id`), and — unlike
`room.timeline`’s exclusion of edits and redactions — **includes messages
you sent yourself**, exactly like the push events do.

With no cursor, it returns the most recent messages overall:

```json
{"type":"request","id":"recent-1","method":"messages.recent","params":{"limit":50}}
```

```json
{
  "type": "response",
  "id": "recent-1",
  "ok": true,
  "result": {
    "messages": [
      {
        "room_id": "!room:example.org",
        "room_name": "Alice",
        "event_id": "$event1",
        "sender": "@alice:example.org",
        "sender_display_name": "Alice",
        "timestamp": 1784894400000,
        "body": "Hey, are we still on for tomorrow?",
        "msgtype": "m.text"
      },
      {
        "room_id": "!other:example.org",
        "room_name": "Project chat",
        "event_id": "$event2",
        "sender": "@you:example.org",
        "sender_display_name": "You",
        "timestamp": 1784894460000,
        "body": "Yep, pushed the fix",
        "msgtype": "m.text"
      }
    ],
    "since_ts": 1784894460000,
    "rooms": [
      {
        "room_id": "!room:example.org",
        "name": "Alice",
        "membership": "join",
        "unread_count": 0,
        "avatar_url": "mxc://example.org/abc123",
        "pinned": false,
        "last_activity_ts": 1784894400000,
        "last_message": "Hey, are we still on for tomorrow?"
      },
      {
        "room_id": "!other:example.org",
        "name": "Project chat",
        "membership": "join",
        "unread_count": 3,
        "avatar_url": null,
        "pinned": true,
        "last_activity_ts": 1784894460000,
        "last_message": "Yep, pushed the fix"
      }
    ]
  }
}
```

`rooms` is the same shape `rooms.list`/`room.get` return, so you get names,
avatars, pin state, etc. for every room a returned message came from without
a second request — but only for rooms actually represented in `messages`,
not every joined room.

Every subsequent call passes back the `since_ts` the previous response gave
you:

```json
{"type":"request","id":"recent-2","method":"messages.recent","params":{"since_ts":1784894460000,"limit":50}}
```

`messages` and `rooms` are both empty and `since_ts` is unchanged when
there’s nothing new yet — keep polling with the same value. `limit` defaults
to 50 and is capped at 200; if more than `limit` messages arrived since your
last `since_ts`, you get the **oldest** ones first (so a backlog drains in
order across repeated polls, rather than skipping ahead and missing what’s in
between). Stickers and images include the same inline `media` object
described above. This only looks at what FoxChat already has loaded in
memory — it never triggers backward pagination, so it’s cheap to poll
frequently, but a room
FoxChat hasn’t synced any history for yet won’t contribute older messages
this way (use `room.timeline` for that).

### Current call

Query the call FoxChat itself is currently participating in:

```json
{"type":"request","id":"current-call","method":"call.current","params":{}}
```

When FoxChat is not in a call:

```json
{"type":"response","id":"current-call","ok":true,"result":{"active":false,"room_id":null}}
```

When FoxChat is in a call:

```json
{
  "type": "response",
  "id": "current-call",
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
}
```

## Event subscriptions

Subscriptions can use exact event names, `*`, or a trailing wildcard such as
`call.*`. IDs are chosen by the caller.

```json
{
  "type": "subscribe",
  "id": "room-call-events",
  "events": ["call.*", "message.received"],
  "filters": {
    "room_id": "!room:example.org"
  }
}
```

Acknowledgement:

```json
{"type":"subscribed","id":"room-call-events"}
```

Remove it with:

```json
{"type":"unsubscribe","id":"room-call-events"}
```

Filters are equality checks. Currently useful filter keys are `room_id` and
`user_id`. A matching field can be at the event data root or inside its `room`
or `user` object.

Delivered event:

```json
{
  "type": "event",
  "subscription_id": "room-call-events",
  "event": "call.user_joined",
  "timestamp": 1784894400000,
  "data": {
    "room_id": "!room:example.org",
    "user_id": "@alice:example.org"
  }
}
```

### Available events

| Event | Important data |
| --- | --- |
| `call.started` | `room_id` |
| `call.ended` | `room_id` |
| `call.user_joined` | `room_id`, `user_id` |
| `call.user_left` | `room_id`, `user_id` |
| `call.input_changed` | `room_id`, `input` |
| `call.screenshare_started` | `room_id`, `user_id` |
| `call.screenshare_ended` | `room_id`, `user_id` |
| `call.screenshare_joined` | `room_id`, `user_id` (FoxChat began viewing it) |
| `call.screenshare_left` | `room_id`, `user_id` |
| `message.received` | room, sender, event ID, timestamp, and message body/type |
| `notification.received` | Same message shape, only when Matrix push rules notify |

Message events may include messages sent by the current user. Consumers that
only want incoming messages should filter the `sender` against their own
Matrix user ID. Stickers are included as `message.msgtype: "m.sticker"`.
Stickers and `m.image` messages include a `message.media` object shaped
exactly like `room.timeline`’s (see [Stickers and images](#stickers-and-images)
above) — already decrypted, base64-encoded, and omitting `base64` past 5 MB.

## Minimal JavaScript client

```js
const socket = new WebSocket("ws://127.0.0.1:29331/v1");

socket.addEventListener("open", () => {
  socket.send(JSON.stringify({
    type: "authenticate",
    api_key: process.env.FOXCHAT_API_KEY,
  }));
});

socket.addEventListener("message", ({ data }) => {
  const frame = JSON.parse(data);
  console.log(frame);

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
});
```

## Design guarantees and limits

- Protocol version 1 uses JSON text frames only.
- Authentication is required before all operations.
- The server does not expose Matrix access tokens or encryption keys.
- Matrix permissions still apply to API actions.
- Multiple automation consumers and subscriptions are supported. With the web
  bridge, only the latest FoxChat Matrix provider remains connected.
- Delivery is best-effort while FoxChat is running; this is not a durable event
  queue. Reconnect and query current status after a disconnect.
- Slow or disconnected clients are dropped without blocking FoxChat.
