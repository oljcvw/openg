# Offers

Offer endpoints require [Authorization](/grindr-api/api-authorization).

## Get active offer

```
GET /v2/offers
```

Response:

`Offer`:

- `offerType` — string
- `offerProductSku` — string
- `baseProductSku` — string
- `offerDurationMs` — long integer
- `expirationEpochMs` — long integer or `null`
- `offerUuid` — string
- `roleName` — string
- `subscriptionDuration` — integer

## Claim offer by type

```
POST /v2/offers
```

Query:

- `offerType` — string

Response:

`Offer`.

## Get eligible offers

```
GET /v2/offers/eligible
```

Response:

`EligibleOffers`:

- `offerTypes` — array of `Offer`
- `hasExistingOffer` — boolean
