# Logging

## Upload mobile logs

The Android client defines both authenticated and anonymous variants for the same endpoint.

```
POST /v3/logging/mobile/logs
```

Headers:

- `Content-Encoding: gzip`
- `requireRealDeviceInfo: true` for the authenticated variant
- `requireAnonDeviceInfo: true` for the anonymous variant

Body:

Binary/gzipped `RequestBody`.

Response:

Raw `ResponseBody`.

## Send UX event

Requires [Authorization](/grindr-api/api-authorization).

```
POST /v1/uxevent
```

Body (`UxEventRequest`):

- `type` — `UxEventScreen`
- `subtype` — `UxEvent`

Response:

Empty.
