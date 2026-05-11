# GIFs

Observed in the decompiled app via `mp/c.java`. Both endpoints use Giphy and require [Authorization](/grindr-api/api-authorization).

## Giphy item

- `id` — string
- `images` — object
  - `downsized` — [Giphy image data](#giphy-image-data)
  - `fixed_height` — [Giphy image data](#giphy-image-data)
  - `fixed_height_downsampled` — [Giphy image data](#giphy-image-data)
  - `fixed_width_downsampled` — [Giphy image data](#giphy-image-data)
  - `fixed_height_still` — [Giphy image data](#giphy-image-data)

## Giphy image data

- `url` — string
- `webp` — string or `null`
- `width` — integer
- `height` — integer

## Trending GIFs

```
GET /v1/gifs/trending?limit=50&rating=r
```

No body.

Response model: `GiphyResponse`.

Response:

- `data` — array of [Giphy item](#giphy-item)

## Search GIFs

```
GET /v1/gifs/search?limit=50&rating=r
```

Query:

- `q` — string, search text
- `offset` — integer

Response model: `GiphyResponse`.

Response:

- `data` — array of [Giphy item](#giphy-item)
