# Boosting

## Get boost sessions

Requires [Authorization](/grindr-api/api-authorization).

```
GET /v2/boost/sessions
```

Response:

`BoostSessionResponse`:

- `boostSessions` — array of `BoostSessionApiResponse`

## Redeem boost consumable

Requires [Authorization](/grindr-api/api-authorization).

```
POST /v1/consumables/redeem/boost
```

Body (`RedeemBoostRequest`):

- `boostType` — string

Response:

`BoostRedeemedResponse`:

- `redeemed` — `ConsumableInventory`

## Set standard boost preferences

Requires [Authorization](/grindr-api/api-authorization).

```
POST /v1/boost/preferences/standard
```

Body (`BoostPreferencesRequest`):

- `isCurrentLocation` — boolean
- `geohash` — string

Response:

Empty raw body.

## Set super boost preferences

Requires [Authorization](/grindr-api/api-authorization).

```
POST /v1/boost/preferences/super
```

Body (`SuperBoostPreferencesRequest`):

- `minAge` — integer or `null`
- `maxAge` — integer or `null`
- `positionPreferences` — array of integers
- `isCurrentLocation` — boolean
- `geohash` — string

Response:

Empty raw body.

## Set mega boost preferences

Requires [Authorization](/grindr-api/api-authorization).

```
POST /v1/boost/preferences/mega
```

Body (`SuperBoostPreferencesRequest`):

- `minAge` — integer or `null`
- `maxAge` — integer or `null`
- `positionPreferences` — array of integers
- `isCurrentLocation` — boolean
- `geohash` — string

Response:

Empty raw body.

## Pause boost session

Requires [Authorization](/grindr-api/api-authorization).

```
POST /v1/boost/sessions/pause
```

Response:

Empty.

## Unpause boost session

Requires [Authorization](/grindr-api/api-authorization).

```
POST /v1/boost/sessions/unpause
```

Response:

Empty.

## Get consumable inventory

Requires [Authorization](/grindr-api/api-authorization).

```
GET /v1/consumables/inventory
```

Response:

`ConsumableInventoryDto`:

- `consumables` — array of `ConsumableInventory`
