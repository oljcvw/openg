# Local capture watermark

To replace the neutral bundled watermark for a local build, set:

`OPEN_GRIND_CAPTURE_WATERMARK_ASSET=/absolute/path/to/watermark.png`

The build copies that Android-compatible drawable into a generated resource
directory as `capture_watermark`. Keep licensed/private artwork local and out of
distributed source.
