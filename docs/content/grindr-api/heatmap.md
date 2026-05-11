# Heatmap

Heatmap endpoints require [Authorization](/grindr-api/api-authorization).

## Get all heatmap locations

```
GET /v1/explore_heatmaps/all_locations
```

Response:

`ExploreHeatmapsResponse`:

- `heatmaps` — array of `Heatmap`
- `locations` — array of `HeatmapLocation`

## Get heatmaps near coordinates

```
POST /v1/explore_heatmaps
```

Body (`ExploreHeatmapsRequest`):

- `coordinates` — object
  - `lat` — double
  - `lng` — double
- `searchSquareSide` — double
- `includeHeatmaps` — boolean

Response:

`ExploreHeatmapsResponse`.
