# Warnings

Warning endpoints require [Authorization](/grindr-api/api-authorization).

## Acknowledge warnings

```
PUT /v1/warnings
```

Response:

Empty.

## Get warning list

```
GET /v2/warnings
```

Response:

`BannedWarningList`:

- `warnings` — array of `BannedWarning`
