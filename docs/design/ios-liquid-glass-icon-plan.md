# iOS Liquid Glass Icon Implementation Plan

**Goal:** Turn Open Grind's six-piece mask into three symmetric Liquid Glass
depth groups while preserving and refining the user-authored gradient background.

**Architecture:** Keep `AppIcon.icon` as the only Xcode app-icon source. Use
Icon Composer to reorganize six existing SVG image layers into three ordered
groups, then tune each group's native material independently. Preserve original
SVG geometry and use rendered previews—not serialized numeric values—as the
acceptance authority.

**Tech stack:** Apple Icon Composer, Icon Composer `.icon` package format, SVG,
generated Xcode Apple project

## Global constraints

- Work only on branch `codex/ios-icon-depth`.
- Preserve the user-authored black-to-dark-blue linear gradient as the first
  comparison baseline.
- Do not replace the background with a completely black fill.
- Keep all six SVGs separate, visible, glass-enabled, and unmodified.
- Use exactly three symmetric groups in back-to-front order: `Cheeks`, `Jaw`,
  `Brow`.
- Use Individual Liquid Glass mode for every group.
- Do not alter Android icons, legacy PNG icons, signing, TestFlight, App Store,
  or release metadata.
- Do not stage or commit without separate user authorization.

---

### Task 1: Preserve and capture user baseline

**Files:**

- Inspect: `src-tauri/gen/apple/AppIcon.icon/icon.json`
- Preserve: `src-tauri/gen/apple/AppIcon.icon/Assets/*.svg`
- Reference: `docs/design/ios-liquid-glass-icon.md`

**Interfaces:**

- Consumes: user-authored gradient and current one-group material settings
- Produces: recoverable pre-edit package plus visual baseline

- [ ] **Step 1: Confirm exact working-tree ownership**

  Run `git status --short --branch` and
  `git diff -- src-tauri/gen/apple/AppIcon.icon`. Record that gradient change is
  user-authored and must not be discarded.

- [ ] **Step 2: Create recoverable package copy outside repository**

  Copy `src-tauri/gen/apple/AppIcon.icon` to a uniquely named directory under
  `/tmp`. Hash source and copy `icon.json`; require matching SHA-256 values before
  changing Icon Composer state.

- [ ] **Step 3: Capture baseline previews**

  Open tracked package in Icon Composer. Capture centered Default, Dark, and Mono
  previews at `60pt 3x` and Default at `1024pt 1x`. Record current group mode,
  depth, refraction, shadow, translucency, and gradient colors.

### Task 2: Build three-group suspended-mask structure

**Files:**

- Modify through Icon Composer:
  `src-tauri/gen/apple/AppIcon.icon/icon.json`
- Preserve unchanged:
  `src-tauri/gen/apple/AppIcon.icon/Assets/01-upper-left.svg`
  through `06-lower-right.svg`

**Interfaces:**

- Consumes: six named image layers and existing canvas positions
- Produces: three ordered Icon Composer groups containing two layers each

- [ ] **Step 1: Create named groups in Icon Composer**

  Replace current `Mask Pieces` grouping with `Cheeks`, `Jaw`, and `Brow`.
  Keep background fill unchanged during structural work.

- [ ] **Step 2: Assign layers by anatomy**

  Place `Middle Left` and `Middle Right` in `Cheeks`; `Lower Left` and
  `Lower Right` in `Jaw`; `Upper Left` and `Upper Right` in `Brow`.

- [ ] **Step 3: Establish z-order**

  Arrange groups so system renders `Cheeks` rear, `Jaw` middle, and `Brow`
  front. Verify ordering through Icon Composer's motion preview rather than
  relying only on sidebar position.

- [ ] **Step 4: Preserve layer contracts**

  Confirm all six layers remain visible, glass-enabled, separately named, at
  `100%` scale and `x 0 pt / y 0 pt`. Compare SVG SHA-256 values with Task 1;
  require no changes.

### Task 3: Tune material depth and background color

**Files:**

- Modify through Icon Composer:
  `src-tauri/gen/apple/AppIcon.icon/icon.json`

**Interfaces:**

- Consumes: three-group structure and user gradient baseline
- Produces: visually distinct but coherent suspended glass mask

- [ ] **Step 1: Set group rendering modes**

  Set every group to Individual mode with refraction and specular highlights
  enabled. Leave blur disabled initially so edge character remains readable.

- [ ] **Step 2: Establish progressive starting treatment**

  Start with these tuning values, then refine through preview:

  | Group | Depth | Refraction strength | Neutral shadow | Translucency |
  |---|---:|---:|---:|---:|
  | Cheeks | 20% | 55% | 20% | 14% |
  | Jaw | 35% | 65% | 30% | 11% |
  | Brow | 50% | 72% | 40% | 8% |

- [ ] **Step 3: Compare bounded gradient variants**

  Use user gradient as Variant A. Compare at most two nearby alternatives:

  - Variant B: replace pure-black endpoint with deep blue-black while retaining
    existing dark-blue endpoint.
  - Variant C: keep endpoint colors but adjust gradient direction so light falls
    behind brow highlights rather than through center negative space.

  Do not change mask SVG fill. Keep only variant that improves yellow contrast,
  material readability, and centered-mask cohesion in both Default and Dark.

- [ ] **Step 4: Tune motion without exploding mask**

  Move Icon Composer's lighting/motion preview across full range. Reduce depth or
  shadow when paired pieces appear detached, misregistered, muddy, or asymmetric.
  Increase depth only when three planes fail to read at launcher size.

### Task 4: Validate appearances and Xcode acceptance

**Files:**

- Validate: `src-tauri/gen/apple/AppIcon.icon/icon.json`
- Validate: `src-tauri/gen/apple/AppIcon.icon/Assets/*.svg`
- Validate wiring: `src-tauri/gen/apple/project.yml`
- Validate wiring: `src-tauri/gen/apple/open-grind.xcodeproj/project.pbxproj`

**Interfaces:**

- Consumes: tuned `.icon` package
- Produces: visual, structural, and build-acceptance evidence

- [ ] **Step 1: Run appearance matrix**

  Inspect Default, Dark, and Mono at `60pt 3x`; inspect Default at `1024pt 1x`.
  Require recognizable mask, visible six-piece separation, clean negative space,
  preserved gradient color, and no clipping or dominant mirrored piece.

- [ ] **Step 2: Validate serialized package**

  Parse `icon.json`, require exactly three groups, require six unique referenced
  SVG files, require every reference to exist, and require original SVG hashes.

- [ ] **Step 3: Validate Xcode wiring**

  Confirm `project.yml` and `project.pbxproj` still reference `AppIcon.icon` and
  no alternate app-icon source was introduced.

- [ ] **Step 4: Run narrow unsigned Apple build check**

  Inspect chosen Xcode build command for signing and packaging side effects.
  Run unsigned Simulator build or asset-processing check with derived data under
  an isolated temporary directory. Do not archive, sign, export, install, upload,
  publish, deploy, or access signing credentials.

### Task 5: Review and hand off

**Files:**

- Review: `src-tauri/gen/apple/AppIcon.icon/icon.json`
- Review: `docs/design/ios-liquid-glass-icon.md`
- Review: `docs/design/ios-liquid-glass-icon-plan.md`

**Interfaces:**

- Consumes: final diff and validation evidence
- Produces: user-facing visual comparison and bounded handoff

- [ ] **Step 1: Inspect final diff and status**

  Verify only authorized icon package and design documents changed. Report any
  unexpected file immediately; do not absorb it.

- [ ] **Step 2: Present final visual evidence**

  Show baseline and selected final preview at launcher and full size, including
  Default, Dark, and Mono. State chosen gradient and group material settings.

- [ ] **Step 3: Report verification boundaries**

  Separate Icon Composer visual acceptance, package validation, unsigned build
  acceptance, and any checks not run. Leave all files unstaged and uncommitted
  unless user grants separate Git authority.
