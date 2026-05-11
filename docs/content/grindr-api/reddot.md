# Reddot

Reddot endpoints require [Authorization](/grindr-api/api-authorization).

## Get red dots

```
GET /v1/reddot
```

Response:

`RedDotListResponse`:

- `dots` — array of `RedDotResponse`

## Acknowledge red dot type

```
POST /v1/reddot/{type}
```

Path:

- `type` — string

Response:

Empty.
