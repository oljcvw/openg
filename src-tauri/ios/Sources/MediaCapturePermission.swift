import AVFoundation

enum MediaCapturePermission {
  static func status(for authorization: AVAuthorizationStatus) -> String {
    switch authorization {
    case .notDetermined:
      return "prompt"
    case .authorized:
      return "granted"
    case .denied, .restricted:
      return "blocked"
    @unknown default:
      return "blocked"
    }
  }
}
