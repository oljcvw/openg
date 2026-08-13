# Open Grind user guide

Open Grind is an unofficial, free, ad-free, tracker-free Grindr client. This is
the one user-facing guide for every supported platform. When behavior differs,
the relevant section names the platform and the limitation instead of sending
you to a separate platform manual.

![Open Grind grid, profile, and messaging screens](/app-screenshots-3x2.avif)

## Start here

1. [Download Open Grind](/guides/download) only from the official release page.
2. Sign in with email and password, or follow the
   [Google sign-in guide](/guides/sign-in-with-google).
3. Choose a location. Open Grind will not load the nearby grid until a location
   is selected. Mobile builds can use device location when permission is granted;
   every build can choose a place from the map or location search.
4. Read [Using Open Grind](/guides/using-open-grind) for browsing, profiles,
   messaging, albums, and Right Now.
5. Review [Account, privacy, and settings](/guides/account-privacy-settings),
   especially local media retention and diagnostics controls.

## Platform status at a glance

| Platform | What users should expect                                                                                                                                                                                                                                       |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Android  | Complete, documented release path. Native notifications, camera capture, voice recording, video calls, system back handling, and Android file picking are implemented.                                                                                         |
| iOS      | Native capture, voice, calls, periodic notifications, device location, and Keychain storage are implemented for iPhone and iPad; device validation remains pending. Build/test workflows exist; signed TestFlight and App Store release remain separate gates. |
| macOS    | Shared desktop application source exists. Local development defaults to file-backed credentials; distributed builds must opt into the Keychain feature. No complete project-owned release path is documented.                                                  |
| Windows  | Shared desktop source, WebView2 floor checks, and Credential Manager integration exist. No complete project-owned release path is documented.                                                                                                                  |
| Linux    | Shared desktop source, WebKitGTK floor checks, and Secret Service integration exist, with a protected file fallback. No complete project-owned release path is documented.                                                                                     |

See [Platform support](/guides/platform-support) for feature-level differences.

## Safety and scope

- Open Grind is not affiliated with Grindr.
- It is a client for the existing Grindr service, not a separate network.
- Account creation, phone-number sign-in, purchases, and age-verification flows
  are not implemented. Complete required account or legal verification in the
  official app.
- Never publish OAuth tokens, session data, diagnostic details, private media,
  profile IDs, messages, photos, or precise locations in a public bug report.

For help, start with [Troubleshooting](/guides/troubleshooting) and the
[FAQ](/guides/faq).
