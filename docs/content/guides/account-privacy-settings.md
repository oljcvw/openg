# Account, privacy, and settings

Open Grind stores session credentials and device identity through a
platform-specific protected store. It also stores preferences and optional
encrypted media caches locally. Open Grind developers do not need your session,
OAuth token, messages, media, or exact location to troubleshoot the app.

## Account controls

Under **Settings → Account**, you can change email or password, inspect blocked
and hidden profiles, update privacy choices, or delete the account. Account
creation, phone-number sign-in, password reset, and age-verification flows are
not implemented; use the official client for those workflows.

## Privacy choices

Available account settings can include:

- showing, hiding, or approximating distance;
- incognito mode and whether your profile views are revealed;
- hiding the Viewed Me list;
- excluding your profile from location search;
- showing NSFW Right Now posts; and
- showing your profile on a map when the server exposes that setting.

App settings separately control read-receipt disclosure and profile-view
disclosure. Confirm the saved state after changing a server-backed setting.

## Appearance and accessibility

App settings include units, higher contrast, grid columns, Inbox layout,
profile swipe navigation, software-keyboard navigation behavior, and whether to
keep the screen awake. Open Grind is designed for keyboard and touch use and is
tested for accessible names, zoomed layouts, and compact/wide navigation.

## Storage and media retention

Cache controls set local storage limits and clear cached data. Two opt-in
retention settings deserve special attention:

- **Retain shared chat media** can preserve encrypted copies of viewed media.
- **Keep unavailable cached albums** can preserve already cached album items
  after access is revoked, removed, expired, or exhausted.

These settings change local privacy and storage behavior; they do not restore
items that were never cached. Clear cached data before transferring or sharing a
device.

## Notifications

Message and Tap notifications are implemented on Android, iOS, and iPadOS.
Notification previews are off by default to reduce lock-screen disclosure.
Checks are periodic rather than guaranteed real-time remote push, and mobile
operating systems may defer them for battery, network, or background policy.

## Diagnostics

Developer Settings can enable error and media-lifecycle diagnostics. Android
exposes the most detailed native stream through logcat. Logs are intended to
omit credentials and media contents, but they can
still reveal timing and technical context. Reproduce only with accounts and
devices you own, inspect logs before sharing, and redact profile IDs, messages,
photos, coordinates, tokens, and device identifiers.
