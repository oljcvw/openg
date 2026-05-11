# Access requests

Access request endpoints require [Authorization](/grindr-api/api-authorization).

## Current v2 endpoints

The current decompiled endpoint index contains the v2 access request endpoints below.

### Get access request

```
GET /v2/access-requests
```

Response:

`AccessPortabilityResponse`:

- `accessRequest` — object or `null`
  - `createdAt` — unix timestamp in milliseconds
  - `status` — string

### Create access request

```
POST /v2/access-requests
```

Body (`DataPortabilityRequest`):

- `email` — string

Response:

Empty.

### Send verification code

```
POST /v2/access-requests/codes
```

Body (`DataPortabilityVerificationCode`):

- `code` — string

Response:

Empty.

### Confirm access request

```
POST /v2/access-requests/confirm
```

Response:

Empty.

## Prior v1 endpoints

These v1 entries were present in prior notes, but were not visible in the current decompiled endpoint index used for this pass. They are kept here as prior observed API surface rather than current decompiled evidence.

```
GET /v1/access-requests
POST /v1/access-requests
POST /v1/access-requests/codes
POST /v1/access-requests/confirmations
```

Known request bodies from prior notes:

- `POST /v1/access-requests` — `DataPortabilityRequest`
  - `email` — string
- `POST /v1/access-requests/codes` — `DataPortabilityVerificationCode`
  - `code` — string

Known response model from prior notes:

- `GET /v1/access-requests` — `DataPortabilityResponse`

Response details for the v1 models were not visible in this decompiled pass.
