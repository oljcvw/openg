# Platform support

Open Grind uses one Tauri application: a shared Svelte interface and Rust core,
plus narrow native adapters where operating-system contracts differ. Source,
build tooling, signed artifacts, device acceptance, and public release are
different evidence states.

Status meanings:

- **Available**: implemented with a documented build and validation path.
- **Implemented; validation pending**: implementation exists, but current signed
  device-acceptance evidence was not found.
- **Shared source**: shared implementation exists without a complete current
  project-owned release path for that target.
- **Not available**: current native command reports unsupported.

| Capability                                            | Android                       | iOS and iPadOS                        | macOS                                                           | Windows            | Linux                                     |
| ----------------------------------------------------- | ----------------------------- | ------------------------------------- | --------------------------------------------------------------- | ------------------ | ----------------------------------------- |
| Project-owned build path                              | Reproducible Nix APK build    | Nix simulator/device build and tests  | None                                                            | None               | None                                      |
| Signed public distribution evidenced here             | Android release track         | Not yet; signing/TestFlight are gated | None                                                            | None               | None                                      |
| Shared UI, API, real-time messaging, encrypted caches | Available                     | Implemented; validation pending       | Shared source                                                   | Shared source      | Shared source                             |
| Password sign-in                                      | Available                     | Implemented; validation pending       | Shared source                                                   | Shared source      | Shared source                             |
| Google sign-in                                        | Companion app or manual token | Manual OAuth token                    | Embedded web flow                                               | Embedded web flow  | Embedded web flow                         |
| Device location                                       | Available                     | Implemented; validation pending       | Not shown                                                       | Not shown          | Not shown                                 |
| Place search and map location picker                  | Available                     | Shared implementation                 | Shared source                                                   | Shared source      | Shared source                             |
| Existing-media picker                                 | Android system picker         | Tauri/Apple file dialog               | Desktop dialog                                                  | Desktop dialog     | Desktop dialog                            |
| Camera and short-video capture                        | Available                     | Implemented; validation pending       | Not available                                                   | Not available      | Not available                             |
| Voice recording                                       | Available                     | Implemented; validation pending       | Not available                                                   | Not available      | Not available                             |
| Video calls                                           | Available                     | Implemented; requires Agora ID        | Not available                                                   | Not available      | Not available                             |
| Background notifications                              | Periodic checks               | Local alerts and best-effort refresh  | Not available                                                   | Not available      | Not available                             |
| Credential backend                                    | Android Keystore              | Apple Keychain                        | Protected files by default; optional Keychain for signed builds | Credential Manager | Secret Service or protected-file fallback |

Android requires API 28 or newer and Chromium WebView 111 or newer. iPhone and
iPad require iOS or iPadOS 17.5 or newer. Windows checks for WebView2 111 or
newer. Linux checks for WebKitGTK 2.42 or newer. Shared macOS styling requires
Safari/WebKit behavior equivalent to Safari 16.4, but this is not a macOS
release-validation claim.

Build scripts, icons, conditional dependencies, and capability declarations are
construction inputs—not evidence that a particular artifact was signed,
installed on physical devices, accepted by TestFlight, approved by an app store,
or publicly released. See [iOS development and release](/development/ios-release)
for those separate states.
