import AVFoundation
import UIKit
import XCTest

final class VoiceRecorderPluginTests: XCTestCase {
  func testPermissionStatusMapsNativeStatesToSharedContract() {
    XCTAssertEqual(VoiceRecorderPermission.status(for: .undetermined), "prompt")
    XCTAssertEqual(VoiceRecorderPermission.status(for: .denied), "blocked")
    XCTAssertEqual(VoiceRecorderPermission.status(for: .granted), "granted")
  }

  func testDurationClassificationMatchesSharedVoiceMessageContract() {
    XCTAssertEqual(VoiceRecordingContract.classify(durationMilliseconds: 999), .tooShort)
    XCTAssertEqual(VoiceRecordingContract.classify(durationMilliseconds: 1_000), .ready)
    XCTAssertEqual(VoiceRecordingContract.classify(durationMilliseconds: 60_000), .ready)
  }

  func testDurationIsClampedToMaximumContract() {
    XCTAssertEqual(VoiceRecordingContract.clamp(durationMilliseconds: 60_001), 60_000)
  }

  func testLifecycleCancelsRecordingAndReportsOnlyUnexpectedInterruption() {
    XCTAssertEqual(
      VoiceRecordingLifecycle.action(for: Notification(
        name: UIApplication.didEnterBackgroundNotification
      )),
      .cancelSilently
    )
    XCTAssertEqual(
      VoiceRecordingLifecycle.action(for: Notification(
        name: AVAudioSession.interruptionNotification,
        userInfo: [
          AVAudioSessionInterruptionTypeKey:
            NSNumber(value: AVAudioSession.InterruptionType.began.rawValue)
        ]
      )),
      .fail
    )
    XCTAssertNil(VoiceRecordingLifecycle.action(for: Notification(
      name: AVAudioSession.interruptionNotification,
      userInfo: [
        AVAudioSessionInterruptionTypeKey:
          NSNumber(value: AVAudioSession.InterruptionType.ended.rawValue)
      ]
    )))
  }
}
