# Saved phrases

## Saved phrase

- `id` — string
- `text` — string
- `type` — string, e.g. `"user"`

## Get saved phrases

Requires [Authorization](/grindr-api/api-authorization).

```
GET /v1/chat/phrases
```

Response model: `ChatPhrasesResponse`.

Response:

- `phrases` — array of [Saved phrases](#saved-phrase)

## Add a saved phrase

Requires [Authorization](/grindr-api/api-authorization).

```
POST /v1/chat/phrases
```

Body model: `AddChatPhraseRequest`.

Body:

- `text` — string

Response model: `AddChatPhraseResponse`.

Response:

- `phrase` — [Saved phrase](#saved-phrase)

## Get saved phrases (legacy)

Requires [Authorization](/grindr-api/api-authorization).

```
GET /v3/me/prefs
```

Response model: `PhrasesResponse`.

Response:

- `phrases` — object
  - key is phrase ID (uuid)
    - `phraseId` — string, uuid
    - `phraseText` — string
    - `timestamp` — unix timestamp in milliseconds
    - `frequency` — integer, see [Track phrase usage frequency](#track-phrase-usage-frequency)

## Add a saved phrase (legacy)

Requires [Authorization](/grindr-api/api-authorization).

This endpoint is somewhat broken and sometimes throws 500 ISE error or .

```
POST /v3/me/prefs/phrases
```

Body model: `AddSavedPhraseRequest`.

Body:

- `phrase` — string

Response model: `AddSavedPhraseResponse`.

Response:

- `phrase` — [Saved phrase](#saved-phrase)

## Delete a saved phrase

Requires [Authorization](/grindr-api/api-authorization).

```
DELETE /v3/me/prefs/phrases/{id}
```

Response model: `Unit`.

Response:

Empty.

## Track phrase usage frequency

Requires [Authorization](/grindr-api/api-authorization).

Doesn't appear to influence the phrase's sorting position in [Get saved phrases](#get-saved-phrases) response. Increments value in [Get saved phrases (legacy)](#get-saved-phrases-legacy) endpoint.

```
POST /v4/phrases/frequency/{id}
```

No body.

Response model: `Unit`.

Response:

Empty

