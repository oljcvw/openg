import AVFoundation
import Foundation
import UIKit

enum VideoCallLifecycle {
  static func endReason(for notification: Notification) -> String? {
    if notification.name == UIApplication.didEnterBackgroundNotification {
      return "app-backgrounded"
    }
    guard notification.name == AVAudioSession.interruptionNotification,
      let rawType = (notification.userInfo?[AVAudioSessionInterruptionTypeKey] as? NSNumber)?.uintValue,
      AVAudioSession.InterruptionType(rawValue: rawType) == .began
    else { return nil }
    return "audio-interrupted"
  }
}
