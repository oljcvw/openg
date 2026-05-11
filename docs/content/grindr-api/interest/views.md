# Views

## ViewSourceEnum

- `DISCOVER`
- `FOR_YOU`
- `UNKNOWN` (fallback)

Views endpoints require [Authorization](/grindr-api/api-authorization).

## Get views number

```
GET /v6/views/eyeball
```

Response: `V5Views`

- `viewedCount` — number or `null`
- `mostRecent` — object or `null`
  - `profileId` — string with number
  - `photoHash` — 40 characters hex string
  - `timestamp` — unix timestamp in milliseconds

## Get viewers list

```
GET /v7/views/list
```

Response: `ViewedMeListResponseDto`

- `totalViewers` — integer
- `previews` — array of objects
  - *everything from [ProfileMasked](/grindr-api/users/profiles#profilemasked)*
  - `isInBadNeighborhood` — boolean
  - `isViewedMeFreshFace` — boolean
  - `isSecretAdmirer` — boolean
  - `viewedCount` — object
    - `totalCount` — integer
    - `maxDisplayCount` — integer
- `profiles` — array of objects
  - *everything from `previews`*
  - *everything from [ProfileShort](/grindr-api/users/profiles#profileshort)*
  - `hasFaceRecognition` — boolean
  - `isIncognito` — boolean
  - `boosting` — boolean
  - `showUnlockReward` — boolean
  - `unreadMessageCount` — integer
  - `hasChatted` — boolean

## Record profile view

```
POST /v5/views/{profileId}
```

Path:

- `profileId` — string with numeric profile ID

Body: `ProfileViewsRequestV2`

- `foundVia` — string or `null`
- `source` — [ViewSourceEnum](#viewsourceenum)

Response: Empty.

No Retrofit annotation for the older `POST /v4/views` or `POST /v4/views/{profileId}` endpoints was found in this decompile.
