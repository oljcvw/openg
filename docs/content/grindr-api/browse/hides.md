# Hides

Hides endpoints require [Authorization](/grindr-api/api-authorization).

The decompiled app exposes hides separately from [blocks](/grindr-api/browse/blocks) through `ca0/b.java`; behavior differences are not evident from Retrofit annotations.

## Get hidden users

```
GET /v1/hides
```

Response: `GetHiddenProfilesResponse`

- `hides` — array of `HiddenProfile`
  - `profileId` — long integer
  - `displayName` — string
  - `mediaHash` — string

## Hide a user

Repeated requests are completed without errors.

```
POST /v1/me/hides/{profileId}
```

Path:

- `profileId` — long integer

Response: Raw `ResponseBody`.

## Unhide a user

Repeated requests are completed without errors.

```
DELETE /v1/hides/{profileId}
```

Path:

- `profileId` — long integer

Response: Empty.

## Unhide all hidden users

Repeated requests are completed without errors.

```
DELETE /v1/hides
```

Response: Empty.
