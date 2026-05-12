# Open Grind

[![Matrix space](https://img.shields.io/matrix/opengrind:opengrind.org?server_fqdn=matrix.opengrind.org&fetchMode=summary&label=matrix%20space)](https://matrix.to/#/#opengrind:opengrind.org) [![chat](https://img.shields.io/matrix/general:opengrind.org?server_fqdn=matrix.opengrind.org&fetchMode=summary&label=chat)](https://matrix.to/#/#general:opengrind.org) [![Announcements](https://img.shields.io/matrix/announcements:opengrind.org?server_fqdn=matrix.opengrind.org&fetchMode=summary&label=announcements)](https://matrix.to/#/#announcements:opengrind.org)

Unofficial Grindr client. Crossplatform, free, libre, ad-free, tracker-free, privacy-centered and community-driven.

Status as of 7th May, 2026: **🚧 MVP 🚧**, only the most basic features are implemented. [More information...](https://git.opengrind.org/open-grind/open-grind/milestones)

## Usage

Download the latest version from [releases](https://git.opengrind.org/open-grind/open-grind/releases).

## Building from source

Install [Bun](https://bun.sh/), [Rust](https://www.rust-lang.org/tools/install), and the [Tauri prerequisites](https://tauri.app/start/prerequisites/) for your operating system, then install dependencies:

```sh
bun install --frozen-lockfile
```

Supported source-build targets in this checkout are:

| Target | Command | Output |
| --- | --- | --- |
| Web/static frontend | `bun run build` | `build/` |
| Android debug APK | `bun run build:android:debug` | `src-tauri/gen/android/app/build/outputs/apk/` |
| Android release APK/AAB | `bun run build:android` | `src-tauri/gen/android/app/build/outputs/` |
| macOS unsigned app/DMG | `bun run build:macos` | `src-tauri/target/universal-apple-darwin/release/bundle/` |
| macOS signed app/DMG | `bun run build:macos:signed` | `src-tauri/target/universal-apple-darwin/release/bundle/` |

Desktop packages should be built on the target operating system. Android builds require the Android SDK, NDK, JDK 17, and Android Rust targets; see [Android packaging](./docs/content/guide/android.md). macOS release packages require the universal macOS Rust targets and signing/notarization setup; see [macOS packaging](./docs/content/guide/macos.md). The iOS target is not generated or committed in this checkout.

## Development

Interested in contributing to the project? Head to [CONTRIBUTING.md](./CONTRIBUTING.md) to get started. All contributions must be aligned with [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md).

## Problems, bugs, feature requests?

Check out [issues](https://git.opengrind.org/open-grind/open-grind/issues) and the Matrix chatroom [#opengrind:opengrind.org](https://matrix.to/#/#opengrind:opengrind.org).

## License

[MIT](./LICENSE)

## Donate

See [FUNDING.md](./FUNDING.md)
