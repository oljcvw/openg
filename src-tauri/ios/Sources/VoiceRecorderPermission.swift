import AVFoundation

enum VoiceRecorderPermission {
  static func status(for permission: AVAudioSession.RecordPermission) -> String {
    switch permission {
    case .undetermined:
      return "prompt"
    case .denied:
      return "blocked"
    case .granted:
      return "granted"
    @unknown default:
      return "blocked"
    }
  }
}
