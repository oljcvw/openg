# Notifications

Notification endpoints use normal API authentication unless noted otherwise.

## Acknowledge notification

Requires [Authorization](/grindr-api/api-authorization).

```
POST /public/v1/notifications/ack
```

Body (`NotificationAckBody`):

- `notificationId` — string
- `source` — string, e.g. `"WEBSOCKET"` or `"PUSH"`

Response:

Empty.

## Register FCM push token

Requires [Authorization](/grindr-api/api-authorization) and real device info headers in the Android client.

```
POST /v3/gcm-push-tokens
```

Body (`FcmPushRequest`):

- `vendorProvidedIdentifier` — string
- `token` — string, FCM token

Response:

Empty.

## Mute conversation push notifications

Requires [Authorization](/grindr-api/api-authorization).

```
POST /v1/push/conversation/{conversationId}/mute
```

Path:

- `conversationId` — [Conversation ID](/grindr-api/messaging/conversations#conversation-id)

Response:

Empty.

## Unmute conversation push notifications

Requires [Authorization](/grindr-api/api-authorization).

```
POST /v1/push/conversation/{conversationId}/unmute
```

Path:

- `conversationId` — [Conversation ID](/grindr-api/messaging/conversations#conversation-id)

Response:

Empty.
