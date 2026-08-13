# Troubleshooting

## The grid is empty

Choose a browsing location first. Use place search or the map picker; Android
and iOS builds can also request device location. Then refresh and temporarily
clear restrictive filters.

## Sign-in fails

- Confirm email and password work in the official client.
- For Google accounts, follow the [Google sign-in guide](/guides/sign-in-with-google).
- Account creation, password reset, phone sign-in, reCAPTCHA, age verification,
  and restriction appeals are not handled by Open Grind.
- A rate-limit or request-blocked message may require waiting before retrying.

## Messages stop updating

Return the app to the foreground and refresh the Inbox. Check network access. A
real-time connection warning does not necessarily mean sent messages were lost;
failed sends remain visible. If failures persist, restart the app once.

## Camera, microphone, calls, or notifications are unavailable

Camera capture, microphone recording, video calls, and notifications are
implemented on Android. They are implemented on iOS and iPadOS with device
validation pending. Check system permission first. On Android, also check WebView
version and battery optimization. On iOS and iPadOS,
periodic notification checks may be deferred, voice recording is canceled in
background, and an active video call ends when the app enters background. Media
already on the device can still be selected without camera capture.

## Media will not open

The item may have expired, exhausted its allowed views, been retracted, or lost
album access. A retained encrypted copy is usable only if it was cached earlier
and the corresponding retention setting permits access. Clearing the cache
removes that local fallback.

## Storage is growing

Open **Settings → App Settings** and review the cache limit, retained shared
media, and unavailable-album retention. Clear cached data when local copies are
no longer needed.

## Prepare a safe bug report

Record Open Grind version, platform and OS version, what you expected, what
happened, and minimal reproduction steps. Never post tokens, session data,
profile IDs, messages, photos, precise coordinates, or private log lines. Use
the public issue tracker for ordinary bugs. Follow the project's security policy
for vulnerabilities; do not open a public vulnerability report.
