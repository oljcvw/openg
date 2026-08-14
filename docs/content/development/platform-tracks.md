# Platform tracks

Shared Tauri construction is default. Platform branches exist at capability
boundaries, not as duplicate application stacks.

## Android native track

`src-tauri/gen/android` is committed project source. Its Kotlin layer provides:

- Android Storage Access Framework media selection;
- companion-app Google OAuth;
- CameraX photo and short-video capture;
- MediaRecorder voice recording;
- Agora video-call activity and foreground service;
- WorkManager periodic notification polling; and
- network lifecycle, routing, insets, keyboard, back, and wake-lock bridges.

Rust custom plugins call these adapters through `run_mobile_plugin_async`.
Android has the mature reproducible APK, CI, signing, and F-Droid release path.

## iOS and iPadOS native track

`src-tauri/gen/apple` is a committed Xcode project for iPhone and iPad.
`src-tauri/ios` contains Swift Package adapters for:

- camera photos and short videos;
- voice recording;
- Agora video calls;
- local notifications and best-effort background refresh;
- realtime network observation; and
- Keychain-backed secrets.

Rust registers these through Tauri iOS plugin bindings. Nix exposes simulator
and device builds plus simulator native-contract tests. Signing, TestFlight
upload, tester assignment, App Review, and public release remain separate
authority and evidence gates.

## OAuth tracks

Android launches a separately distributed companion app and supports manual
token paste because its system WebView cannot host the required Google flow.
iOS and iPadOS use manual token paste. macOS, Windows, and Linux use an embedded
web OAuth helper; Windows also cleans a per-attempt WebView2 data directory. The
OAuth WebView has no Tauri capabilities.

## Media and device APIs

Android uses native Storage Access Framework media selection. iOS and desktop
targets use shared Tauri dialog and filesystem plugins. Demo mode uses a browser
input. Camera capture, short-video
recording, voice recording, video calls, and periodic notifications are mobile
capabilities and report unsupported on desktop. Device geolocation is exposed
on Android and iOS.

## Credential stores

| Target                    | Backend                                                                   |
| ------------------------- | ------------------------------------------------------------------------- |
| Android                   | Android Keystore-backed store                                             |
| iOS and iPadOS            | Apple Keychain through committed native project                           |
| macOS development         | Protected app-data files, avoiding unsigned-build Keychain identity churn |
| Signed macOS distribution | Apple Keychain when built with `keychain` Cargo feature                   |
| Windows                   | Windows Credential Manager                                                |
| Linux                     | Secret Service; protected app-data files when unavailable                 |

## WebView and layout tracks

Windows warns below WebView2 111; Linux warns below WebKitGTK 2.42; Android has
matching Chromium floor in Gradle/native code. Android owns extra IME, safe
inset, predictive-back, deep-link, and wake-lock behavior. iOS owns UIKit
permission, audio-session, background, and iPhone/iPad layout contracts. Desktop
uses Web Wake Lock when available.

## Evidence levels

- Android has committed native project plus pinned Nix/Docker, Forgejo CI,
  reproducibility, signing, and F-Droid paths.
- iOS has committed Apple project and Swift adapters plus Nix build/test and
  signing/TestFlight-preparation workflows. No current durable signed IPA,
  physical-device acceptance, upload, TestFlight, App Review, or public-release
  receipt was found.
- macOS now has a Nix-owned signed app-bundle build and signature-verification
  path. Notarization, installation, and runtime acceptance remain unverified.
- Windows and Linux have shared source and runtime provisions but no complete
  project-owned release automation was found.

Never turn source, configuration, icons, or compilation into a release claim.
Report source, build, packaged artifact, signing, device acceptance, publication,
and public release separately.
