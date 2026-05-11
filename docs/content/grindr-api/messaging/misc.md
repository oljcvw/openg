# Misc

## Translate a message

Requires [Authorization](/grindr-api/api-authorization).

Paid feature.

```
POST /v5/chat/translate
```

Body model: `ChatTranslateRequest`.

Body:

- `conversationId` — string
- `messageId` — string
- `targetLanguageCode` — string, e.g. `en`

Response model: `ChatTranslateResponse`.

Response:

- `translatedText` — string

Errors:

- HTTP status 402, error `User has reached their entitlement limits`

## OCR recognition in chat

Requires [Authorization](/grindr-api/api-authorization).

Observed in decompiled app; behavior not yet verified. Appears to submit OCR results rather than retrieve them.

```
POST /v5/recognition/chat
```

Body model: `ChatRecognitionRequest`.

Body:

- `dataList` — array of objects
  - `ocrResult` — string
  - `messageId` — string
  - `senderProfileId` — long integer

Response model: `Unit`.

Response:

Empty.

## Rate an AI message suggestion

Requires [Authorization](/grindr-api/api-authorization).

Observed in decompiled app; behavior not yet verified.

```
POST /v1/wingman/feedback
```

Body model: `MessageRateResponseRequest`.

Body:

- `message_id` — string
- `prompt_id` — string
- `rating` — number, e.g. `1`
- `text` — string, feedback text
- `timestamp` — unix timestamp in milliseconds

Response model: `Unit`.

Response:

Empty object (`{}`).

Errors:

- HTTP status 400 (bad request)
