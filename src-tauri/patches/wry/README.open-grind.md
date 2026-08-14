# Open Grind Wry Android callback-lock patch

- Upstream crate: Wry `0.55.1`
- Packaged source commit: `a5bf203a1c8dbb3583588382538d6521655222a8`
- Upstream tracking: no equivalent released fix or project issue is known as of
  2026-08-14; opening an external issue or pull request requires separate
  authorization.

## Local invariant

Every Android JNI callback registry stores cloneable `Arc` handler handles.
JNI entry points may hold a registry mutex only long enough to select and clone
the handler. The mutex must be released before parsing further request data or
invoking application code. This applies to request, IPC, title, navigation,
page-load, and JavaScript-evaluation callbacks. Registry insertion, lookup,
removal, and public Wry APIs otherwise remain unchanged.

## Evidence and removal condition

The patch defends against a historical Android ANR whose main thread was in a
futex wait below `Rust.onPageLoaded`. Wry `0.55.1` invokes `ON_LOAD_HANDLER`
while the registry mutex guard is alive, so a callback that tears down its
webview can re-enter registry removal and deadlock. The host regression test in
`src/handler_registry.rs` proves that selection releases the mutex before a
callback re-enters removal.

Remove the `[patch.crates-io]` override, this vendored tree, and the associated
lockfile path source only after a newer adopted Wry release provides equivalent
clone-under-lock/invoke-after-unlock behavior for every Android callback
registry and its re-entrant regression passes unchanged.

## Upstream-quality patch description

Android JNI callbacks currently borrow handlers directly from global
`Mutex<HashMap<...>>` registries. The resulting mutex guard remains live for the
entire callback, and application callbacks can synchronously destroy a webview,
which re-enters the same registry and deadlocks. Store handlers behind `Arc`,
clone the selected handle under the mutex, drop the guard, then invoke it. Apply
the invariant consistently to request, IPC, title, navigation, page-load, and
evaluation callbacks. A host-testable registry regression demonstrates safe
re-entrant removal without changing public APIs or registry lifecycle
semantics.
