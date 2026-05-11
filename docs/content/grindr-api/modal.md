# Modal

Modal endpoints require [Authorization](/grindr-api/api-authorization).

## Get modals

```
GET /v1/modal
```

Response:

`PopupModalResponse`:

- `modals` — array of `PopUpModalType`

## Acknowledge modal

```
POST /v1/modal/{modalName}
```

Path:

- `modalName` — string

Response:

Empty.
