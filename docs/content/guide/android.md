# Android

Open Grind ships an Android target through Tauri. Keep Android work in the shared Svelte and Rust layers unless a change is specifically about Android packaging, permissions, or platform integration.

## Prerequisites

- Android Studio or the Android command line tools.
- JDK 17. Newer JDKs can fail Gradle or Android plugin analysis before the app compiles.
- `ANDROID_HOME` pointing at the Android SDK directory.
- An installed Android platform and build tools matching `compileSdk = 36`.
- An installed Android NDK. If the SDK contains multiple NDK versions, make sure each `ndk/<version>` directory has a top-level `source.properties` file so Tauri can discover it.
- Rust Android targets for the ABIs you plan to build. `bun run android:init` can install the default targets when run without `--skip-targets-install`; CI and this repo script skip that step so target installation remains explicit.

## Setup

Generate or refresh the checked-in Android project from the Tauri configuration:

```sh
bun run android:init
```

The Android target lives in `src-tauri/gen/android`. Most application behavior should stay in shared TypeScript and Rust code; edit generated Android files only for release packaging, manifest permissions, Gradle configuration, or native Android integration.

## Development

Run the Android app on a connected device or emulator:

```sh
bun run dev:android
```

The Android shell uses the same frontend build and Tauri capabilities as the desktop app. Runtime permissions for geolocation and notifications must be declared in `src-tauri/gen/android/app/src/main/AndroidManifest.xml` and kept aligned with `src-tauri/capabilities/default.json`.

The supported release ABI is currently `aarch64` (`arm64-v8a`). The Rust database dependency used by the shared storage layer does not compile for 32-bit Android ABIs, so release scripts intentionally avoid `armv7` and `i686`.

## Verification

Run the shared unit and Rust tests before preparing a release:

```sh
bun run test
```

Run the Android release-readiness gate when touching Android packaging:

```sh
bunx vitest run src/android-release.test.ts
```

## Release builds

Build release APK and AAB artifacts for the supported `aarch64` target:

```sh
bun run build:android
```

For local device testing without release minification, build a debug APK:

```sh
bun run build:android:debug
```

Release signing keys and credentials must stay out of the repository. Configure signing in the local Android/Gradle environment or release CI, then treat the signed APK/AAB as a release artifact rather than source.
