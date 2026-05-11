# Drawer

## DrawerMedia

Decompiled response model: `MediaItem`.

- `id` — long integer, exposed in app as `mediaId`
- `url` — string, URL
- `contentType` — string
- `createdTs` — unix timestamp in milliseconds
- `used` — boolean
- `takenOnGrindr` — boolean

## Get media in drawer

Requires [Authorization](/grindr-api/api-authorization).

```
GET /v4/chat/media/drawer
```

Response:

Array of [DrawerMedia](/grindr-api/drawer#drawermedia).

## Get media in drawer for a conversation

Requires [Authorization](/grindr-api/api-authorization).

```
GET /v4/chat/media/drawer/{conversationId}
```

Path:

- `conversationId` — [Conversation ID](/grindr-api/messaging/conversations#conversation-id)

Response:

Array of [DrawerMedia](/grindr-api/drawer#drawermedia).

## Add media to drawer

Requires [Authorization](/grindr-api/api-authorization).

MediaId must be obtained through uploading media.

Repeated requests cause 500 HTTP status "Internal Error".

```
PUT /v4/chat/media/drawer/{mediaId}
```

Path:

- `mediaId` — long integer

Response:

Empty.

## Delete media from drawer

Requires [Authorization](/grindr-api/api-authorization).

Repeated requests are completed without errors.

```
DELETE /v4/chat/media/drawer/{mediaId}
```

Path:

- `mediaId` — long integer

Response:

Empty.

## Upload chat media

Requires [Authorization](/grindr-api/api-authorization).

```
POST /v5/chat/media/upload
```

Headers:

- `Content-type` — string

Query:

- `length` — long integer, optional
- `looping` — boolean, optional
- `takenOnGrindr` — boolean, optional

Body:

Binary media data.

Response:

`MediaUploadResponse`:

- `mediaId` — long integer
- `url` — signed CDN URL
- `mediaHash` — string
