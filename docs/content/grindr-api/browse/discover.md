# Discover

Discover endpoints require [Authorization](/grindr-api/api-authorization).

## Get discover profiles

```
GET /v4/discover
```

Query:

- `geohash` — [Geohash](/grindr-api/browse/location#geohash), optional in Retrofit
- `previewedProfile` — long integer profile ID, optional

Response: `DiscoverResponseV4`

- `status` — `DiscoverStatus`
- `body` — `DiscoverFeedDataV4`
  - `types` — string
  - `items` — array of `DiscoverFeedTypeV4`
  - `profiles` — array of `UpsellProfileDto`
  - `metadata` — `DiscoverMetadataV4`
  - `storedPreferences` — `DiscoverProfilePreferences`

## Get discover profiles (legacy)

```
GET /v3/discover
```

Query:

- `geohash` — [Geohash](/grindr-api/browse/location#geohash), optional in Retrofit
- `previewedProfile` — long integer profile ID, optional

Response: `DiscoverResponse`

- `status` — `DiscoverStatus`
- `body` — `DiscoverFeedData`
  - `type` — string
  - `items` — array of `DiscoverFeedType`
  - `profiles` — array of `UpsellProfileDto`
  - `sessionId` — string
  - `hadRecentRefresh` — boolean

## Update discover preferences

```
PUT /v1/discover/preferences
```

Body:

- `preferences` — object
  - `lastOnline` — integer
  - `maxDistance` — integer

Response: Empty.

## Post a pass

```
POST /v1/me/pass/{profileId}
```

Path:

- `profileId` — string with numeric profile ID

Response: Empty.
