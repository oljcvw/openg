# Spotify

## Get Spotify favorites for profile

Requires [Authorization](/grindr-api/api-authorization).

```
GET /v4/spotify/favorites/{profileId}
```

Path:

- `profileId` — string

Response: `SpotifyBackendResponse`

- `songIds` — array of Spotify track ID strings

## Post Spotify favorites

Requires [Authorization](/grindr-api/api-authorization).

```
POST /v4/spotify/favorites
```

Body: `SpotifyPostRequest`

- `songIds` — array of Spotify track ID strings

Response: `Unit`.

## Spotify token

Uses Spotify's token endpoint and a provider `Authorization` header, not `Authorization: Grindr3 ...`.

```
POST /api/token
```

Headers:

- `Authorization` — Spotify API authorization string

Body: URL-encoded form. The decompiled app has three variants:

- `refresh_token` — string
- `code` — string
- `redirect_uri` — string
- `grant_type` — string

Response: `SpotifyAuthResponse`

- `access_token` — string
- `refresh_token` — string
- `expires_in` — integer

## Search tracks

Uses Spotify API authorization, not `Authorization: Grindr3 ...`.

```
GET /v1/search
```

Headers:

- `Authorization` — Spotify API authorization string

Query:

- `q` — string
- `type` — string

Response: `SpotifySearchTrackResponse`

- `tracks` — `SpotifyTracks` object

## Get tracks

Uses Spotify API authorization, not `Authorization: Grindr3 ...`.

```
GET /v1/tracks
```

Headers:

- `Authorization` — Spotify API authorization string

Query:

- `ids` — comma-separated Spotify track IDs

Response: `SpotifyGetTrackResponse`

- `tracks` — array of `SpotifyTrack` objects

## Recently played tracks

Uses Spotify API authorization, not `Authorization: Grindr3 ...`.

```
GET /v1/me/player/recently-played
```

Headers:

- `Authorization` — Spotify API authorization string

Response: `SpotifyRecentlyPlayedResponse`

- `items` — array of `SpotifyPlayHistory` objects
