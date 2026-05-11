# SMS verification

SMS endpoints use decompiled `requireRealDeviceInfo` / `requireAnonDeviceInfo` Retrofit headers. Session, send-code, verify-code, and password-reset SMS flows are allowed without an active [Authorization](/grindr-api/api-authorization) session.

## SmsSendCodeRequest

- `country_code` — string
- `phone_number` — string

## SmsVerifyCodeRequest

- `country_code` — string
- `phone_number` — string
- `code` — string

## Send SMS code

```
POST /v4/sms/sendcode
```

Body: [SmsSendCodeRequest](#smssendcoderequest)

Response: `Unit`.

## Verify SMS code

```
POST /v4/sms/verifycode
```

Body: [SmsVerifyCodeRequest](#smsverifycoderequest)

Response: `Unit`.

## Send profile verification SMS code

```
POST /v4/sms/verification/{profileId}/sendcode
```

Path:

- `profileId` — string

Body: [SmsSendCodeRequest](#smssendcoderequest)

Response: `Unit`.

## Verify profile SMS code

```
POST /v4/sms/verification/{profileId}/verifycode
```

Path:

- `profileId` — string

Body: [SmsVerifyCodeRequest](#smsverifycoderequest)

Response: `Unit`.

## Request SMS code for password change

```
POST /v4/sms/users/update-password/sendcode
```

Body: [SmsSendCodeRequest](#smssendcoderequest)

Response: `Unit`.

## Change password with SMS code

```
POST /v4/sms/users/update-password
```

Body: `ChangePasswordPhoneRequest`

- `country_code` — string
- `phone_number` — string
- `code` — string
- `password` — string

Response: `ChangePasswordResponse`

- `sessionId` — string
- `authToken` — string

## Sign in with phone

```
POST /v4/sms/sessions
```

Body: `LoginPhoneRequest`

- `country_code` — string
- `phone_number` — string
- `password` — string
- `token` — FCM token string or `null`
- `osName` — string
- `appVersion` — string; serialized name comes from an obfuscated constant
- `authToken` — string or `null`
- `bypassToken` — string or `null`

Response: `AuthResponse`
