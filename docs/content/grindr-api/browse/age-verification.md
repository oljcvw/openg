# Age verification

## Get options

Requires [Authorization](/grindr-api/api-authorization).

```
GET /v1/age-verification/options
```

Response: `AgeVerificationOptionsResponse`

- `methods` — array of strings
- `faceTecConfig` — object
  - `deviceKeyIdentifier` — string
  - `encryptionKey` — string
  - `sdkKey` — string

## Create session

Requires [Authorization](/grindr-api/api-authorization).

```
POST /v1/age-verification/session
```

Response: `AgeVerificationSessionResponse`

- `sessionId` — string

## Verify document

Requires [Authorization](/grindr-api/api-authorization).

```
POST /v1/age-verification/verify/document
```

Body: `AgeVerificationPhotoIdMatchRequest`

- `faceTecUserAgent` — FaceTec SDK user-agent string
- `idScan` — FaceTec document-scan payload string
- `idScanFrontImage` — optional front document image payload string
- `idScanBackImage` — optional back document image payload string

Response: `AgeVerificationFaceTecResponse`

- `status` — string
- `method` — string
- `resultBlob` — string

## Verify enrollment

Requires [Authorization](/grindr-api/api-authorization).

```
POST /v1/age-verification/verify/enrollment
```

Body: `AgeVerificationFaceTecRequest`

- `faceTecUserAgent` — FaceTec SDK user-agent string
- `faceScan` — FaceTec face-scan payload string
- `auditTrailImage` — FaceTec audit-trail image payload string
- `lowQualityAuditTrailImage` — FaceTec low-quality audit-trail image payload string

Response: `AgeVerificationFaceTecResponse`.

## Verify 3D liveness

Requires [Authorization](/grindr-api/api-authorization).

```
POST /v1/age-verification/verify/liveness3d
```

Body: `AgeVerificationFaceTecRequest`.

Response: `AgeVerificationFaceTecResponse`.
