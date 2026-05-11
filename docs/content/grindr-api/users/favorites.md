# Favorites

Favorites endpoints require [Authorization](/grindr-api/api-authorization).

## Add favorite

```
POST /v3/me/favorites/{id}
```

Path:

- `id` — string with numeric profile ID

Response: Raw `ResponseBody`.

## Remove favorite

```
DELETE /v3/me/favorites/{id}
```

Path:

- `id` — string with numeric profile ID

Response: Raw `ResponseBody`.

## Get all notes

```
GET /v1/favorites/notes
```

Response: array of `ProfileNoteResponse`

- `counterpartyId` — long integer profile ID
- `notes` — string or `null`
- `phoneNumber` — string or `null`

## Replace notes list

```
PUT /v1/favorites/notes
```

Body: `ProfileNoteListRequest`

- `notes` — array of `ProfileNoteRequest`
  - `counterpartyId` — long integer profile ID or `null`
  - `notes` — string or `null`
  - `phoneNumber` — string or `null`

Response: Empty.

## Add or update note

```
PUT /v1/favorites/notes/{targetProfileId}
```

Path:

- `targetProfileId` — string with numeric profile ID

Body: `ProfileNoteRequest`

- `counterpartyId` — long integer profile ID or `null`
- `notes` — string or `null`
- `phoneNumber` — string or `null`

Response: Empty.

## Delete note

```
DELETE /v1/favorites/notes/{targetProfileId}
```

Path:

- `targetProfileId` — string with numeric profile ID

Response: Empty.
