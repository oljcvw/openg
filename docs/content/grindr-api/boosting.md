# Boosting

Boost endpoints require [Authorization](/grindr-api/api-authorization).

## Get boost sessions

```
GET /v2/boost/sessions
```

Response:

`BoostSessionResponse`:

- `boostSessions` — array of `BoostSessionApiResponse`

## Redeem boost consumable

```
POST /v1/consumables/redeem/boost
```

Body (`RedeemBoostRequest`):

- `boostType` — string

Response:

`BoostRedeemedResponse`:

- `redeemed` — `ConsumableInventory`

## Set standard boost preferences

```
POST /v1/boost/preferences/standard
```

Body (`BoostPreferencesRequest`):

- `isCurrentLocation` — boolean
- `geohash` — string

Response:

Raw `ResponseBody`.

## Set super or mega boost preferences

```
POST /v1/boost/preferences/super
POST /v1/boost/preferences/mega
```

Body (`SuperBoostPreferencesRequest`):

- `minAge` — integer or `null`
- `maxAge` — integer or `null`
- `positionPreferences` — array of integers
- `isCurrentLocation` — boolean
- `geohash` — string

Response:

Raw `ResponseBody`.

## Pause boost session

```
POST /v1/boost/sessions/pause
```

Response:

Empty.

## Unpause boost session

```
POST /v1/boost/sessions/unpause
```

Response:

Empty.

## Get consumable inventory

```
GET /v1/consumables/inventory
```

Response:

`ConsumableInventoryDto`:

- `consumables` — array of `ConsumableInventory`
