struct MediaCaptureSize: Equatable {
  let width: Int
  let height: Int
}

enum MediaCaptureContract {
  static let maximumPhotoDimension = 1_024
  static let maximumPhotoBytes = 1_048_576
  static let maximumVideoDurationMilliseconds = 15_000

  static func scaledSize(width: Int, height: Int) -> MediaCaptureSize {
    guard width > maximumPhotoDimension || height > maximumPhotoDimension else {
      return MediaCaptureSize(width: width, height: height)
    }
    let scale = Double(maximumPhotoDimension) / Double(max(width, height))
    return MediaCaptureSize(
      width: max(1, Int((Double(width) * scale).rounded())),
      height: max(1, Int((Double(height) * scale).rounded()))
    )
  }

  static func clampedVideoDuration(milliseconds: Int) -> Int {
    min(max(milliseconds, 0), maximumVideoDurationMilliseconds)
  }

  static func presentationError(
    presenterAttached: Bool,
    presenterHasModal: Bool,
    captureActive: Bool
  ) -> String? {
    if captureActive { return "A media capture is already active" }
    if !presenterAttached || presenterHasModal { return "Capture presentation is unavailable" }
    return nil
  }
}
