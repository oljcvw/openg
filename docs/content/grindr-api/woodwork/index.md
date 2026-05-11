<script setup>
import { grindrApiReferenceWoodwork as subpages } from '$lib'
</script>

# Woodwork

[Woodwork](https://www.woodwork.com/) is a service by Grindr.

## Placement

Requires [Authorization](/grindr-api/api-authorization).

```
GET /v2/health/placement
```

Query:

- `type` — string

Response (`WoodworkPlacementResponse`):

- `id` — string
- `imageUrl` — string
- `redirectUrl` — string
- `copy` — string
- `isTrailingArrowVisible` — boolean

<Subpages :items="subpages" />
