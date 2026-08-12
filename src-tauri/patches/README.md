# Vendored cargo patches

`grindr/` starts from the exact `grindr 0.7.0+26.12.0.169415` crate source from
crates.io (archive checksum
`3c45b9bab4382c6e039ae9d9e70b7629582a51ec5181ada4b56759958ac5acba`).
Open Grind carries a narrow realtime lifecycle patch here until equivalent
disconnect, ping, and reconnect controls are available in an upstream release.
See `docs/design/api-behavior-parity.md` for the supported behavior.

`tauri-codegen` generates embedded assets and CSP hashes in hash-map order,
which causes nondeterministic builds.

`tauri-codegen/` is **generated**, do not edit it. Wipe and regenerate any time with:

```sh
bun vendor:tauri-codegen
```

To change the patch, edit the `.patch` file and regenerate.

- Remove `tauri-codegen` once https://github.com/tauri-apps/tauri/pull/15777 is merged
