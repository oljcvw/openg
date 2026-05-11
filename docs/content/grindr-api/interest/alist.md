# Alist

A-list endpoints require [Authorization](/grindr-api/api-authorization).

## Get A-list profiles

```
GET /v6/alist/profiles
```

Query:

- `filter` — array of strings

Response: `AListProfilesResponse`

- `profiles` — array of `AListProfileApiResponse`
- `filterCounts` — array of `AListFilterCountApiResponse`
- `state` — `AListStateApiResponse`
- `updateCount` — integer
- `updatesProfilePicturesUrls` — array of strings

## Get A-list full profile

```
GET /v2/alist/profiles/{profileId}
```

Path:

- `profileId` — long integer

Response: `AListFullProfileApiResponse`

- `id` — long integer
- `displayName` — string
- `profilePhotoUrl` — string
- `onlineUntil` — long integer or `null`
- `distanceMeters` — number or `null`
- `isFavorite` — boolean
- `isFreemium` — boolean
- `conversationId` — string
- `summary` — array of strings
- `activities` — array of `AListActivitiesApiResponse`
- `albums` — array of `AListAlbumApiResponse`
- `chatMedia` — array of `AListImageApiResponse`
- `insightTags` — array of `AListTagApiResponse`

## Get A-list updates

```
GET /v3/alist/updates
```

Response: `AListUpdatesApiResponse`

- `newUpdates` — array of `AListUpdateApiResponse`
- `oldUpdates` — array of `AListUpdateApiResponse`

## Send A-list feedback

```
POST /v1/alist/feedback/{conversationId}
```

Path:

- `conversationId` — string

Body: `AListFeedback`

- `category` — `NegativeFeedbackCategory`
- `reaction` — `FeedbackReaction`
- `text` — string

Response: Empty.

## Remove A-list profile

```
DELETE /v1/alist/profiles/{profileId}
```

Path:

- `profileId` — long integer

Response: Empty.

## Trigger A-list generation

```
POST /v1/alist/trigger-generation
```

Response: Empty.
