# Roam

Roam endpoints require [Authorization](/grindr-api/api-authorization).

## Get neighborhood

```
GET /v1/location/neighborhood/{geohash}
```

Path:

- `geohash` — [Geohash](/grindr-api/browse/location#geohash)

Response: Raw `ResponseBody`.

## Set roam location

```
PUT /v1/roam/location
```

Body: `RoamPutLocationRequest`

- `geohash` — [Geohash](/grindr-api/browse/location#geohash)
- `name` — string

Response: Raw `ResponseBody`.

## Get roam session

```
GET /v1/roam
```

Response: `RoamSession`

- `profileId` — string with numeric profile ID
- `sessionId` — string
- `isRoaming` — boolean
- `geoHash` — string
- `locationName` — string
- `lat` — number or `null`
- `lon` — number or `null`
- `startTime` — unix timestamp in milliseconds
- `endTime` — unix timestamp in milliseconds
- `activateLocationRequestStatus` — `RoamActivateLocationRequestStatus`

## Set roam status

```
PUT /v1/roam/status/{location}
```

Path:

- `location` — string

Response: Raw `ResponseBody`.

## Set roam arrival

```
PUT /v1/roam/arrival/{days}
```

Path:

- `days` — integer

Response: Raw `ResponseBody`.
