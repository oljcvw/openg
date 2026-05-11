# Legal agreements

Legal agreement endpoints require [Authorization](/grindr-api/api-authorization).

## Get legal agreement info

```
GET /v3/legal-agreements
```

Response:

`LegalAgreementsInfo`:

- `legalAgreements` — `LegalAgreementDetails`

## Get accepted legal agreements

```
GET /v3/me/legal-agreements
```

Response:

`AcceptedLegalAgreementsResponse`:

- `privacyPolicyVersion` — integer
- `termsOfServiceVersion` — integer
- `userConsentList` — array of strings

## Accept legal agreements

```
PUT /v3/me/legal-agreements
```

Body (`AcceptLegalAgreementsRequest`):

- `privacyPolicyVersion` — integer
- `termsOfServiceVersion` — integer
- `userConsentList` — array of strings

Response:

Empty.

## Ban agreement

```
POST /v1/agreements/ban
```

Body (`BanAgreementRequest`):

- `version` — integer
- `locale` — string

Response:

Empty.

## Top Picks agreement

```
GET /v5/legal-agreements/top-picks
POST /v4/legal-agreements/top-picks
DELETE /v5/legal-agreements/top-picks
```

POST and DELETE use body (`TopPicksAcceptConsentRequest`):

- `version` — integer
- `locale` — string

GET response:

`TopPicksConsentAgreementResponse`.

POST and DELETE response:

Empty.

## Right Now agreement

```
GET /v4/legal-agreements/right-now
POST /v4/legal-agreements/right-now
```

POST body (`RightNowAcceptConsentRequest`):

- `version` — integer
- `locale` — string

GET response:

`RightNowConsentAgreementResponse`.

POST response:

Empty.

## VIP Matchmaker agreement

```
GET /v5/legal-agreements/vip-matchmaker
POST /v5/legal-agreements/vip-matchmaker
DELETE /v5/legal-agreements/vip-matchmaker
```

POST and DELETE use body (`VipMatchmakerAcceptConsentRequest`):

- `version` — integer
- `locale` — string

GET response:

`VipMatchmakerConsentAgreementResponse`.

POST and DELETE response:

Empty.

## Subscriber sponsored content agreement

```
GET /v5/legal-agreements/subscriber-sponsored-content
POST /v5/legal-agreements/subscriber-sponsored-content
DELETE /v5/legal-agreements/subscriber-sponsored-content
```

POST and DELETE use body (`SponsoredContentAcceptConsentRequest`):

- `version` — integer
- `locale` — string

GET response:

`SponsoredContentConsentAgreementResponse`.

POST and DELETE response:

Empty.

## Consent opt-out

```
POST /v1/opt-out
PUT /v1/opt-out
DELETE /v1/opt-out
```

Body (`ConsentRequest`):

- `optOutType` — string

Responses:

- `POST` returns `ConsentOptStatusResponse` with `isOptedOut` boolean
- `PUT` and `DELETE` return empty responses
