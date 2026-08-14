# iOS development and release

Open Grind includes a committed iPhone and iPad project targeting iOS and
iPadOS 17.5 or newer. Shared Tauri/Svelte/Rust application is paired with Swift
adapters for camera and short video, voice recording, Agora calls, periodic
notifications, connectivity observation, and Keychain storage.

## Build and test

Builds use repository Nix wrappers plus host-installed Xcode. Default invocation
is unsigned debug simulator evidence; signed candidate invocations require Apple
team/provisioning authority and are verified after build:

```sh
nix --extra-experimental-features 'nix-command flakes' run .#build-ios
nix --extra-experimental-features 'nix-command flakes' run .#build-ios -- \
  --target aarch64 --no-sign --archive-only --ci
```

Run native contract tests on a uniquely identified simulator:

```sh
xcrun simctl list devices available
nix --extra-experimental-features 'nix-command flakes' run .#test-ios -- \
  <SIMULATOR_UDID>
```

Generated artifacts under `src-tauri/gen/apple/build/` are disposable until
copied to controlled storage with source revision, dirty-state disclosure,
toolchain identity, build log, and digest.

## Evidence states

Keep these states separate:

1. Simulator build, installation, and launch.
2. Arm64 device compilation.
3. Archive-ready output.
4. Correctly signed app and nested frameworks.
5. Exported TestFlight candidate.
6. Uploaded and processed build.
7. Internal tester installation on iPhone and iPad.
8. App Store compliance readiness.
9. Submitted, approved, and publicly released application.

Earlier state never proves later one. Signed builds can update Apple
provisioning and require explicit authority. Upload, tester assignment, App
Store submission, and release each require separate authority.

## Platform-specific behavior

- Google sign-in uses manual OAuth token paste.
- Notifications are periodic and best effort; guaranteed remote push is not
  claimed.
- Voice recording is canceled when app enters background.
- Active video calls end when app enters background or audio session is
  interrupted.
- Video calls require configured Agora application identifier.
- Location permission is requested only when user chooses device location.

## Complete operational runbook

Repository maintainers should follow
[full iOS release-preparation runbook](https://git.opengrind.org/open-grind/open-grind/src/branch/main/docs/ios-release.md).
It defines signing prerequisites, artifact inspection, iPhone and iPad parity,
privacy-manifest evidence, export compliance, TestFlight handling, App Store
review material, and current external gates. This rendered page is overview;
repository runbook is operational checklist.
