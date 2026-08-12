import Foundation

struct NotificationMessage: Codable, Equatable {
  let conversationId: String
  let title: String
  let preview: String?
  let timestamp: UInt64
  let unreadCount: UInt64
}

struct NotificationTap: Codable, Equatable {
  let profileId: UInt64
  let displayName: String?
  let timestamp: UInt64
}

struct NotificationPollPayload: Equatable {
  let accountId: String
  let messages: [NotificationMessage]
  let taps: [NotificationTap]
}

struct NotificationPollResponse: Decodable {
  let state: String
  let accountId: String?
  let messages: [NotificationMessage]?
  let taps: [NotificationTap]?
  let code: String?

  var payload: NotificationPollPayload? {
    guard state == "ok", let accountId, let messages, let taps else { return nil }
    return NotificationPollPayload(accountId: accountId, messages: messages, taps: taps)
  }
}

struct NotificationWatermark: Equatable {
  var timestamp: UInt64 = 0
  var identifiers: Set<String> = []

  func unseenMessages(in items: [NotificationMessage]) -> [NotificationMessage] {
    unseen(items, timestamp: \.timestamp, identifier: \.conversationId)
  }

  func unseenTaps(in items: [NotificationTap]) -> [NotificationTap] {
    unseen(items, timestamp: \.timestamp) { String($0.profileId) }
  }

  func advancedByMessages(_ items: [NotificationMessage]) -> NotificationWatermark {
    advanced(items, timestamp: \.timestamp, identifier: \.conversationId)
  }

  func advancedByTaps(_ items: [NotificationTap]) -> NotificationWatermark {
    advanced(items, timestamp: \.timestamp) { String($0.profileId) }
  }

  private func unseen<Item>(
    _ items: [Item],
    timestamp timestampOf: (Item) -> UInt64,
    identifier identifierOf: (Item) -> String
  ) -> [Item] {
    items.filter { item in
      let itemTimestamp = timestampOf(item)
      return itemTimestamp > timestamp
        || (itemTimestamp == timestamp && !identifiers.contains(identifierOf(item)))
    }
  }

  private func advanced<Item>(
    _ items: [Item],
    timestamp timestampOf: (Item) -> UInt64,
    identifier identifierOf: (Item) -> String
  ) -> NotificationWatermark {
    guard let newestTimestamp = items.map(timestampOf).max(), newestTimestamp >= timestamp else {
      return self
    }
    var newestIdentifiers: Set<String> = []
    for item in items where timestampOf(item) == newestTimestamp {
      newestIdentifiers.insert(identifierOf(item))
    }
    if newestTimestamp == timestamp {
      return NotificationWatermark(
        timestamp: timestamp,
        identifiers: identifiers.union(newestIdentifiers)
      )
    }
    return NotificationWatermark(timestamp: newestTimestamp, identifiers: newestIdentifiers)
  }
}

struct NotificationDeliverySettings {
  let messages: Bool
  let taps: Bool
  let showPreviews: Bool
}

struct PendingLocalNotification: Equatable {
  let identifier: String
  let title: String
  let body: String
  let route: String
}

struct NotificationDecision {
  let notifications: [PendingLocalNotification]
  let messageWatermark: NotificationWatermark
  let tapWatermark: NotificationWatermark

  static func decide(
    payload: NotificationPollPayload,
    settings: NotificationDeliverySettings,
    messageInitialized: Bool,
    tapInitialized: Bool,
    messageWatermark: NotificationWatermark,
    tapWatermark: NotificationWatermark
  ) -> NotificationDecision {
    let newMessages = messageWatermark.unseenMessages(in: payload.messages)
    let newTaps = tapWatermark.unseenTaps(in: payload.taps)
    var notifications: [PendingLocalNotification] = []
    if settings.messages, messageInitialized, !newMessages.isEmpty {
      notifications.append(formatMessages(newMessages, showPreviews: settings.showPreviews))
    }
    if settings.taps, tapInitialized, !newTaps.isEmpty {
      notifications.append(formatTaps(newTaps, showPreviews: settings.showPreviews))
    }
    return NotificationDecision(
      notifications: notifications,
      messageWatermark: messageWatermark.advancedByMessages(payload.messages),
      tapWatermark: tapWatermark.advancedByTaps(payload.taps)
    )
  }

  private static func formatMessages(
    _ messages: [NotificationMessage], showPreviews: Bool
  ) -> PendingLocalNotification {
    guard messages.count == 1, let message = messages.first else {
      return PendingLocalNotification(
        identifier: "open-grind-messages",
        title: "\(messages.count) new conversations",
        body: "Open Grind",
        route: "/chat"
      )
    }
    return PendingLocalNotification(
      identifier: "open-grind-messages",
      title: showPreviews ? message.title : "New message",
      body: showPreviews ? (message.preview ?? "Open Grind message") : "Open Grind",
      route: safeChatRoute(message.conversationId)
    )
  }

  private static func formatTaps(
    _ taps: [NotificationTap], showPreviews: Bool
  ) -> PendingLocalNotification {
    guard taps.count == 1, let tap = taps.first else {
      return PendingLocalNotification(
        identifier: "open-grind-taps",
        title: "\(taps.count) new taps",
        body: "Open Grind",
        route: "/interest/taps"
      )
    }
    let body: String
    if showPreviews, let displayName = tap.displayName, !displayName.isEmpty {
      body = "\(displayName) tapped you"
    } else {
      body = "Open Grind"
    }
    return PendingLocalNotification(
      identifier: "open-grind-taps",
      title: "New tap",
      body: body,
      route: "/interest/taps"
    )
  }

  static func safeChatRoute(_ conversationId: String) -> String {
    let range = NSRange(conversationId.startIndex..., in: conversationId)
    let pattern = "^[A-Za-z0-9:_-]{1,200}$"
    guard conversationId.range(of: pattern, options: .regularExpression) != nil,
      range.length <= 200
    else { return "/chat" }
    return "/chat/\(conversationId)"
  }
}
