import UserNotifications
import XCTest

final class NotificationsPluginTests: XCTestCase {
  func testNotificationPermissionMapsNativeStatesToSharedContract() {
    XCTAssertEqual(NotificationPermission.status(for: .notDetermined), "prompt")
    XCTAssertEqual(NotificationPermission.status(for: .denied), "denied")
    XCTAssertEqual(NotificationPermission.status(for: .authorized), "granted")
    XCTAssertEqual(NotificationPermission.status(for: .provisional), "granted")
    XCTAssertEqual(NotificationPermission.status(for: .ephemeral), "granted")
  }

  func testWatermarkTracksEveryIdentifierAtNewestTimestamp() {
    let watermark = NotificationWatermark(timestamp: 100, identifiers: ["chat-1"])
    let items = [
      NotificationMessage(
        conversationId: "chat-1", title: "One", preview: nil,
        timestamp: 100, unreadCount: 1),
      NotificationMessage(
        conversationId: "chat-2", title: "Two", preview: nil,
        timestamp: 100, unreadCount: 1),
    ]

    XCTAssertEqual(watermark.unseenMessages(in: items).map(\.conversationId), ["chat-2"])
    XCTAssertEqual(
      watermark.advancedByMessages(items),
      NotificationWatermark(timestamp: 100, identifiers: ["chat-1", "chat-2"])
    )
  }

  func testFirstSuccessfulPollEstablishesBaselineWithoutNotifying() {
    let payload = NotificationPollPayload(
      accountId: "42",
      messages: [
        NotificationMessage(
          conversationId: "chat-1", title: "Ada", preview: "private text",
          timestamp: 100, unreadCount: 1)
      ],
      taps: []
    )

    let decision = NotificationDecision.decide(
      payload: payload,
      settings: NotificationDeliverySettings(
        messages: true, taps: true, showPreviews: true),
      messageInitialized: false,
      tapInitialized: false,
      messageWatermark: NotificationWatermark(),
      tapWatermark: NotificationWatermark()
    )

    XCTAssertTrue(decision.notifications.isEmpty)
    XCTAssertEqual(decision.messageWatermark.timestamp, 100)
  }

  func testPrivacyModeSuppressesNamesAndMessageBodies() {
    let payload = NotificationPollPayload(
      accountId: "42",
      messages: [
        NotificationMessage(
          conversationId: "safe-chat", title: "Ada", preview: "private text",
          timestamp: 101, unreadCount: 1)
      ],
      taps: [NotificationTap(profileId: 7, displayName: "Grace", timestamp: 101)]
    )

    let decision = NotificationDecision.decide(
      payload: payload,
      settings: NotificationDeliverySettings(
        messages: true, taps: true, showPreviews: false),
      messageInitialized: true,
      tapInitialized: true,
      messageWatermark: NotificationWatermark(timestamp: 100, identifiers: ["old"]),
      tapWatermark: NotificationWatermark(timestamp: 100, identifiers: ["6"])
    )

    XCTAssertEqual(decision.notifications.map(\.title), ["New message", "New tap"])
    XCTAssertEqual(decision.notifications.map(\.body), ["Open Grind", "Open Grind"])
    XCTAssertFalse(decision.notifications.description.contains("private text"))
    XCTAssertFalse(decision.notifications.description.contains("Grace"))
  }
}
