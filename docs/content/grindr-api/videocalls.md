# Videocalls

Video call endpoints require [Authorization](/grindr-api/api-authorization).

## Get video call info

```
GET /v3/video-call
```

Response:

`VideoCallInfoResponse`:

- `remainingSeconds` — integer

## Create video call

```
POST /v1/video-call
```

Body (`CreateVideoCallRequest`):

- `targetProfileId` — long integer

Response (`CreateVideoCallResponse`):

- `result` / `videoCallResult` — `VideoCallResult`
- `maxSeconds` — long integer
- `channelId` — string or `null`
- `remainingSeconds` — long integer or `null`
- `refreshSeconds` — integer
- `channel` — string or `null`
- `token` — string or `null`
- `message` — string or `null`

## Renew video call

```
PATCH /v1/video-call
```

Response (`RenewVideoCallResponse`):

- `result` — `VideoCallResult`
- `token` — string
- `remainingSeconds` — long integer
- `refreshSeconds` — integer
- `message` — string or `null`

## Join video call

```
PATCH /v1/video-call/join
```

Body (`JoinVideoCallRequest`):

- `channelId` — string

Response (`JoinVideoCallResponse`):

- `result` — `VideoCallResult`
- `channel` — string
- `channelId` — string
- `token` — string
- `refreshSeconds` — integer
- `message` — string or `null`

## Leave video call

```
PATCH /v1/video-call/leave
```

Body (`LeaveVideoCallRequestChatV3`):

- `channelId` — string

Response:

Empty.
