# Development workflow

## Setup

Use Bun and the Rust toolchain pinned by the repository. Install JavaScript
dependencies without changing the lockfile:

```sh
bun ci
```

Common commands:

```sh
bun run dev:desktop
bun run dev:android
bun run build
bun run lint
bun run check
bun run test
bun run test:e2e
```

`bun run test` runs unit tests and Rust library tests. Browser E2E tests use
deterministic demo data and a Tauri shim. Native Android behavior still requires
an exact APK, selected device, permissions, and device-bound evidence.

## Android construction

Use the committed Android project for routine development. Do not run
`tauri android init` unless the project is genuinely missing; initialization can
replace reviewed native resources. Generate canonical icons after intentional
regeneration.

The reproducible Android path is:

```sh
nix run .#build-android
```

`OPEN_GRIND_ANDROID_ABI` selects a diagnostic single-ABI build;
`OPEN_GRIND_KEYSTORE_PROPERTIES` supplies signing configuration to the Nix path.
A single ABI, unsigned build, host check, or successful compilation is not the
universal signed release artifact. Follow `BUILDING.md` for exact provenance,
signing, and content verification.

## iOS and iPadOS construction

iOS development requires macOS, host-installed Xcode, and repository Nix
wrappers. Build an unsigned simulator app with:

```sh
nix --extra-experimental-features 'nix-command flakes' run .#build-ios
```

Run native contract tests against an identified simulator UDID:

```sh
xcrun simctl list devices available
nix --extra-experimental-features 'nix-command flakes' run .#test-ios -- \
  <SIMULATOR_UDID>
```

Simulator compilation does not prove device installation, signing, TestFlight,
or App Store acceptance. See [iOS development and release](/development/ios-release)
for toolchain, signing, artifact, device-parity, privacy, and authority gates.

## Quality gates

Before review, run the repository-required gates:

```sh
bun run lint
bun run check
bun run test
```

Run `bun run test:e2e` when browser/user workflows are affected. Add tests for
behavior, public contracts, state changes, validation, permissions, and recovery;
do not pin private choreography, incidental markup, exact prose, or screenshots.

## Documentation

The docs site lives under `docs/`. User and developer prose is canonical under
`docs/content`; the upstream API source is `docs/lib/openapi.json`, and generated
API pages must not be edited directly.

```sh
bun run --cwd docs validate
bun run --cwd docs audit:openapi
bun run --cwd docs audit:coverage
bun run --cwd docs audit:queries
bun run --cwd docs audit:links
bun run --cwd docs build
```

The build regenerates API Markdown and `docs/lib/index.ts`; inspect the resulting
diff. Screenshots must use controlled/demo data unless native behavior is the
claim. Never capture personal profiles, messages, photos, tokens, or coordinates.

## Contribution and release boundaries

Follow `CONTRIBUTING.md` for branch, fork, signed-commit, review, and disclosure
requirements. Follow `SECURITY.md` for private vulnerability reports. A commit
does not authorize push, publication, deployment, tag, signing, or release.
