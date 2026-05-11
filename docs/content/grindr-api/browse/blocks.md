# Blocks

Blocking a user automatically deletes the conversation for both of you.

Blocks endpoints require [Authorization](/grindr-api/api-authorization).

## Get blocked users

```
GET /v3.1/me/blocks
```

Response: `GetBlocksResponse`

- `blockedBy` — array of strings
- `blocking` — array of `BlockedProfile`
  - `profileId` — string with numeric profile ID
  - `order` — integer or `null`

## Block a user

Repeated requests are completed without errors.

```
POST /v3/me/blocks/{profileId}
```

Path:

- `profileId` — string with numeric profile ID

Response: Raw `ResponseBody`.

## Unblock a user

Repeated requests are completed without errors.

```
DELETE /v3/me/blocks/{targetProfileId}
```

Path:

- `targetProfileId` — string with numeric profile ID

Response: Raw `ResponseBody`.

## Unblock all users

Repeated requests are completed without errors.

```
DELETE /v3/me/blocks
```

Response: Raw `ResponseBody`.
