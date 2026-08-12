# iOS release preparation

This runbook separates engineering build success from signing, upload,
TestFlight processing, internal testing, and public App Store submission. Passing
an earlier state does not imply any later state.

## Supported product

- Universal application identifier: `doctor.andrewcox.opengrind`
- Devices: iPhone and iPad (`UIDeviceFamily` 1 and 2)
- Minimum OS: iOS/iPadOS 17.5
- Shared application: Tauri/Svelte frontend and Rust backend
- Native iOS adapters: camera and short video, voice recording, Agora calls,
  notifications/background refresh, connectivity observation, and Keychain-backed
  secrets
- Notification limit: local notification and best-effort background refresh;
  guaranteed real-time remote push is not claimed

## State model

| State | Required evidence |
| --- | --- |
| Simulator build | Fresh `arm64-sim/Open Grind.app`; install and launch on both iPhone and iPad simulators |
| Device compilation | Fresh arm64 iPhoneOS app/IPA with `MinimumOSVersion=17.5`; unsigned output is not installable |
| Archive-ready | Fresh release `.xcarchive` with correct bundle ID, versions, device family, usage strings, embedded frameworks, and no release-link errors |
| Signed | App and every nested framework pass `codesign --verify --deep --strict`; archive records Apple Distribution identity and team |
| TestFlight-ready | Signed IPA exported using `release-testing`, with matching App Store provisioning and unique build number |
| Uploaded | Transport receipt identifies exact uploaded bundle ID, version, build, and artifact digest |
| Internal TestFlight accepted | Apple processing succeeds and authorized internal testers can install exact build on iPhone and iPad |
| App Store-ready | Technical archive plus completed privacy, encryption, third-party SDK, account, content, and review-material gates below |
| Submitted/approved/released | Separate external decisions; never inferred from archive or TestFlight success |

## Canonical build path

All repository builds use Nix. Xcode itself and Apple signing material remain
host-managed:

```sh
xcode-select -p
xcodebuild -version
xcrun --sdk iphoneos --show-sdk-version

nix --extra-experimental-features 'nix-command flakes' run .#build-ios
nix --extra-experimental-features 'nix-command flakes' run .#build-ios -- \
  --target aarch64 --no-sign --archive-only --ci
```

Default command intentionally produces unsigned debug simulator app. Arguments
after `--` pass directly to `tauri ios build`. Build wrapper performs `bun ci`,
checks selected Xcode and iPhoneOS SDK, verifies initialized submodules, and then
runs frontend, Rust, SwiftPM, and Xcode build stages.

Run native contract tests on an installed simulator by UDID through the
dedicated Nix wrapper:

```sh
xcrun simctl list devices available
nix --extra-experimental-features 'nix-command flakes' run .#test-ios -- \
  <SIMULATOR_UDID>
```

The wrapper uses the generated `open-grind_iOSTests` scheme, excluding the
application target's Tauri build phase. It removes Nix compiler-wrapper
variables before invoking host Xcode; leaving those variables set corrupts
XCTest linker arguments. Simulator names are intentionally unsupported because
duplicate names can exist across installed runtimes.

Do not apply signed-artifact verification to this `--no-sign` simulator output.
Its app executable has only Xcode's linker ad-hoc signature, which does not bind
`Info.plist` or seal app resources; `codesign --verify --deep --strict` therefore
fails by design. Simulator evidence is successful install, launch, and runtime
behavior on identified devices. Strict code-sign verification remains mandatory
for signed device and TestFlight artifacts.

Generated outputs live below `src-tauri/gen/apple/build/` and must not be treated
as durable release evidence until copied to controlled artifact storage with
digest, source commit, dirty-state disclosure, toolchain identity, and build log.

## Signing prerequisites

Before signed build, verify without printing private key material:

```sh
security find-identity -v -p codesigning
xcodebuild -project src-tauri/gen/apple/open-grind.xcodeproj \
  -scheme open-grind_iOS -showBuildSettings | \
  grep -E 'DEVELOPMENT_TEAM|PRODUCT_BUNDLE_IDENTIFIER|CODE_SIGN_STYLE'
```

Required:

- Apple Developer Program team authorized for `doctor.andrewcox.opengrind`
- valid Apple Distribution certificate with accessible private key
- App Store provisioning/profile selection for same bundle identifier and team
- unique, monotonically increasing `CFBundleVersion`
- resolved ownership and authorization for app name, bundle ID, service access,
  privacy answers, export compliance, contracts, and distribution

Do not store certificates, private keys, passwords, session cookies, API keys,
provisioning secrets, or App Store Connect credentials in Git or build logs.
CI should import short-lived signing material into an isolated temporary keychain,
restrict access to protected release jobs, and destroy that keychain after build.

## Signed TestFlight export

With prerequisites present:

```sh
OPEN_GRIND_ALLOW_PROVISIONING_UPDATES=1 \
APPLE_DEVELOPMENT_TEAM=<AUTHORIZED_TEAM_ID> \
  nix --extra-experimental-features 'nix-command flakes' run .#build-ios -- \
  --target aarch64 \
  --build-number <UNUSED_BUILD_NUMBER> \
  --export-method release-testing \
  --ci
```

Tauri invokes Xcode with managed-provisioning updates for signed builds. The two
environment variables acknowledge explicit authority for that Apple Developer
portal mutation and identify its authorized team. Do not set them for ordinary
build verification. This command may read local signing credentials, create or
update provisioning state, and produce signed local artifacts. It does not grant
authority to upload. Before any upload, record:

- source commit and whether worktree was dirty
- Xcode build and SDK version
- bundle ID, marketing version, build number, minimum OS, and device family
- SHA-256 digest and path of exported IPA
- signing certificate SHA-256 fingerprint and team identifier (not private key)
- provisioning profile UUID/name/expiration and entitled application identifier
- `codesign` verification for app and every nested executable/framework
- automated-check results and physical-device parity results

Upload only after explicit authorization for App Store Connect mutation. Preserve
Transporter or API receipt, processing result, export-compliance result, and
internal tester assignment as distinct evidence.

## Artifact inspection

Use a temporary extraction directory; do not edit package contents:

```sh
tmpdir="$(mktemp -d)"
unzip -q path/to/Open-Grind.ipa -d "$tmpdir"
app="$tmpdir/Payload/Open Grind.app"

plutil -p "$app/Info.plist"
xcrun vtool -show-build "$app/Open Grind"
codesign --verify --deep --strict --verbose=4 "$app"
codesign -d --entitlements :- "$app"
shasum -a 256 path/to/Open-Grind.ipa
```

Confirm nested Agora frameworks carry same intended distribution team signature,
not ad-hoc signatures. Confirm archive contains no development-only entitlement,
unexpected writable secret, personal test data, or private log artifact.

## Physical-device parity matrix

Run against exact signed candidate on at least one iPhone and one iPad. Include an
iOS/iPadOS 17.5 or later device or runtime.

| Area | Required outcome |
| --- | --- |
| Install/launch | Installs and cold-launches; foreground/background/terminate/relaunch preserve correct session state |
| Authentication | Supported login, logout, expiry/refresh, failed login, and account switch behave without cross-account state |
| Keychain/privacy | Session, device identity, media signing key, and cache keys persist/revoke as designed; no plaintext secret fallback |
| Messaging/albums/account | Send/receive, reconnect, pagination, albums, profile/account edits, block/unblock, logout, and destructive confirmation paths match shared contracts |
| Location | Purpose prompt occurs only on user action; allow/deny/restricted paths remain usable and scoped |
| Photo/video | Allow/deny camera and microphone; capture, cancel, retake, short-video cache, upload, cleanup, and account switching work |
| Voice | Record, cancel, stop, playback/upload, denied permission, and cleanup work; app background silently cancels native recording, while an audio-session interruption cancels it and reports `recording-error` |
| Video calls | Incoming/outgoing, camera/mic permissions, join/leave, token renewal, remote departure, and network errors work with configured Agora ID; moving iOS to background ends the call as `app-backgrounded`, and an audio-session interruption ends it as `audio-interrupted`, with camera/engine cleanup |
| Notifications | Authorization states, local display, tap routing, badge/cleanup, foreground behavior, and best-effort refresh work without remote-push claim |
| Network/lifecycle | Offline starts fail closed; offline/online transitions reconnect; suspend/resume avoids duplicate workers and stale-account delivery |
| iPad UI | Portrait/landscape, sheets/popovers, keyboard, camera, call layout, and media viewers remain usable without clipping or phone-only assumptions |

Use accounts and devices owned by tester. Redact profile IDs, messages, media,
location, tokens, and device identifiers from retained evidence.

## App Store compliance dossier

Engineering can prepare evidence; qualified project owners must approve legal,
policy, branding, service, and privacy representations.

### Required-reason API evidence

`src-tauri/PrivacyInfo.xcprivacy` covers app-owned calls visible in current
release binary. Re-run audit whenever native code, Rust dependencies, Xcode, or
embedded SDKs change.

| Category | Reason | Current app-owned use |
| --- | --- | --- |
| File timestamp | `C617.1` | Update/read metadata for encrypted media-cache files inside app container |
| System boot time | `35F9.1` | Measure elapsed voice-recording time and drive timer behavior |
| Disk space | `E174.1` | Check available local capacity before storing album-preset media and return observable insufficient-space behavior |
| User defaults | `CA92.1` | Persist app-only notification and best-effort refresh preferences |

Agora ships its own framework privacy manifest. App manifest must not be used to
cover undeclared required-reason access inside another dynamic framework.

Required-reason declarations are distinct from collected-data declarations.
Before distribution, project owner must reconcile data sent through Open Grind,
Grindr service behavior, and Agora behavior; decide linked/tracking status and
approved purposes; then update app manifest and App Store Connect answers from
same evidence. Empty or omitted collected-data declarations are not evidence
that app or its partners collect no data.

- App privacy answers map each collected/linked/tracked data category to actual
  code and third-party SDK behavior, including Grindr service and Agora traffic.
- Privacy policy and in-app disclosures cover account data, precise location,
  contacts if any, messages/media, diagnostics, retention/deletion, and processors.
- App `PrivacyInfo.xcprivacy` declares app-owned file-timestamp, system-uptime,
  disk-space, and app-local UserDefaults access. Revalidate these declarations
  against final binary and every third-party SDK manifest.
- Export-compliance answer reflects actual cryptography: TLS, Keychain, P-256
  request signing, and AES-GCM local cache encryption. Legal owner decides any
  exemption/classification.
- Agora 4.6.2 privacy manifest, license, signatures, and vendor disclosures are
  reviewed for final SDK contents.
- Review notes do not claim background camera operation. iOS ends an active video
  call when the app enters background because current app capabilities do not
  authorize a background-camera contract.
- Account creation, account deletion, moderation/reporting, objectionable-content,
  age rating, and reviewer-access paths are documented and functional.
- App name, icons, screenshots, description, support URL, privacy URL, copyright,
  and use of third-party service names/branding have owner approval.
- Review notes clearly describe noncommercial client status, login method,
  camera/microphone/location purposes, local-notification limitation, and any
  reviewer account or backend dependency.
- Accessibility, localization, IPv6-only networking, offline/error recovery,
  battery/background behavior, and crash-free physical-device results are recorded.

Public submission remains blocked until every policy item has named owner,
evidence, and explicit disposition. Internal TestFlight engineering completion
does not imply App Review eligibility or approval.

## Current known gates

Do not replace this section with optimistic language. At time of each release
candidate, refresh it from live evidence:

- local Apple Distribution identity and App Store profile availability
- App Store Connect app/bundle ownership and service/branding authorization
- configured Agora application identifier and successful real-call validation
- iOS/iPadOS 17.5 or later runtime/device coverage
- exact signed iPhone+iPad physical-device matrix
- owner-approved collected-data/tracking declarations and App Store privacy
  answers; required-reason declarations alone do not describe server data use
- explicit upload/tester-assignment authority

No push, merge, tag, upload, tester assignment, TestFlight distribution, App
Store submission, or release follows from this runbook without separate authority.
