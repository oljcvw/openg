# iOS Liquid Glass icon depth design

Status: Implemented and locally validated on `codex/ios-icon-depth`

## Objective

Make Open Grind's six-piece mask read as separate glass pieces suspended near
one another in depth. Device movement should change highlights, refraction, and
the apparent relationship between pieces while preserving the recognizable mask
at small launcher sizes.

## Platform constraint

Icon Composer supports up to four rendered depth groups. The six SVG source
files remain six separate image layers, but this design uses three groups. Each
group uses Individual Liquid Glass mode so both pieces in a pair receive their
own material rendering even though they share a z-plane.

## Layer and group structure

Groups appear below in back-to-front order:

1. `Cheeks` — `02-middle-left.svg`, `05-middle-right.svg`
2. `Jaw` — `03-lower-left.svg`, `06-lower-right.svg`
3. `Brow` — `01-upper-left.svg`, `04-upper-right.svg`

All six layers remain visible, glass-enabled, separately named, and positioned
on their existing 1430-by-1430 canvas. Grouping must not rewrite, flatten,
duplicate, or manually offset source paths.

## Material direction

- Use Individual rather than Combined mode for every group.
- Enable specular highlights and refraction for every group.
- Keep depth differences large enough to read during motion but close enough for
  the six pieces to remain one coherent mask.
- Use lowest material depth and softest shadow on `Cheeks`, medium treatment on
  `Jaw`, and strongest depth and shadow on `Brow`.
- Keep translucency restrained. Yellow pieces must remain saturated and legible
  against the background rather than becoming cloudy or washed out.
- Preserve the user-authored dark blue-to-black linear gradient as the baseline
  background. Explore nearby color, direction, and material settings in Icon
  Composer, but do not replace it with a completely black background.
- Keep source yellow as the foreground anchor. Background tuning must support
  yellow contrast without introducing a competing focal point.
- Treat numeric material values as tuning inputs, not product contracts. Final
  values are accepted by rendered behavior across required previews.

## Acceptance criteria

1. Icon Composer sidebar shows exactly three groups and six image layers in the
   specified back-to-front order.
2. Every group renders in Individual mode with Liquid Glass enabled.
3. Motion preview makes brow, jaw, and cheek planes respond distinctly without
   making the mask look exploded or misregistered when centered.
4. All six pieces retain distinct edge highlights and readable negative space.
5. Default, Dark, and Mono appearances remain recognizable at 60 pt 3x and at
   1024 pt 1x.
6. No piece disappears, clips, muddies into the background, or overwhelms its
   mirrored partner.
7. The gradient retains visible color and depth without becoming flat black,
   overly saturated, banded, or visually louder than the mask.
8. The tracked `.icon` package remains the Xcode app-icon source, and the project
   continues to reference `AppIcon.icon`.

## Verification

- Inspect centered and motion-responsive previews in Icon Composer.
- Inspect Default, Dark, and Mono appearances at launcher and full design sizes.
- Validate `icon.json` structure and referenced SVG files from the repository.
- Run the narrowest available Apple-project build or asset-processing check that
  proves Xcode accepts the modified `.icon` package without signing, publishing,
  uploading, or deploying.

## Scope boundaries

This change does not alter mask geometry, legacy PNG icons, Android icons,
signing, TestFlight state, App Store state, or release metadata. Color exploration
is limited to the `.icon` background and Liquid Glass appearance settings.
