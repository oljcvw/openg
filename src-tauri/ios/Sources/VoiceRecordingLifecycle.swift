import AVFoundation
import Foundation
import UIKit

enum VoiceRecordingLifecycleAction: Equatable {
  case cancelSilently
  case fail
}

enum VoiceRecordingLifecycle {
  static func action(for notification: Notification) -> VoiceRecordingLifecycleAction? {
    if notification.name == UIApplication.didEnterBackgroundNotification {
      return .cancelSilently
    }
    guard notification.name == AVAudioSession.interruptionNotification,
      let rawType = (notification.userInfo?[AVAudioSessionInterruptionTypeKey] as? NSNumber)?.uintValue,
      AVAudioSession.InterruptionType(rawValue: rawType) == .began
    else { return nil }
    return .fail
  }
}
