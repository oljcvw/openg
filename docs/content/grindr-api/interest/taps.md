# Taps

## Tap ID

- `0` — "FRIENDLY" ("hi" or 🍪 based on client rendering settings)
- `1` — "HOT" (🔥)
- `2` — "LOOKING" (😈)
- `3` — "NONE"

Cookie taps are essentially bubbles "hi" but your client can choose to render them as 🍪. There is no separate cookie tap type.

Taps endpoints require [Authorization](/grindr-api/api-authorization).

## Get received taps

```
GET /v2/taps/received
```

Response: `RetrieveTapsResponse`

- `profiles` — array of `TapsInbox`
  - `profileId` — long integer
  - `displayName` — string
  - `profileImageMediaHash` — string or `null`
  - `distance` — number or `null`
  - `onlineUntil` — long integer or `null`
  - `lastOnline` — long integer or `null`
  - `timestamp` — unix timestamp in milliseconds
  - `tapType` — [Tap ID](#tap-id)
  - `isFavorite` — boolean
  - `isViewable` — boolean
  - `hasChatted` — boolean
  - `unreadMessageCount` — integer

## Send a tap

Repeated requests result in `Invalid request` error and HTTP status 400.

```
POST /v2/taps/add
```

Body: `SendTapRequest`

- `recipientId` — long integer, [profile id](/grindr-api/users/profiles#profile)
- `tapType` — [Tap ID](#tap-id)

Response: Empty.

## Get sent taps

```
GET /v1/interactions/taps/sent
```

Response: array of `TapsSentDto`

- `senderId` — long integer
- `receiverId` — long integer
- `tapType` — [Tap ID](#tap-id)
- `sentOn` — unix timestamp in milliseconds
- `deleted` — boolean
- `readOn` — timestamp value or `null`
