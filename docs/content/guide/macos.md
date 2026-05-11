# macOS

Open Grind ships a macOS desktop app through Tauri. Keep app behavior in the shared Svelte and Rust layers; macOS-specific files should only cover packaging, signing, notarization, or native desktop integration.

## Prerequisites

- Xcode command line tools.
- Rust targets for universal macOS builds:

```sh
rustup target add aarch64-apple-darwin x86_64-apple-darwin
```

- A Developer ID Application certificate for signed public distribution.
- Apple notarization credentials if you are creating a public release.

## Development

Run the macOS app locally:

```sh
bun run dev:macos
```

This uses the same Tauri desktop shell as `bun run dev:desktop`.

## Local package validation

Build unsigned universal `.app` and `.dmg` artifacts:

```sh
bun run build:macos
```

`bun run build:macos` delegates to `bun run build:macos:unsigned`. Unsigned artifacts are useful for validating bundle structure, Info.plist metadata, icons, and release packaging without requiring private signing credentials.

For a quicker debug `.app` bundle:

```sh
bun run build:macos:debug
```

Inspect the generated app bundle:

```sh
plutil -p "src-tauri/target/universal-apple-darwin/release/bundle/macos/Open Grind.app/Contents/Info.plist"
codesign -dvvv --entitlements :- "src-tauri/target/universal-apple-darwin/release/bundle/macos/Open Grind.app"
spctl -a -vv "src-tauri/target/universal-apple-darwin/release/bundle/macos/Open Grind.app"
```

For unsigned local builds, `spctl` rejection is expected. Treat that as a distribution signing state, not a compile or packaging failure.

## Signed release builds

Build signed universal `.app` and `.dmg` artifacts:

```sh
APPLE_SIGNING_IDENTITY="Developer ID Application: Example Team (TEAMID)" bun run build:macos:signed
```

Do not commit signing identities, keychains, app-specific passwords, API keys, or notarization credentials. Keep them in the local shell environment or release CI secret store.

Tauri can notarize during the signed build when Apple credentials are available. Use either an Apple ID/app-specific password:

```sh
export APPLE_ID="release@example.com"
export APPLE_PASSWORD="app-specific-password"
export APPLE_TEAM_ID="TEAMID"
```

Or App Store Connect API credentials:

```sh
export APPLE_API_ISSUER="issuer-uuid"
export APPLE_API_KEY="key-id"
export APPLE_API_KEY_PATH="/secure/path/AuthKey_key-id.p8"
```

The first notarization for a new app can take longer. If CI needs to submit without waiting for stapling, use Tauri's `--skip-stapling` flag intentionally and staple before publishing.

```sh
xcrun stapler validate "src-tauri/target/universal-apple-darwin/release/bundle/macos/Open Grind.app"
```

## Release checklist

1. Run `bun run test`.
2. Run `bun run check`.
3. Run `bun run --cwd docs build`.
4. Run `bun run build:macos` for unsigned package validation.
5. Inspect the generated `Open Grind.app` with `plutil`, `codesign`, and `spctl`.
6. Run `bun run build:macos:signed` from an environment with Developer ID Application signing and notarization credentials.
7. Confirm the signed artifact is notarized and stapled before publishing.

The macOS entitlements file is intentionally minimal. Open Grind is not sandboxed for direct distribution, and broad sandbox-only entitlements such as `com.apple.security.app-sandbox` or file access exceptions should not be added unless the distribution target changes.
