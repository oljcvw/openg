# Evidence and verification

This API reference combines multiple evidence classes. Do not treat them as
equivalent.

## Evidence classes

| Label | Meaning | Documentation use |
| --- | --- | --- |
| Live verified | A maintainer executed the request against the Grindr API and observed the response. | May be documented as endpoint behavior, including status codes and response fields that were actually observed. |
| APK observed | The endpoint, parameter, payload model, or response model was found in a decompiled Grindr Android APK. | May document client-visible API shape only. It does not prove the server still accepts the request, accepts every parameter, uses the inferred auth state, or returns every modeled field. |
| Prior observed | The endpoint or behavior came from older notes, traffic, or documentation and was not found in the current APK evidence pass. | Keep it separated from current APK evidence and avoid presenting it as current behavior. |
| Unknown | The evidence does not support a stronger claim. | State the unknown directly instead of filling the gap with a guess. |

## Current APK evidence pass

The current local APK evidence is provided through a local `grindrapp` link in
the repository root. The link points outside the repository and must not be
committed.

APK snapshot:

| Artifact | Value |
| --- | --- |
| Package | `com.grindrapp.android` |
| Version name | `26.7.0` |
| Version code | `159416` |
| Base APK SHA-256 | `6440d1f7f9bbf1c67069f2252f001e7163723a06e4d7b076ee754d03716aa958` |
| ARM64 split SHA-256 | `178e5a7f51bda3bffc0193d3a7a17f5a412401a8d63af9cf9cbaa09b56875985` |
| XHDPI split SHA-256 | `dc1f8bc2ff19ec958eef93d3221ee525c238ad23590048287cb241da93af33e7` |

The source tree used for endpoint discovery is
`grindrapp/decompiled/jadx-src-nores/sources`. The JADX Gradle export and the
no-resource source fallback both reported a nonzero exit code in
`grindrapp/decompiled/reports/summary.json`, so this pass is useful evidence but
not a complete decompile.

The Retrofit endpoint inventory script scans the local source fallback:

```sh
bun run --cwd docs apk:endpoints
```

For this APK snapshot the script finds 290 Retrofit endpoint annotations,
including `@HTTP` annotations with explicit methods. Treat this as an extraction
count, not as a count of server-supported Grindr API endpoints. Third-party
services, duplicate Retrofit bindings, and dead or gated client paths can appear
in the same source tree.

## Documentation rules

When documenting from APK evidence:

- Use the APK to identify endpoint paths, HTTP methods, request parameters,
  request model fields, response model fields, enum literals, and feature names.
- Prefer product-facing names and endpoint descriptions over obfuscated class or
  method names.
- Do not publish obfuscated names, one-time local variable names, or decompiler
  artifacts unless the name is the only available evidence and it is clearly
  marked as internal evidence.
- Do not infer live behavior from a model field alone. A modeled field may be
  optional, stale, client-only, feature-gated, or absent from real responses.
- Do not mark an endpoint as public merely because the APK evidence does not
  show an `Authorization` header on the same line. The reference default is that
  Grindr service endpoints use [API Authorization](/grindr-api/api-authorization)
  unless an endpoint page explicitly says otherwise.
- If behavior is APK-only, write a short note such as: "Observed in APK v26.7.0;
  behavior not yet live verified."
- If an endpoint page says "Live verified", it must be backed by an actual API
  client run.

## Live verification expectation

APK evidence is not enough to approve new endpoint behavior as verified API
documentation. Before an endpoint is promoted from APK observed to live verified,
test it in an API client such as Postman with enough variation to cover the
documented contract:

- expected success request,
- missing or invalid authorization where relevant,
- invalid or boundary input where relevant,
- feature-gated or entitlement-gated states where relevant,
- sanitized request body, response body, status code, and response headers.

Record the app/API evidence date, auth state, endpoint path, method, request
shape, observed response shape, and any unresolved unknowns. Redact credentials,
tokens, profile IDs, precise location, and user-generated content before adding
examples to the public docs.
