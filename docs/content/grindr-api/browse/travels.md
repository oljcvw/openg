# Travels

Travel plan endpoints require [Authorization](/grindr-api/api-authorization).

## Get travel plans

```
GET /v6/profiles/travel/{profileId}
```

Path:

- `profileId` — long integer

Response: `TravelPlansApiResponse`

- `travelPlans` — array of [TravelPlanApiResponse](#travelplanapiresponse)

## TravelPlanApiResponse

- `travelPlanId` — long integer or `null`, required for update, ignored for create
- `profileId` — long integer
- `geohash` — [Geohash](/grindr-api/browse/location#geohash)
- `locationName` — string
- `startDate` — long integer, unix timestamp in milliseconds
- `endDate` — long integer, unix timestamp in milliseconds
- `showOnProfile` — boolean
- `notes` — string

## Create travel plans

```
POST /v6/profiles/travel
```

Body: `AddTravelPlanApiRequest`

- `profileId` — long integer
- `geohash` — [Geohash](/grindr-api/browse/location#geohash)
- `startDate` — long integer, unix timestamp in milliseconds
- `endDate` — long integer, unix timestamp in milliseconds
- `showOnProfile` — boolean
- `notes` — string

Response: Empty.

## Update travel plans

```
POST /v6/profiles/travel/update
```

Body: `UpdateTravelPlanApiRequest`

- `travelPlanId` — long integer or `null`
- `profileId` — long integer
- `geohash` — [Geohash](/grindr-api/browse/location#geohash)
- `startDate` — long integer, unix timestamp in milliseconds
- `endDate` — long integer, unix timestamp in milliseconds
- `showOnProfile` — boolean
- `notes` — string

Response: Empty.

## Delete travel plans

Repeated requests are completed without errors.

```
DELETE /v6/profiles/travel/{travelPlanId}
```

Path:

- `travelPlanId` — long integer

Response: Empty.
