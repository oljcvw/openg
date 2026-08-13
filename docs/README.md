# Open Grind documentation

This directory owns the documentation site, its dependency lock, generation
rules, audits, and build configuration. Application build requirements belong in
the repository root; documentation-only tooling belongs here.

## Requirements

- [Bun](https://bun.sh/) compatible with the repository lockfiles
- Git, used by the cleanliness check to detect stale tracked generated output

No Rust, Android SDK, JDK, NDK, signing key, device, or application credential is
required to build the documentation site. VitePress may read the root TypeScript
configuration, but documentation generation does not compile or package the app.

## Install

From the repository root:

```sh
bun install --cwd docs --frozen-lockfile
```

The documentation has its own `package.json` and `bun.lock`. Do not add
documentation-only packages to the application manifest.

## Preview

```sh
bun run --cwd docs start
```

This generates the API reference, starts VitePress, and watches documentation
changes. The built site uses `docs/content` as its source directory.

## Validate exactly as CI does

```sh
bun run check:docs
```

That command performs, in order:

1. Prettier cleanliness for documentation configuration, prose, and scripts.
2. OpenAPI schema validation.
3. Deterministic API-reference and sidebar generation.
4. OpenAPI coverage, operation, query, and internal-link audits.
5. Full VitePress client/server build and page rendering.
6. A Git diff check proving tracked generated sidebar output is current.

Generated API Markdown is ignored under `content/generated/`; generation removes
the directory first so deleted or moved API pages cannot survive as stale build
input. `lib/index.ts` is tracked because VitePress imports its generated sidebar.

## Source ownership

| Material                                        | Canonical source                                        |
| ----------------------------------------------- | ------------------------------------------------------- |
| User and developer guides                       | `content/`                                              |
| Grindr API contract                             | `lib/openapi.json`                                      |
| Generated API pages                             | `content/generated/` — never edit directly              |
| Generated API sidebar                           | `lib/index.ts` — update by running generation           |
| Site navigation and theme                       | `.vitepress/`                                           |
| Generator and audits                            | `scripts/`                                              |
| Product screenshots and logos                   | `../contrib/` with public links under `content/public/` |
| Application build, signing, and reproducibility | `../BUILDING.md`                                        |
| Detailed iOS release-preparation runbook        | `ios-release.md`                                        |
| Contributor and review rules                    | `../CONTRIBUTING.md`                                    |
| Private security reporting                      | `../SECURITY.md`                                        |

## Writing rules

- Keep one shared user guide. Put platform divergence in the relevant section
  and global support matrix rather than creating separate platform manuals.
- Separate source intent, local compilation, packaged artifacts, device
  acceptance, publication, and release status.
- Do not present demo-mode screenshots as native-device evidence.
- Use controlled demo data for shared-UI screenshots. Never capture tokens,
  sessions, private profiles, messages, media, device identifiers, or precise
  coordinates.
- Update `lib/openapi.json`, not generated API pages, for protocol changes.
- Prefer observable behavior and stable public contracts over implementation
  choreography, exact UI wording, or screenshot-pinned layouts.
