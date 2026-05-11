# Signed CDN files

CDN files accessible via signed URLs signed with `Signature` query argument. New signed URLs are generated and populated in API responses when existing URL expires. `Expires` query argument holds expiration date in unix timestamp in seconds, 15 minutes.

Base URL appears to be:

```
https://d2wxe7lth7kp8g.cloudfront.net/
```

Although it might change in the future, so it's best to pull full URL from `url` property on media object itself.

## Chat media

Media uploaded directly to DMs are accessible by this URL:

```
/{uploaderProfileId}/{mediaHash}?Expires={unixTimestampSeconds}&Signature={signature}&Key-Pair-Id={keyPairId}
```

`POST /v5/chat/media/upload` returns `MediaUploadResponse` with:

- `mediaId` — long integer
- `url` — signed CDN URL
- `mediaHash` — string

## Right Now media

`POST /v1/media/upload` returns `RightNowMediaUploadResponse` with:

- `mediaId` — long integer or `null`
- `url` — signed CDN URL
- `thumbnailUrl` — signed CDN URL

## MediaState

Public media in Grindr undergo through an automated moderation check before they appear in profile. State can be either `null` for medias uploaded privately ([chats](/grindr-api/messaging/albums#upload-media-to-an-album)) or a string for public-facing media.

The current decompiled `UploadedProfileImageResponse` has an `isPending` helper that checks for this state:

- `Pending` — awaiting moderation check

Other moderation states are not enumerated in the decompiled model.
