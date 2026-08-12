enum VoiceRecordingClassification: Equatable {
  case ready
  case tooShort
}

enum VoiceRecordingContract {
  static let minimumDurationMilliseconds = 1_000
  static let maximumDurationMilliseconds = 60_000

  static func classify(durationMilliseconds: Int) -> VoiceRecordingClassification {
    durationMilliseconds < minimumDurationMilliseconds ? .tooShort : .ready
  }

  static func clamp(durationMilliseconds: Int) -> Int {
    min(max(durationMilliseconds, 0), maximumDurationMilliseconds)
  }
}
