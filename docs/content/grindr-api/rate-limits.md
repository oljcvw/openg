# Rate limits

The current decompiled Retrofit interfaces do not expose generic rate-limit response headers such as `X-RateLimit-*` or `Retry-After` for Grindr API calls.

Observed rate-related evidence in the decompiled app is limited to domain-specific statuses and quota endpoints:

- account creation has a `TooManyRequests` result branch
- SMS verification has a `RateLimited` status code `304`
- chat media includes quota/status endpoints such as `GET /v1/pics/limited/status`, `GET /v4/pics/expiring/status`, `GET /v4/videos/expiring/status`
- albums storage has `GET /v1/albums/storage`

No standalone API-wide retry policy or reset timestamp model was found in the owned endpoint set.
