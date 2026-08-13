# Application and service identifiers

This inventory is pinned to Grindr Android `26.13.0` (`170510`). It records
public application identifiers and routing codes useful when comparing later
APKs. It does not make these identifiers Open Grind configuration, and static
presence does not prove that a remotely controlled integration is active.

Source paths are relative to
`.local/reference/grindr-26.13.0-170510/`. Values that can authorize requests,
identify a private runtime session, or act as credentials are deliberately
redacted.

## App and build identity

| Identifier             | Value                   | Confirmed source                                                                                                                 |
| ---------------------- | ----------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Android package        | `com.grindrapp.android` | `apktool/base/AndroidManifest.xml:2`; `jadx-src-nores/sources/com/grindrapp/android/platform/config/AppConfiguration.java:71,79` |
| Version name           | `26.13.0`               | `apktool/base/apktool.yml:10`                                                                                                    |
| Version code           | `170510`                | `apktool/base/apktool.yml:11`                                                                                                    |
| Composite app version  | `26.13.0.170510`        | `jadx-src-nores/sources/com/grindrapp/android/platform/config/AppConfiguration.java:71,79`                                       |
| Compile SDK / platform | `36` / Android `16`     | `apktool/base/AndroidManifest.xml:2`                                                                                             |

## Agora video calling

| Identifier               | Value                              | Meaning                                                                                                | Confirmed source                                                                                                                                                             |
| ------------------------ | ---------------------------------- | ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Agora App ID             | `fb9ba023bdf9430b8f75856a1bb011b9` | Public SDK application identifier assigned to `RtcEngineConfig.mAppId`                                 | `jadx-src-nores/sources/p000/C16031dt.java:61-69`; duplicate app configuration at `jadx-src-nores/sources/com/grindrapp/android/platform/config/AppConfiguration.java:71,79` |
| Area-code literal        | `-2`                               | Value assigned to `RtcEngineConfig.mAreaCode`; exact semantic mapping is not established from this APK | `jadx-src-nores/sources/p000/C16031dt.java:70`                                                                                                                               |
| Channel-profile code     | `1`                                | Value passed to `setChannelProfile`                                                                    | `jadx-src-nores/sources/p000/C16031dt.java:72`                                                                                                                               |
| Local UID preference key | `pOCXx_uid`                        | Stores the integer UID used by the SDK join call; the stored value is device/runtime data              | `jadx-src-nores/sources/p000/C16031dt.java:52,106-117`                                                                                                                       |
| Join info string         | `OpenLive`                         | Static optional-info argument passed to `joinChannel`                                                  | `jadx-src-nores/sources/p000/C16031dt.java:106-117`                                                                                                                          |

Agora channel IDs and access tokens are not application identifiers. They are
issued by the backend in create/join call responses and then passed into
`joinChannel`. Token values are credentials and must not be logged or copied.
The flow is confirmed in
`jadx-src-nores/sources/com/grindrapp/android/chat/api/model/CreateVideoCallResponse.java:21-29,77-100,107-108,127-134,137-163`,
`jadx-src-nores/sources/com/grindrapp/android/chat/api/model/JoinVideoCallResponse.java:18-22,59-69,118,136,159-163`,
`jadx-src-nores/sources/com/grindrapp/android/chat/videocall/api/VideoCallRestService.java:23-36`,
and `jadx-src-nores/sources/p000/C16031dt.java:106-117`.

## Google, Firebase, and Facebook

| Identifier                              | Value                                                                       | Confirmed source                                                                               |
| --------------------------------------- | --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Firebase project number / FCM sender ID | `1036042917246`                                                             | `apktool/base/res/values/strings.xml:1557`                                                     |
| Firebase project ID                     | `api-project-1036042917246`                                                 | `apktool/base/res/values/strings.xml:2525`                                                     |
| Firebase Android app ID                 | `1:1036042917246:android:93d3725a6ad2a74d`                                  | `apktool/base/res/values/strings.xml:1592`                                                     |
| Firebase Realtime Database              | `https://api-project-1036042917246.firebaseio.com`                          | `apktool/base/res/values/strings.xml:1521`                                                     |
| Firebase Storage bucket                 | `api-project-1036042917246.appspot.com`                                     | `apktool/base/res/values/strings.xml:1593`                                                     |
| Google OAuth server client ID           | `1036042917246-68g7siev1clho9lhqevahao9hlbpvssf.apps.googleusercontent.com` | `jadx-src-nores/sources/com/grindrapp/android/platform/config/AppConfiguration.java:71,79`     |
| Google Mobile Ads app ID                | `ca-app-pub-5159203815434572~6728321268`                                    | `apktool/base/AndroidManifest.xml:143`                                                         |
| Facebook app ID                         | `1273378622718674`                                                          | `apktool/base/res/values/strings.xml:1485`; consumed at `apktool/base/AndroidManifest.xml:150` |
| Facebook callback scheme                | `fb1273378622718674`                                                        | `apktool/base/AndroidManifest.xml:484`                                                         |

Google general and Maps API keys and the Facebook client token are present in
the pinned configuration but are credential-like values. Their values are
redacted. Source fields: `google_api_key` at
`apktool/base/res/values/strings.xml:1591`, Maps metadata at
`apktool/base/AndroidManifest.xml:158`, and Facebook client-token metadata at
`apktool/base/AndroidManifest.xml:151`.

## Other integrations

| Integration  | Public identifier or route                                                                      | Confirmed source                                                                           |
| ------------ | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| AppsFlyer    | Invite channel `GrindrAndroidInvitation`; OneLink codes `Wchr` and `8CMO`                       | `jadx-src-nores/sources/p000/o70.java:11,18-20`                                            |
| Sift         | Account ID `60ba79159ad8302642067c3c`                                                           | `jadx-src-nores/sources/p000/q70.java:11,18-20`                                            |
| Spotify      | OAuth client ID `9302e16d54b84b3e977dcf0ba54914e6`; callback `com.grindrapp.android://callback` | `jadx-src-nores/sources/p000/r70.java:11,18-20`                                            |
| DoubleVerify | OMID partner `doubleverify.com-omid`; AppLovin tag `DV1860463`; GAM tag `DV2144608`             | `jadx-src-nores/sources/p000/p70.java:11,18-20`                                            |
| DoubleVerify | Script `https://cdn.doubleverify.com/dvtp_src.js`                                               | `jadx-src-nores/sources/p000/p70.java:11,18-20`                                            |
| Braze        | Custom endpoint `gaspra.iad-03.braze.com`                                                       | `apktool/base/res/values/strings.xml:992`                                                  |
| Help Center  | Profile-insights ticket form `360006692913`                                                     | `jadx-src-nores/sources/com/grindrapp/android/platform/config/AppConfiguration.java:71,79` |

Credential-like AppsFlyer developer, Sift beacon, Spotify encoded client,
Braze, Giphy, Bugsnag, and reCAPTCHA values are redacted. Their field locations
are respectively `jadx-src-nores/sources/p000/o70.java:11,19`,
`jadx-src-nores/sources/p000/q70.java:11,19`,
`jadx-src-nores/sources/p000/r70.java:11,19`,
`apktool/base/res/values/strings.xml:991`, and
`jadx-src-nores/sources/com/grindrapp/android/platform/config/AppConfiguration.java:71,79`.

No Sentry DSN, OneSignal app ID, Adjust app token, or Mapbox public token was
located in the pinned app-owned configuration scan. This is a bounded negative
result, not proof of absence from every bundled third-party component or remote
configuration.

## Service hosts

The app's network construction groups these static bases at
`jadx-src-nores/sources/p000/gh0.java:184-189`:

| Service                | Base URL                        |
| ---------------------- | ------------------------------- |
| Main REST API          | `https://grindr.mobi/`          |
| Public/media CDN roles | `https://cdns.grindr.com:443`   |
| Presence WebSocket     | `wss://presence.grindr.com:443` |
| Spotify API            | `https://api.spotify.com/`      |
| Spotify accounts       | `https://accounts.spotify.com/` |
| Giphy API              | `https://api.giphy.com`         |
| Atlassian              | `https://grindr.atlassian.net/` |

Other static first-party routes include CAPTCHA at
`https://captcha-prod.grindr.com/android.html`
(`jadx-src-nores/sources/p000/af1.java:139`), ban appeal at
`https://web.grindr.com/ban-appeal` and support chat at
`https://web.grindr.com/support-chat`
(`jadx-src-nores/sources/com/grindrapp/android/platform/config/AppConfiguration.java:71,79`;
`jadx-src-nores/sources/p000/f65.java:99`).

## Deep-link identifiers

| Route                                                                                   | Confirmed source                                                                                   |
| --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `grindr://`                                                                             | `apktool/base/AndroidManifest.xml:385-391`                                                         |
| `https://www.grindr.com/auth`, `https://grindr.com/auth`, `https://hub.grindr.com/auth` | `apktool/base/AndroidManifest.xml:362-372`                                                         |
| `https://hub.grindr.com/blog`                                                           | `apktool/base/AndroidManifest.xml:392-399`                                                         |
| `https://grindr.onelink.me`                                                             | `apktool/base/AndroidManifest.xml:400-405`; template at `jadx-src-nores/sources/p000/cq2.java:166` |
| `/content-hub` on `www.grindr.com`, `grindr.com`, and `hub.grindr.com`                  | `apktool/base/AndroidManifest.xml:406-415`                                                         |
| `fb1273378622718674://` and `fbconnect://cct.com.grindrapp.android`                     | `apktool/base/AndroidManifest.xml:478-490`                                                         |

## Evidence limits

JADX completed `40488/40491` classes and reported 972 decompilation errors.
Apktool decoded all APKs but reported unresolved resource references. This
inventory therefore means “confirmed in emitted static source/configuration,”
not “complete native/runtime configuration.” No APK was installed, no account
was used, and no service request was made.
