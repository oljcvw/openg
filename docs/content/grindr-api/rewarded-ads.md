# Rewarded ads

Rewarded ad endpoints require [Authorization](/grindr-api/api-authorization).

## Get rewarded ad rewards

```
GET /v1/rewarded-ads/rewards
```

Response:

`RewardedAdApiResponse`:

- `rewards` — array of `RewardedAdItemApiResponse`

## Update ad consumption

```
PUT /v1/rewarded-ads/consumption
```

Body (`RewardedAdStatusRequest`):

- `source` — string
- `status` — string
- `type` — string
- `adId` — string

Response:

Empty.

## Update reward restriction

```
PUT /v1/rewarded-ads/rewards/restriction
```

Body (`RewardedAdRestrictionRequest`):

- `type` — string

Response:

Empty.
