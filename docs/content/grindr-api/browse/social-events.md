# Social events

## Get social events

Requires [Authorization](/grindr-api/api-authorization).

```
GET /v1/social-events
```

Query:

- `geohash` — string, optional
- `sortBy` — string, optional; client enum values are `DISTANCE`, `UPCOMING`, and `POPULARITY`
- `region` — string, optional

Response: `EventsListResponse`

- `events` — array of `EventItemResponse`, see [Social event](#social-event)

## Get social event

Requires [Authorization](/grindr-api/api-authorization).

```
GET /v1/social-events/{socialEventId}
```

Path:

- `socialEventId` — long integer

Response: `EventItemResponse`, see [Social event](#social-event).

## Attend social event

Requires [Authorization](/grindr-api/api-authorization).

```
POST /v1/social-events/{socialEventId}/attendees
```

Path:

- `socialEventId` — long integer

Response: Empty.

## Unattend social event

Requires [Authorization](/grindr-api/api-authorization).

```
DELETE /v1/social-events/{socialEventId}/attendees
```

Path:

- `socialEventId` — long integer

Response: Empty.

## Social event

- `socialEventId` — long integer
- `name` — string
- `location` — string
- `region` — string
- `startTime` — unix timestamp in milliseconds or `null`
- `endTime` — unix timestamp in milliseconds or `null`
- `timezone` — string
- `eventType` — string, e.g. `FESTIVAL` | `KINK` | `PRIDE`
- `eventImageUrl` — string
- `imageSource` — string
- `attendeesPreview` — array of objects
  - `profileId` — long integer
  - `profileImageUrl` — string
- `isAttending` — boolean
