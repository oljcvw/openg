# Account

## Validate password complexity

Does not require [Authorization](/grindr-api/api-authorization).

```
POST /v3/users/password-validation
```

Body: `ValidatePasswordComplexityRequest`

- `password` — string

Response: `Unit`.

## Register push token

Requires [Authorization](/grindr-api/api-authorization).

```
POST /v3/gcm-push-tokens
```

Body: `FcmPushRequest`

- `vendorProvidedIdentifier` — string
- `token` — string

Response: `Unit`.

## Update password

Requires [Authorization](/grindr-api/api-authorization).

```
POST /v3/users/update-password
```

Body: `ChangePasswordRequest`

- `oldPassword` — string
- `newPassword` — string

Response: `ChangePasswordResponse`

- `sessionId` — string
- `authToken` — string

## Update email

Requires [Authorization](/grindr-api/api-authorization).

```
POST /v3/users/email
```

Body: `UpdateEmailRequest`

- `newEmail` — string
- `password` — string

Response: `AuthResponse`

## Create account with email

Does not require [Authorization](/grindr-api/api-authorization).

```
POST /v8/users
```

Body: `CreateAccountEmailRequest`

- `email` — string
- `password` — string
- `birthday` — integer timestamp
- `captchaToken` — string or `null`
- `token` — FCM token string
- `optIn` — boolean
- `sessionId` — cognition session ID string or `null`

Response: `FirstPartyCreateAccountResponse`

- `profileId` — string

## Create account with third party

Does not require [Authorization](/grindr-api/api-authorization). Production and legacy paths are both visible in the client.

```
POST /v8/users/thirdparty
POST /v7/users/thirdparty
```

Body: `CreateThirdPartyAccountRequest`

- `thirdPartyVendor` — integer
- `thirdPartyToken` — string
- `thirdPartyUserId` — string
- `age` — integer
- `email` — string
- `captchaToken` — string

Response: `ThirdPartyCreateAccountResponse`

- `profileId` — string
- `thirdPartyUserId` — string

## Forgot password

Does not require [Authorization](/grindr-api/api-authorization).

```
POST /v3/users/forgot-password
```

Body: `ForgotPwdEmailRequest`

- `email` — string

Response: `ForgotPwdEmailResponse`

- `code` — integer
- `message` — string
- `resetToken` — string

## Exchange Google authorization code

Does not require [Authorization](/grindr-api/api-authorization).

```
POST /v3/users/thirdparty/exchange
```

Body: `GoogleAccessTokenRequest`

- `code` — string

Response: `GoogleAccessTokenResponse`

- `access_token` — string
- `token_type` — string
- `id_token` — string
- `expires_in` — integer

## Delete account

Requires [Authorization](/grindr-api/api-authorization).

```
DELETE /v3/me/profile
```

Response: `Unit`.

## Get preferences

Requires [Authorization](/grindr-api/api-authorization).

```
GET /v3/me/prefs/settings
```

Response: `GrindrSettings`

- `locationSearchOptOut` — boolean
- `incognito` — boolean
- `hideViewedMe` — boolean
- `approximateDistance` — boolean
- `viewRightNowNsfw` — boolean

## Set preferences

Requires [Authorization](/grindr-api/api-authorization).

```
PUT /v3/me/prefs/settings
```

Body: `UpdateSettingsRequest`

- `settings` — `GrindrSettings` object:
  - `locationSearchOptOut` — boolean
  - `incognito` — boolean
  - `hideViewedMe` — boolean
  - `approximateDistance` — boolean
  - `viewRightNowNsfw` — boolean

Response: `Unit`.

## Get visiting settings

Requires [Authorization](/grindr-api/api-authorization).

```
GET /v1/visiting/settings
```

Response: `VisitingStatusSettings`

- `setting` — visiting-mode string. Observed value `AUTO` appears to let the service choose the visiting state automatically.

## Set visiting settings

Requires [Authorization](/grindr-api/api-authorization).

```
PUT /v1/visiting/settings
```

Body: `VisitingStatusRequest`

- `setting` — visiting-mode string. Observed value `AUTO` appears to let the service choose the visiting state automatically.

Response: `Unit`.

## Get home location

Requires [Authorization](/grindr-api/api-authorization).

```
GET /v1/visiting/home
```

Response: `HomeLocationResponse`

- `name` — string, [human-readable name](/grindr-api/browse/location#search-places-by-name) of location
- `lat` — float
- `lon` — float

## Set home location

Requires [Authorization](/grindr-api/api-authorization).

```
PUT /v1/visiting/home
```

Body: `HomeLocationRequest`

- `lat` — float
- `lon` — float

Response: `HomeLocationResponse`

- `name` — string, [human-readable name](/grindr-api/browse/location#search-places-by-name) of location
- `lat` — float
- `lon` — float
