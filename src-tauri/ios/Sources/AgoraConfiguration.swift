import Foundation

enum AgoraConfiguration {
  static func normalizedAppId(_ value: String?) -> String? {
    guard let value else { return nil }
    let normalized = value.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !normalized.isEmpty, !normalized.contains("$(") else { return nil }
    return normalized
  }

  static var appId: String? {
    normalizedAppId(Bundle.main.object(forInfoDictionaryKey: "OpenGrindAgoraAppId") as? String)
  }
}

enum VideoCallQuality {
  case auto
  case high
  case low

  static func parse(_ value: String?) -> VideoCallQuality {
    switch value {
    case "low": .low
    case "high": .high
    default: .auto
    }
  }

  var width: Int {
    self == .low ? 320 : 640
  }

  var height: Int {
    self == .low ? 240 : 480
  }
}
