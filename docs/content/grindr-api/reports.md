# Reports

Report endpoints require [Authorization](/grindr-api/api-authorization).

## Report profile form

```
GET /v4/flags/{id}
GET /v3.1/flags/{id}
```

Path:

- `id` — profile ID, long integer

Response:

`ReportProfileResponse`. The decompiled class does not expose simple fields, but the response model name is present in Retrofit annotations.

## Submit profile report

```
POST /v5/flags/{id}
POST /v3.1/flags/{id}
```

Path:

- `id` — profile ID, string

Body (`ReportProfileRequest`):

- `reason` — string
- `comment` — string
- `locations` — array of strings
- `albumInfo` — `ReportAlbumInfo`, optional
- `rightNowInfo` — `RightNowInfo`, optional
- `captchaToken` — string, optional

Response:

Empty.

## Right Now post report form

```
GET /v1/flags/right-now/{postId}
```

Path:

- `postId` — long integer

Response:

`ReportRightNowPostResponse`:

- `flagReport` — `RightNowPostFlagReport`

## Submit Right Now post report

```
POST /v1/flags/right-now/{postId}
```

Path:

- `postId` — long integer

Body (`ReportRightNowPostRequest`):

- `reason` — string
- `comment` — string
- `locations` — array of strings

Response:

Empty.

## Report sent expiring photos

```
POST /v4/pics/expiring
```

Body (`ExpiringPhotoReportSentRequest`):

- `count` — integer

Response:

`ExpiringPhotoStatusResponse`:

- `available` — integer
- `total` — integer
