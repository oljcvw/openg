# Reliability remediation evidence and risk register

This document records validation boundaries for the Browse, mobile-listener,
and Android WebView reliability changes. It is an engineering record, not a
release claim.

## Validation evidence

- Browse rotation completed ten portrait-to-landscape-to-portrait cycles on a
  T20S. Every observed topology change emitted `anchor_restored`. No
  ResizeObserver error, raw query or geohash data, listener permission failure,
  missing plugin, fatal exception, or new ANR appeared in the captured logs.
- The worst frame in that run was 400 ms, down from the captured 737 ms
  baseline (45.7% improvement). This misses the non-blocking 368 ms target.
- The Wry registry regression test proves a callback can remove its own
  registry entry without deadlocking. The patched Wry builds for Android
  `aarch64`, `armv7`, `x86_64`, and `i686`.
- Physical lifecycle stress against a live authenticated account was stopped.
  It is not a completed acceptance result and must not be represented as one.

## Risk register

| ID           | Risk or limitation                                                                                                                                                                         | State                           | Treatment and removal condition                                                                                                                                                                                |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RISK-REL-001 | Rotation worst frame was 400 ms rather than the 368 ms target. Correctness passed, and the target is explicitly non-blocking when device variance is reported.                             | Open, non-blocking              | Retain duration-bucket diagnostics. Re-measure on a controlled T20S with comparable background load before making a stronger performance claim.                                                                |
| RISK-REL-002 | A 100-iteration physical lifecycle stress run was not completed safely because the available device used a live authenticated account.                                                     | Open validation gap             | Use an offline/emulated environment or a disposable test account with explicit service authorization. Host re-entrant lock regression remains the blocking correctness proof.                                  |
| RISK-REL-003 | Android vendor `gfxinfo` classified all sampled WebView frames as janky even though its histogram remained bounded; that percentage is not a reliable comparative metric on this firmware. | Accepted measurement limitation | Compare frame histograms and worst-frame duration under matched conditions; do not use the vendor jank percentage alone.                                                                                       |
| RISK-REL-004 | The vendored Wry patch increases dependency-maintenance responsibility.                                                                                                                    | Mitigated                       | Keep the patch pinned to Wry 0.55.1 and its recorded upstream source commit. Remove it when an adopted upstream release enforces clone-under-lock and invoke-after-unlock for every Android callback registry. |

## Out-of-scope noise

Chromium's variations-seed file-not-found message remains external WebView
noise. No app-level suppression or workaround is included.
