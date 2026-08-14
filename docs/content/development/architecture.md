# Tauri architecture

## Build and application shell

`src-tauri/tauri.conf.json` connects the static SvelteKit build to Tauri:
`bun run dev:web` serves development assets, `bun run build` produces `build/`,
and Tauri loads that output in the main WebView. The configuration also defines
the Content Security Policy, window floor, bundle metadata, and Android minimum
SDK.

`src-tauri/src/main.rs` calls `open_grind_lib::run()`. The builder in
`src-tauri/src/lib.rs` is the central composition root. It registers shared
dialog, clipboard, OS, geolocation, filesystem, and opener plugins; custom OAuth,
capture, notification, voice, call, and media-cache plugins; `AppState`; and the
complete command handler. It delays main-window creation so the project user
agent and navigation allowlist apply before any content loads.

## Frontend-to-native contract

Shared routes and components live under `src/routes` and `src/lib`. Frontend API
modules call Tauri commands rather than contacting the service directly:

- `src/lib/api/index.ts` owns generic request transport, MessagePack conversion,
  cancellation, coalescing, timeouts, and session generation;
- `src/lib/api/methods.ts` validates named command inputs and outputs with Zod;
- `src/lib/ws.svelte.ts` subscribes to Tauri events and sends realtime commands;
- `src/lib/platform` contains narrow OS decisions; and
- `src/lib/app-data`, `src/lib/albums`, `src/lib/chat`, and
  `src/lib/video-call` expose domain-facing adapters.

Treat Tauri command names, payload schemas, event names, custom protocol URLs,
and capability permissions as contracts. Change both sides together and test
observable behavior rather than private call order.

## Rust runtime and service transport

`src-tauri/src/state.rs` holds the client and API runtime. `api/runtime.rs`
centralizes request classes, timeouts, retries, circuit protection, cooldowns,
and runtime status. `api/rest.rs` implements cancellable REST requests;
`api/ws.rs` owns the foreground-aware realtime controller and emits WebSocket,
notification, Tap, and account events. Authentication and bounded upload
commands live beside them under `src-tauri/src/api`.

Cargo deliberately patches `grindr` through `src-tauri/patches/grindr`. Verify
that patch and editable dependency provenance before diagnosing transport or
identity behavior.

## Storage and media

`src-tauri/src/storage.rs` selects the credential backend by target. Small app
preferences and caches use scoped Tauri filesystem permissions. Large or private
media stays behind Rust-owned encrypted stores and the `album-cache:` and
`direct-media-cache:` custom protocols. Those protocols are explicitly present
in the CSP; broadening their origins or exposing credential paths to the WebView
changes the trust boundary.

Album presets and activation journals live in `api/album_presets.rs`. Album and
direct-media cache modules own metadata, pagination, limits, trimming, and
clearance. Keep user/account ownership explicit when extending them.

## Capabilities and navigation boundaries

- `capabilities/default.json` grants the main window scoped app-data, dialog,
  opener, OS, and clipboard operations while denying credential reads.
- `capabilities/mobile.json` adds mobile geolocation.
- `capabilities/android.json` adds Android picker/filesystem and voice access.
- `capabilities/google-oauth.json` gives the external OAuth window no Tauri
  permissions.

The CSP controls resource origins. `is_app_url` separately controls navigation.
Neither replaces command validation, capability scoping, or Rust-side ownership
checks.

## Native mobile adapters

Android adapters live in canonical Gradle/Kotlin project
`src-tauri/android`. iOS adapters and XcodeGen inputs live in `src-tauri/ios`.
Builds recreate ignored platform projects under `src-tauri/gen`. Both mobile tracks
connect to shared Rust commands for capture, voice, calls, notifications, and
realtime lifecycle. Operating-system permission, background, media, and UI
contracts remain native. Keep platform logic at these boundaries instead of
duplicating Svelte application.

## Demo and testing boundary

`PUBLIC_ENABLE_DEMO=1` routes supported requests to deterministic fixtures in
`src/lib/demo`; the Playwright Tauri shim in `e2e/support/app.ts` supplies browser
IPC and filesystem behavior. This is excellent for shared UI tests and safe
screenshots, but it is not proof of Kotlin plugins, device permissions,
credential stores, background work, signing, installation, or runtime acceptance.
