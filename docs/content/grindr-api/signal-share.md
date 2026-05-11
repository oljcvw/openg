# Signal share

## Get signal share

Requires [Authorization](/grindr-api/api-authorization).

```
GET /v1/signalshare
```

Response (`SignalShareInfoResponse`):

- `sevenDayRevenue` — float or `null`
- `thirtyDayRevenue` — float or `null`

The current decompiled response model does not include a `profileId` field.
