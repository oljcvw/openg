# Random promotion images

## Get a random "For You" collection image

Requires [Authorization](/grindr-api/api-authorization).

```
GET /v1/random-images/foryou
```

Query:

- `count` — integer, optional, capped in range [1, 4]

Response:

- `images` — array of objects with length `count`
  - `url` — string, URL
  - `id` — string, e.g. `"WoodworkImage1"`
- `collection` — string, always `foryou`

This endpoint was documented from prior evidence. The current decompiled endpoint index for this pass did not contain `random-images`; it did contain [Woodwork placement](/grindr-api/woodwork/#placement).
