# Blocks

Blocking a user automatically deletes the conversation for both of you.

## Get blocked users

Requires [Authorization](/grindr-api/api-authorization).

```
GET /v3.1/me/blocks
```

Response: `GetBlocksResponse`

- `blockedBy` — array of profile ID strings for users who blocked the current user
- `blocking` — array of `BlockedProfile`
  - `profileId` — string with numeric profile ID
  - `order` — integer or `null`

## Block a user

Requires [Authorization](/grindr-api/api-authorization).

Repeated requests are completed without errors.

```
POST /v3/me/blocks/{profileId}
```

Path:

- `profileId` — string with numeric profile ID

Response: Empty raw body.

## Unblock a user

Requires [Authorization](/grindr-api/api-authorization).

Repeated requests are completed without errors.

```
DELETE /v3/me/blocks/{targetProfileId}
```

Path:

- `targetProfileId` — string with numeric profile ID

Response: Empty raw body.

## Unblock all users

Requires [Authorization](/grindr-api/api-authorization).

Repeated requests are completed without errors.

```
DELETE /v3/me/blocks
```

Response: Empty raw body.
