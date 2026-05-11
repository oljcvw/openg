# Rewarded chats

Rewarded chat endpoints require [Authorization](/grindr-api/api-authorization).

## Get rewarded chat quota

```
GET /{version}/rewarded-chats
```

Path:

- `version` — API version string, e.g. `v1`

Response:

`ExploreFreeChatsResponse`:

- `remainingChats` — integer

## Consume rewarded chat

```
POST /{version}/rewarded-chats
```

Path:

- `version` — API version string, e.g. `v1`

Response:

Empty.
