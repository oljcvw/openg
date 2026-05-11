# Albums

Album, pressie album, and paywalled album endpoints below are observed in the decompiled app. Pressie/SpankBank semantics are not fully verified.


## Decompiled Retrofit model index

Observed response/request models from `cm/a.java` and `ik/a.java`:

- `GET v1/albums` — response `AlbumsList`; albums module also uses `OwnAlbumsResponse`
- `GET v2/albums/{albumId}` — response `Album`
- `POST v2/albums` — body/response `AlbumNameRequestResponse` / `CreateAlbumResponse`
- `PUT v2/albums/{albumId}` — body/response `AlbumNameRequestResponse`
- `DELETE v1/albums/{albumId}` — response `Unit`
- `POST v1/albums/{albumId}/content` — multipart `content`, query `width`, `height`, `isFresh`; response `UploadAlbumContentResponse`
- `POST v1/albums/{albumId}/content/order` — body `AlbumsOrderRequest`; response `Unit`
- `DELETE v1/albums/{albumId}/content/{contentId}` — response `Unit`
- `GET v1/albums/{albumId}/content/{contentId}/processing` — response `AlbumsVideoProcessingResponse`
- `GET v1/albums/{albumId}/content/{contentId}/poster` — response `AlbumsPosterResponse`
- `GET v3/albums/{albumId}/view` — response `Unit`
- `POST v1/albums/{albumId}/view/content/{contentId}` — response `AlbumsRemainingViewsResponse`
- `GET v1/albums/{albumId}/shares` — response `AlbumsSharedWithResponse`
- `POST v4/albums/{albumId}/shares` — body `AlbumShareRequest`; response `Unit`
- `PUT v1/albums/{albumId}/unshares` — body `ShareOrUnshareAlbumRequest`; response `Unit`
- `PUT v1/albums/{albumId}/shares/remove` — response `Unit`
- `POST v1/albums/{albumId}/content/chat/list-by-id` — body `ContentMediaIdList`, query `isFresh`; response `Unit`
- `GET v1/albums/storage` — response `AlbumsContentLimits`
- `PUT v1/albums/red-dot` — response `Unit`
- `POST v2/albums/shares` — body `ProfileAlbumsStatusRequest`; response `ProfileAlbumStatus`
- `GET v2/albums/shares/{profileId}` — response `SharedAlbumsBrief`
- `POST v3/pressie-albums/feed` — body `AlbumsFeedPilterData`; response `AlbumsFeedResponse`
- `POST v3/pressie-albums/fresh-feed` — body `AlbumsFeedPilterData`; response `AlbumsFeedResponse`
- `POST v3/pressie-albums/feed/paywall/` — body `FreshPaywallContentRequest` or `SpankBankPaywallContentRequest`; response `FreshPaywallContentResponse` or `SpankBankPaywallContentResponse`
- `GET v3/pressie-albums/feed/{profileId}` — response `SpankBankAlbumForProfileResponse`
- `POST v3/pressie-albums/feed/update/read` — body `SpankBankAlbumViewedRequest`; response `Unit`

## AlbumExpirationType

- `"INDEFINITE"` or `0` — "Indefinitely"
- `"ONCE"` or `1` — "View Once", limited by 30 minutes from request
- `"TEN_MINUTES"` or `2` — "For 10 Minutes"
- `"ONE_HOUR"` or `3` — "For 60 Minutes"
- `"ONE_DAY"` or `4` — "For 24 Hours"

Previously shared [albums in chat](/grindr-api/messaging/messages#album) inherit new `expirationType` settings from newer sharings of the album.

## AlbumPreview

- `albumId` — long integer
- `albumNumber` — integer or `null` if album has expired or was locked
- `totalAlbumsShared` — integer or `null` if album has expired or was locked
- `hasUnseenContent` — boolean

## AlbumMin

- *everything from [AlbumPreview](#AlbumPreview)*
- `albumName` — appears to always be `null`
- `profileId` — integer
- `albumViewable` — boolean

## AlbumDetails

- `sharedCount` — integer
- `createdAt` — string, date formatted as ISO 8601, e.g. `2026-03-27T20:39:00`
- `updatedAt` — string, date formatted as ISO 8601, e.g. `2026-03-27T20:39:00`

## AlbumExpiration

- `expiresAt` — unix timestamp in milliseconds or `null`
- `expirationType` — [AlbumExpirationType](#albumexpirationtype)

## AlbumContentMin

- `contentId` — long integer
- `contentType` — string
- `coverUrl` — [AlbumCoverUrl](#AlbumCoverUrl)
- `statusId` — integer observed in decompiled album content model; behavior not yet verified

## AlbumContent

- *everything from [AlbumContentMin](#AlbumContentMin)*
- `thumbUrl` — string, unblurred preview, see [Media -> Signed CDN files](/grindr-api/media/signed-cdn-files)
- `url` — string, original file, see [Media -> Signed CDN files](/grindr-api/media/signed-cdn-files), may be `""` if `remainingViews` is 0
- `processing` — boolean
- `rejectionId` — unknown or `null`

## AlbumCoverUrl

String with URL or `null`, blurred downscaled preview.

JPEG photo with the first frame of video in case of video files.

Becomes unavailable (`AccessDenied`) after album has expired.

See [Media -> Signed CDN files](/grindr-api/media/signed-cdn-files).

## Album name

String, may be empty (`""`) or `null`, non-string values are coerced into string.

Maximum length: 255 UTF-8 bytes, which is 255 characters for ASCII strings (1 ASCII character is encoded as 1 byte) but less if you include emojis or non-ascii characters (2+ bytes/one codepoit).

## Get my albums

Requires [Authorization](/grindr-api/api-authorization).

```
GET /v1/albums
```

Response:

- `albums` — array of objects
  - *everything from [AlbumDetails](#albumdetails)*
  - `albumId` — long integer
  - `albumName` — [Album name](#album-name)
  - `profileId` — integer
  - `version` — integer
  - `content` — [AlbumContent](#albumcontent)
  - `isShareable` — boolean

## Get an album

Requires [Authorization](/grindr-api/api-authorization).

```
GET /v2/albums/{albumId}
```

Response:

- *everything from [AlbumMin](#albummin)*
- *everything from [AlbumDetails](#albumdetails)*
- `content` — array of objects
  - *everything from [AlbumContent](#albumcontent)*
  - `remainingViews` — integer, might be -1; absent if this is your album

Errors:

- HTTP status 403 — if you don't have access to album or it doesn't exist

## Get an album media poster

Requires [Authorization](/grindr-api/api-authorization).

```
GET /v1/albums/{albumId}/content/{contentId}/poster
```

Response:

- `blurredPosterUrl` — string, see [Media -> Signed CDN files](/grindr-api/media/signed-cdn-files)
- `posterUrl` — string, see [Media -> Signed CDN files](/grindr-api/media/signed-cdn-files)

## Record view of an album

Repeated requests after invoking this endpoint on view ONCE albums cause HTTP status 403 Forbidden and `Action not permitted` error.

```
GET /v3/albums/{albumId}/view
```

Response:

Empty

## Record view of media in an album

Requires [Authorization](/grindr-api/api-authorization).

Repeated requests after reaching remainingViews=0 do not cause any errors.

```
POST /v1/albums/{albumId}/view/content/{contentId}
```

Response:

- `remainingViews` — integer

## Get info about profile's album

Requires [Authorization](/grindr-api/api-authorization).

```
POST /v2/albums/shares
```

Body:

- `profileId` — integer

Response:

- `profileId` — long integer
- `hasAlbum` — boolean
- `hasSharedWithMe` — boolean

## Get albums shared by a profile

Requires [Authorization](/grindr-api/api-authorization).

```
GET /v2/albums/shares/{profileId}
```

Response:

- `albums` — array of objects
  - *everything from [AlbumMin](#albummin)*
  - *everything from [AlbumExpiration](#albumexpiration)*
  - `content` — a single [AlbumContentMin](#albumcontentmin), a blurred preview
  - `contentCount` — object
    - `imageCount` — integer
    - `videoCount` — integer

## Create an album

Requires [Authorization](/grindr-api/api-authorization).

```
POST /v2/albums
```

Body:

- `albumName` — [Album name](#album-name)

Response:

- `albumId` — long integer

Error:

- HTTP status 402 Payment required if you reached [limit](#get-album-limits) for number of created albums

## Rename an album

Requires [Authorization](/grindr-api/api-authorization).

```
PUT /v2/albums/{albumId}
```

Body:

- `albumName` — [Album name](#album-name)

Response:

- `albumId` — integer
- `albumName` — [Album name](#album-name)

## Delete an album

Requires [Authorization](/grindr-api/api-authorization).

Repeated requests cause 403 Forbidden and `Action not permitted` error.

```
DELETE /v1/albums/{albumId}
```

Response:

Empty

## Upload media to an album

Requires [Authorization](/grindr-api/api-authorization).

Repeated requests with the same file (its contents) are skipped and a cached result from the first upload request is returned.

```
POST /v1/albums/{albumId}/content
```

Query:

- `width` — number, optional, doesn't affect the resulting image
- `height` — number, optional, doesn't affect the resulting image
- `isFresh` — boolean, optional; observed in decompiled Retrofit query, behavior not yet verified

Body:

Content-Type: multipart/form-data

- `content` — file to upload

Response:

- `contentId` — Media file ID
- `contentUrl` — `null`

## Reorder media in an album

Requires [Authorization](/grindr-api/api-authorization).

```
POST /v1/albums/{albumId}/content/order
```

Body:

- `contentIds` — array of long integers, each Media file ID must appear exactly once

## Delete media from an album

Requires [Authorization](/grindr-api/api-authorization).

Technically, this does not delete the media from CDN. All signed URLs will continue to work until expired. Uploading same file will result in getting it assigned the same `contentId`.

```
DELETE /v1/albums/{albumId}/content/{contentId}
```

Response:

Empty

## Album content processing status

Observed in decompiled app; behavior not yet verified.

```
GET /v1/albums/{albumId}/content/{contentId}/processing
```

Response:

- `processing` — boolean

## Limited photo status

Requires [Authorization](/grindr-api/api-authorization).

```
GET /v1/pics/limited/status
```

Response model: `UnlimitedPhotoStatusResponse`.

Response:

- `available` — integer
- `total` — integer

## Report expiring photo sent

Requires [Authorization](/grindr-api/api-authorization).

Observed in decompiled app; behavior not yet verified.

```
POST /v4/pics/expiring
```

Body model: `ExpiringPhotoReportSentRequest`.

Body:

- `count` — integer

Response model: `ExpiringPhotoStatusResponse`.

## Expiring photo status

Requires [Authorization](/grindr-api/api-authorization).

```
GET /v4/pics/expiring/status
```

Response model: `ExpiringPhotoStatusResponse`.

## Expiring video status

Requires [Authorization](/grindr-api/api-authorization).

```
GET /v4/videos/expiring/status
```

Response model: `PrivateVideoStatusResponse`

## Get album shares

Requires [Authorization](/grindr-api/api-authorization).

Returns profiles the album was shared with.

```
GET /v1/albums/{albumId}/shares
```

Response:

- `profileIds` — array of integers

## Share an album

Requires [Authorization](/grindr-api/api-authorization).

Automatically sends the shared album to chat with all listed profiles.

```
POST /v4/albums/{albumId}/shares
```

Body:

- `profiles` — array of objects
  - `expirationType` — [AlbumExpirationType](#albumexpirationtype)
  - `profileId` — integer

Response:

Empty

## Unshare an album

Requires [Authorization](/grindr-api/api-authorization).

```
PUT /v1/albums/{albumId}/unshares
```

Body:

- `profiles` — array of objects
  - `profileId` — long integer
  - `shareId` — unknown integer, can be `0`

Response:

Empty

## Unshare an album from everybody

Observed in decompiled app; behavior not yet verified. Previously observed requests returned 403.

```
PUT /v1/albums/{albumId}/shares/remove
```

## Albums content chat list-by-id

Observed in decompiled app; behavior not yet verified. Previously observed `{"ids":[852120758]}` returned 400.

```
POST /v1/albums/{albumId}/content/chat/list-by-id
```

Query:

- `isFresh` — boolean

Body:

- `ids` — array of long integers

## Get album limits

Requires [Authorization](/grindr-api/api-authorization).

```
GET /v1/albums/storage
```

*Interestingly, /v2/albums/storage appears to exist, though not used in current version of APK.*

Response:

- `subscriptionType` — string, e.g. `FreeAlbums`
- `maxAlbums` — integer
- `maxContentItemsPerAlbum` — integer
- `maxShares` — integer
- `maxViewableAlbums` — integer
- `maxViewableVideos` — integer
- `maxContentSize` — long integer, size in bytes
- `maxContentSizeHumanReadable` — string, incorrectly uses decimal multiples notation (MB) when in fact calculates binary notation (MiB), so API's `120.00 MB` is actually 120 MiB or 125.8291 MB
- `maxVideoLength` — long integer, length in milliseconds (1/1000th of a second)
- `minVideoLength` — long integer, length in milliseconds (1/1000th of a second)
- `maxShareableAlbums` — integer
- `maxVideosPerAlbum` — integer

## Albums red dot

Observed in decompiled app; behavior not yet verified. This may just be tracking but could also be related to something else.

```
PUT /v1/albums/red-dot
```

Response: 

Empty.

## Gets albums shared with us

Requires [Authorization](/grindr-api/api-authorization).

```
POST /v3/pressie-albums/feed
```

Body:

- `isFavorite` — boolean, optional, only albums shared by [favorite](/grindr-api/users/favorites) users
- `isOnline` — boolean, optional, only albums shared by currently online users
- `onlyVideo` — boolean, optional, only albums with at least one video
- `blur` — boolean, optional, blur media urls in response

Response:

- `profileFeeds` — array of objects
  - `profileId` — integer
  - `paywallStatus` — string, e.g. `ALLOW`
  - `seen` — boolean
  - `content` — object
  - `profile` — object
    - `profileId` — long integer
    - `name` — string, may be empty
    - `profileUrl` — string or `null`
    - `onlineUntil` — unknown or `null`
    - `distanceKm` — float or `null`
- `sharedAlbums` — array of objects
  - *everything from [AlbumPreview](#albumpreview)*
  - `albumViewable` — boolean
  - `albumVersion` — integer
  - `expiresat` — unix timestamp in milliseconds or `null` (observed key spelling; may also appear as `expiresAt`)
  - `name` — [Album name](#album-name)
  - `ownerProfileId` — integer
  - `imageCount` — integer
  - `videoCount` — integer
  - `coverContent` — object
    - `id` — long integer
    - `contentType` — string
    - `coverContent` — [AlbumCoverUrl](#albumcoverurl)
    - `status` — string, e.g. `ACTIVE`
  - `profile` — object
    - `profileId` — long integer
    - `name` — string, may be empty
    - `profileUrl` — string or `null`
    - `onlineUntil` — unknown or `null`
    - `distanceKm` — float or `null`
- `experimentStatus` — number
- `nonEmptyPersonalAlbumCount` — number
- `emptyAlbumId` — `null`

## Fresh pressie albums feed

Requires [Authorization](/grindr-api/api-authorization).

Observed in decompiled app; behavior not yet verified.

```
POST /v3/pressie-albums/fresh-feed
```

Body model: `AlbumsFeedPilterData`.

Body:

- `isFavorite` — boolean, optional
- `isOnline` — boolean, optional
- `onlyVideo` — boolean, optional
- `blur` — boolean, optional

Response model: `AlbumsFeedResponse`.

## Pressie albums feed paywall

Requires [Authorization](/grindr-api/api-authorization).

```
POST /v3/pressie-albums/feed/paywall/
```

Body models: `FreshPaywallContentRequest` or `SpankBankPaywallContentRequest`.

Body:

- `counterpartyId` — long integer or `null`, optional

Response models: `FreshPaywallContentResponse` or `SpankBankPaywallContentResponse`.

Response:

- `albumPaywallContent` — array of objects
  - `albumId` — long integer
  - `profile` — object
    - `profileId` — long integer
    - `name` — string, may be empty
    - `profileUrl` — string or `null`
    - `onlineUntil` — unknown or `null`
    - `distanceKm` — float or `null`
  - `paywallCoverUrl` — string, see [Media -> Signed CDN files](/grindr-api/media/signed-cdn-files)
  - `paywallUrls` — array of strings, see [Media -> Signed CDN files](/grindr-api/media/signed-cdn-files)
  - `albumsItemCount` — integer

## Pressie albums feed profile

Requires [Authorization](/grindr-api/api-authorization).

Observed in decompiled app; behavior not yet verified.

```
GET /v3/pressie-albums/feed/{profileId}
```

Response model: `SpankBankAlbumForProfileResponse`.

## Pressie albums feed update read

Requires [Authorization](/grindr-api/api-authorization).

Observed in decompiled app; behavior not yet verified.

```
POST /v3/pressie-albums/feed/update/read
```

Body model: `SpankBankAlbumViewedRequest`.

Body:

- `itemId` — long integer
- `itemType` — long integer
- `targetProfileId` — long integer

Response model: `Unit`.

Response:

Empty.
