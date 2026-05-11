# Age verification

Age verification endpoints require [Authorization](/grindr-api/api-authorization).

## Get options

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

```
POST /v1/age-verification/session
```

Response: `AgeVerificationSessionResponse`

- `sessionId` — string

## Verify document

```
POST /v1/age-verification/verify/document
```

Body: `AgeVerificationPhotoIdMatchRequest`

- `faceTecUserAgent` — string
- `idScan` — string
- `idScanFrontImage` — string
- `idScanBackImage` — string

Response: `AgeVerificationFaceTecResponse`

- `status` — string
- `method` — string
- `resultBlob` — string

## Verify enrollment

```
POST /v1/age-verification/verify/enrollment
```

Body: `AgeVerificationFaceTecRequest`

- `faceTecUserAgent` — string
- `faceScan` — string
- `auditTrailImage` — string
- `lowQualityAuditTrailImage` — string

Response: `AgeVerificationFaceTecResponse`.

## Verify 3D liveness

```
POST /v1/age-verification/verify/liveness3d
```

Body: `AgeVerificationFaceTecRequest`.

Response: `AgeVerificationFaceTecResponse`.
