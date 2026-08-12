import UserNotifications

enum NotificationPermission {
  static func status(for authorization: UNAuthorizationStatus) -> String {
    switch authorization {
    case .notDetermined:
      return "prompt"
    case .denied:
      return "denied"
    case .authorized, .provisional, .ephemeral:
      return "granted"
    @unknown default:
      return "denied"
    }
  }
}
