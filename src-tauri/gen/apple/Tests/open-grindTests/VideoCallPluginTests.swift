import AVFoundation
import UIKit
import XCTest

final class VideoCallPluginTests: XCTestCase {
  func testAgoraAppIdRejectsMissingAndUnexpandedBuildValues() {
    XCTAssertNil(AgoraConfiguration.normalizedAppId(nil))
    XCTAssertNil(AgoraConfiguration.normalizedAppId(""))
    XCTAssertNil(AgoraConfiguration.normalizedAppId("$(OPEN_GRIND_AGORA_APP_ID)"))
    XCTAssertEqual(AgoraConfiguration.normalizedAppId(" public-app-id "), "public-app-id")
  }

  func testCallQualityMatchesAndroidDimensions() {
    XCTAssertEqual(VideoCallQuality.parse("low").width, 320)
    XCTAssertEqual(VideoCallQuality.parse("low").height, 240)
    XCTAssertEqual(VideoCallQuality.parse("high").width, 640)
    XCTAssertEqual(VideoCallQuality.parse("unknown").height, 480)
  }

  func testCallEndsWhenCameraCannotRemainActive() {
    XCTAssertEqual(
      VideoCallLifecycle.endReason(for: Notification(
        name: UIApplication.didEnterBackgroundNotification
      )),
      "app-backgrounded"
    )
    XCTAssertEqual(
      VideoCallLifecycle.endReason(for: Notification(
        name: AVAudioSession.interruptionNotification,
        userInfo: [
          AVAudioSessionInterruptionTypeKey:
            NSNumber(value: AVAudioSession.InterruptionType.began.rawValue)
        ]
      )),
      "audio-interrupted"
    )
    XCTAssertNil(VideoCallLifecycle.endReason(for: Notification(
      name: AVAudioSession.interruptionNotification,
      userInfo: [
        AVAudioSessionInterruptionTypeKey:
          NSNumber(value: AVAudioSession.InterruptionType.ended.rawValue)
      ]
    )))
  }
}
