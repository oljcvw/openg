# Events

Events are formatted as a compact JSON object that has a `type` string property and other top-level properties defined below, different for each event type.

## `ws.connection.established`

Connection established. Sent by server automatically as soon as the WebSocket is opened.

- `timestamp` — unix timestamp in milliseconds

## `ws.error`

Response to a command, generic error.

- `message` — e.g. `"Could not convert frame to command"`

## Command response events

Command responses use the `[command].response` event type and include the fields documented in [commands](/grindr-api/websocket/commands#websocket-command-response). Decompiled handlers include:

- `chat.v1.message.send.response`
- `wingman.v1.message.send.response`

## Notification events

Server push notifications are documented in [Notification Event](/grindr-api/websocket/notification-event). Decompiled handlers include chat, tap, and viewed-me notification types.
