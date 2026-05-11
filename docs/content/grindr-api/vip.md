# VIP

VIP endpoints require [Authorization](/grindr-api/api-authorization).

## Pass VIP profile

```
PUT /v1/vip/passed/{passedProfileId}
```

Path:

- `passedProfileId` — profile ID, string

Response:

Empty.

## Get VIP profiles

```
GET /v3/vip-profiles
```

Response:

`VipProfilesResponse`:

- `vip-profiles` — array of `VipProfileResponse`
