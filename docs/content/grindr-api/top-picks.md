# Top Picks

Top Picks endpoints require [Authorization](/grindr-api/api-authorization).

## TopPicksStatus

- `ALLOW`
- `PAYWALL`
- `UNLOCK`

## Get messaging entitlement

```
GET /v1/toppicks/entitlements/messaging/{profileId}
```

Path:

- `profileId` — string with numeric profile ID

Response: `TopPicksEntitlementResponse`

- `remainingChats` — integer or `null`
- `status` — [TopPicksStatus](#toppicksstatus)

## Consume messaging entitlement

```
POST /v1/toppicks/entitlements/messaging/{profileId}
```

Path:

- `profileId` — string with numeric profile ID

Response: Empty.

## Pass Top Pick

```
PUT /v1/toppicks/passed/{passedProfileId}
```

Path:

- `passedProfileId` — string with numeric profile ID

Response: Empty.

## Get Top Picks consent

```
GET /v5/legal-agreements/top-picks
```

Response: `TopPicksConsentAgreementResponse`.

## Accept Top Picks consent

```
POST /v4/legal-agreements/top-picks
```

Body: `TopPicksAcceptConsentRequest`.

Response: Empty.

## Delete Top Picks consent

```
DELETE /v5/legal-agreements/top-picks
```

Body: `TopPicksAcceptConsentRequest`.

Response: Empty.
