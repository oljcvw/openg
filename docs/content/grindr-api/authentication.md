# Authentication

## Sign in

Make sure you're passing all [Security headers](/grindr-api/security-headers) or you might stumble upon `{"code":28,"message":"ACCOUNT_BANNED","profileId":null,"type":1,"reason":null,"isBanAutomated":true,"thirdPartyUserIdToShow":null,"banSubReason":null}` — but don't fret — it's a fake error, your account isn't banned and API simply blocked your request, not account.

```
POST /v8/sessions
```

Body:

- `email` — string with email
- `password` — string with password, don't specify if using `authToken`
- `authToken` — string obtained from login+password flow or `null`
- `token` — FCM (push service) string or `null`
- `geohash` — [geohash](/grindr-api/browse/location#geohash) string or `null`

Response:

- `profileId` — integer account ID
- `sessionId` — JWT token (see [Session ID](#session-id))
- `authToken` — auth token for session refresh

Possible errors:

- ACCOUNT_BANNED — could be malformed request
- Invalid input parameters — incorrect credentials

## Third-party sign in

```
POST /v8/sessions/thirdparty
```

Body:

- `thirdPartyUserId` — string
- `authToken` — string
- `geohash` — [geohash](/grindr-api/browse/location#geohash) string or `null`

Response:

- `registered` — boolean
- `thirdPartyUserInfo` — `ThirdPartyUserInfo` object or `null`
- `authenticationResponse` — authentication response object or `null`

## Session ID

JWT obtained from [authentication](#authentication) flow. Decoded JWT content:

Headers claims structure:

- `kid` — key ID
- `alg` — `"RS256"`
- `typ` — `"JWT"`

Payload claims:

- `exp` — number, unix timestamp in seconds defining token expiration date
- `profileId` — string with numbers, account's ID
- `roles` — unknown array, appears to be empty
- `features` — array of enabled capability names
- `featureFlags` — array of feature-flag keys
- `experiments` — object keyed by experiment name; values are assignment bucket strings such as `control` or `treatment`
- `systemTime` — unix timestamp in milliseconds
- `upsells` — unknown object, appears to be empty
- `restrictionReason` — unknown value, appears to be `null`
- `grit` — unknown UUIDv4 string
