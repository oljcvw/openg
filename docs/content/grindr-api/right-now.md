# Right Now

Right Now endpoints require [Authorization](/grindr-api/api-authorization).

## RightNowStatus

- `NOT_ACTIVE`
- `HOSTING`
- `NOT_HOSTING`

## RightNowSortOption

- `DISTANCE`
- `NEWEST`

## ShareLocation

- `DISTANCE_AND_MAP`
- `DISTANCE_ONLY`
- `NONE`

## RightNowRequestStatus

- `PENDING`
- `ACCEPTED`
- `REJECTED`

## Get consent agreement

```
GET /v4/legal-agreements/right-now
```

Response: `RightNowConsentAgreementResponse`.

## Get active post

```
GET /v3/rightnow/active-post
```

Response: `RightNowGetActivePostResponse`

- `post` — `RightNowActiveUserPostResponse`

## Get profile post

```
GET /v3/rightnow/profiles/{profileId}
```

Path:

- `profileId` — long integer

Response: `RightNowGetOtherUserPostResponse`

- `post` — `RightNowOtherUserPostResponse`

## Get feed

```
GET /{version}/rightnow/feed
```

Path:

- `version` — string, e.g. `v5`

Query:

- `sort` — [RightNowSortOption](#rightnowsortoption)
- `hosting` — boolean, optional
- `ageMin` — integer, optional
- `ageMax` — integer, optional
- `sexualPositions` — string, optional

Response: `RightNowGetFeedResponse`

- `items` — array of `RightNowDynamicPost`
- `viewerCount` — integer or `null`

## Create post

```
POST /v4/rightnow/posts
POST /v3/rightnow/posts
```

Body: `CreatePostRequest`

- `text` — string
- `shareLocation` — [ShareLocation](#sharelocation)
- `lat` — number or `null`
- `lon` — number or `null`
- `locationRadius` — integer or `null`
- `media` — array of `RightNowCreatePostMedia`
- `hosting` — boolean

Response: `RightNowCreatePostResponse`

- `post` — `RightNowActiveUserPostResponse`

## Update post

```
PATCH /{version}/rightnow/posts/{postId}
```

Path:

- `version` — string
- `postId` — long integer

Body: `UpdatePostRequest`

- `text` — string or `null`
- `hosting` — boolean or `null`
- `hidden` — boolean or `null`
- `media` — array of `RightNowCreatePostMedia` or `null`
- `shareLocation` — [ShareLocation](#sharelocation) or `null`
- `locationRadius` — integer or `null`
- `isDiscreet` — boolean or `null`
- `sharedFields` — array of `Age` | `Height` | `Weight` | `Position`

Response: Empty.

## Update post settings

```
PATCH /v1/rightnow/posts/{postId}/settings
```

Path:

- `postId` — long integer

Body: `UpdatePostSettingsRequest`

- `hidden` — boolean or `null`
- `hosting` — boolean or `null`
- `shareLocation` — boolean or `null`

Response: Empty.

## Upload media

```
POST /v1/media/upload
```

Query:

- `img_1_bottom` — integer or `null`
- `img_1_left` — integer or `null`
- `img_1_right` — integer or `null`
- `img_1_top` — integer or `null`

Body: Binary media file.

Response: `RightNowMediaUploadResponse`

- `mediaId` — long integer or `null`
- `url` — string
- `thumbnailUrl` — string

## Get SKU

```
GET /v1/rightnow/googleplay/sku
```

Response: `RightNowSkuResponse`

- `rightNowSku` — string
- `rightNowBoostedSku` — string
- `boostUpsellSku` — string

## Requests

```
GET /v1/rightnow/requests/inbox
GET /v1/rightnow/requests/outbox
POST /v1/rightnow/requests
PUT /v1/rightnow/requests/{requestId}
```

Create request body: `RightNowCreateRequestData`

- `postId` — long integer

Update request path/body:

- `requestId` — long integer
- `status` — [RightNowRequestStatus](#rightnowrequeststatus)

Responses:

- inbox: `RightNowGetReceivedRequestsResponse`
- outbox: `RightNowGetSentRequestsResponse`
- create/update: Empty.

## Report Right Now post

```
GET /v1/flags/right-now/{postId}
POST /v1/flags/right-now/{postId}
```

Path:

- `postId` — long integer

POST body: `ReportRightNowPostRequest`.

Responses:

- GET: `ReportRightNowPostResponse`
- POST: Empty.
