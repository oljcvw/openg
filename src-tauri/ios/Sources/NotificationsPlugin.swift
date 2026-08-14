import BackgroundTasks
import Foundation
import Network
import Tauri
import UIKit
import UserNotifications

@_silgen_name("open_grind_notifications_poll")
private func openGrindNotificationsPoll(
  _ messagesEnabled: Int32,
  _ tapsEnabled: Int32
) -> UnsafeMutablePointer<CChar>?

@_silgen_name("open_grind_notifications_free")
private func openGrindNotificationsFree(_ value: UnsafeMutablePointer<CChar>?)

private struct NotificationSettingsArgs: Decodable {
  let enabled: Bool
  let messages: Bool
  let taps: Bool
  let showPreviews: Bool
}

private struct NotificationScheduleArgs: Decodable {
  let intervalMinutes: Int
}

private struct ClearNotificationAccountArgs: Decodable {
  let accountId: String
}

private final class BackgroundCompletion {
  private let lock = NSLock()
  private var finished = false

  func finish(_ task: BGTask, success: Bool) {
    lock.lock()
    defer { lock.unlock() }
    guard !finished else { return }
    finished = true
    task.setTaskCompleted(success: success)
  }
}

final class NotificationsPlugin: Plugin, UNUserNotificationCenterDelegate {
  private let center = UNUserNotificationCenter.current()
  private let defaults = UserDefaults.standard
  private let refreshIdentifier = "doctor.andrewcox.opengrind.background-refresh"
  private let pollQueue = DispatchQueue(label: "doctor.andrewcox.opengrind.notifications.poll", qos: .utility)
  private let routeLock = NSLock()
  private let wifiMonitor = NWPathMonitor()
  private let wifiMonitorQueue = DispatchQueue(
    label: "doctor.andrewcox.opengrind.notifications.wifi-safety"
  )
  private let wifiStateLock = NSLock()
  private var wifiKnown = false
  private var wifiConnected = false

  override init() {
    super.init()
    center.delegate = self
    BGTaskScheduler.shared.register(
      forTaskWithIdentifier: refreshIdentifier,
      using: nil
    ) { [weak self] task in
      guard let self, let refresh = task as? BGAppRefreshTask else {
        task.setTaskCompleted(success: false)
        return
      }
      self.handleRefresh(refresh)
    }
    wifiMonitor.pathUpdateHandler = { [weak self] path in
      guard let self else { return }
      self.wifiStateLock.lock()
      self.wifiKnown = true
      self.wifiConnected = RealtimeNetworkContract.isWifi(
        status: path.status,
        usesWifi: path.usesInterfaceType(.wifi)
      )
      self.wifiStateLock.unlock()
    }
    wifiMonitor.start(queue: wifiMonitorQueue)
  }

  @objc func getSettings(_ invoke: Invoke) {
    resolveSettings(invoke)
  }

  @objc func setSettings(_ invoke: Invoke) throws {
    let requested = try invoke.parseArgs(NotificationSettingsArgs.self)
    if requested.enabled {
      center.requestAuthorization(options: [.alert, .badge, .sound]) { granted, _ in
        self.save(requested, enabled: granted)
        if granted { self.scheduleRefresh() } else { self.cancelRefresh() }
        self.resolveSettings(invoke)
      }
    } else {
      save(requested, enabled: false)
      cancelRefresh()
      resolveSettings(invoke)
    }
  }

  @objc func testNotification(_ invoke: Invoke) {
    center.getNotificationSettings { settings in
      guard NotificationPermission.status(for: settings.authorizationStatus) == "granted" else {
        invoke.reject("Notification permission is not granted")
        return
      }
      let content = UNMutableNotificationContent()
      content.title = "Open Grind"
      content.body = "Notifications are enabled."
      content.sound = .default
      let request = UNNotificationRequest(
        identifier: "open-grind-test-\(UUID().uuidString)",
        content: content,
        trigger: UNTimeIntervalNotificationTrigger(timeInterval: 1, repeats: false)
      )
      self.center.add(request) { error in
        if let error { invoke.reject(error.localizedDescription) } else { invoke.resolve() }
      }
    }
  }

  @objc func syncSchedule(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(NotificationScheduleArgs.self)
    defaults.set(min(1_440, max(15, args.intervalMinutes)), forKey: "notifications.intervalMinutes")
    if defaults.bool(forKey: "notifications.enabled") { scheduleRefresh() }
    invoke.resolve()
  }

  @objc func cancelSchedule(_ invoke: Invoke) {
    cancelRefresh()
    invoke.resolve()
  }

  @objc func clearAccount(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(ClearNotificationAccountArgs.self)
    guard args.accountId.range(of: "^[0-9]+$", options: .regularExpression) != nil else {
      invoke.reject("Invalid notification account id")
      return
    }
    clearAccountState(args.accountId)
    center.removeAllDeliveredNotifications()
    center.removeAllPendingNotificationRequests()
    invoke.resolve()
  }

  @objc func takePendingRoute(_ invoke: Invoke) {
    routeLock.lock()
    defer { routeLock.unlock() }
    guard let route = defaults.string(forKey: "notifications.pendingRoute"),
      let accountId = defaults.string(forKey: "notifications.pendingRouteAccountId")
    else {
      invoke.resolve()
      return
    }
    defaults.removeObject(forKey: "notifications.pendingRoute")
    defaults.removeObject(forKey: "notifications.pendingRouteAccountId")
    invoke.resolve(["route": route, "accountId": accountId])
  }

  private func resolveSettings(_ invoke: Invoke) {
    center.getNotificationSettings { settings in
      let permission = NotificationPermission.status(for: settings.authorizationStatus)
      invoke.resolve([
        "supported": true,
        "enabled": self.defaults.bool(forKey: "notifications.enabled") && permission == "granted",
        "messages": self.defaults.object(forKey: "notifications.messages") as? Bool ?? true,
        "taps": self.defaults.object(forKey: "notifications.taps") as? Bool ?? true,
        "showPreviews": self.defaults.bool(forKey: "notifications.showPreviews"),
        "permission": permission,
        "lastSuccessfulCheck": self.optionalValue(
          self.defaults.object(forKey: "notifications.lastSuccessfulCheck") as? NSNumber),
        "lastError": self.optionalValue(
          self.defaults.string(forKey: "notifications.lastError")),
      ])
    }
  }

  private func optionalValue(_ value: Any?) -> Any {
    value ?? NSNull()
  }

  private func save(_ settings: NotificationSettingsArgs, enabled: Bool) {
    defaults.set(enabled, forKey: "notifications.enabled")
    defaults.set(settings.messages, forKey: "notifications.messages")
    defaults.set(settings.taps, forKey: "notifications.taps")
    defaults.set(settings.showPreviews, forKey: "notifications.showPreviews")
  }

  private func scheduleRefresh() {
    BGTaskScheduler.shared.cancel(taskRequestWithIdentifier: refreshIdentifier)
    let request = BGAppRefreshTaskRequest(identifier: refreshIdentifier)
    let storedInterval = defaults.integer(forKey: "notifications.intervalMinutes")
    let interval = min(1_440, max(15, storedInterval == 0 ? 15 : storedInterval))
    request.earliestBeginDate = Date(timeIntervalSinceNow: TimeInterval(interval * 60))
    do {
      try BGTaskScheduler.shared.submit(request)
      defaults.removeObject(forKey: "notifications.lastError")
    } catch {
      defaults.set("Background refresh could not be scheduled", forKey: "notifications.lastError")
    }
  }

  private func cancelRefresh() {
    BGTaskScheduler.shared.cancel(taskRequestWithIdentifier: refreshIdentifier)
  }

  private func handleRefresh(_ task: BGAppRefreshTask) {
    let completion = BackgroundCompletion()
    task.expirationHandler = { completion.finish(task, success: false) }

    let settings = currentDeliverySettings()
    guard defaults.bool(forKey: "notifications.enabled"), settings.messages || settings.taps else {
      cancelRefresh()
      completion.finish(task, success: true)
      return
    }
    scheduleRefresh()
    center.getNotificationSettings { nativeSettings in
      guard NotificationPermission.status(for: nativeSettings.authorizationStatus) == "granted" else {
        completion.finish(task, success: true)
        return
      }
      DispatchQueue.main.async {
        let isActive = UIApplication.shared.applicationState == .active
        self.pollQueue.async {
          let success = self.pollAndDeliver(settings: settings, isActive: isActive)
          completion.finish(task, success: success)
        }
      }
    }
  }

  private func pollAndDeliver(
    settings: NotificationDeliverySettings,
    isActive: Bool
  ) -> Bool {
    if locationWifiSafetyBlocksPoll() { return true }
    guard let pointer = openGrindNotificationsPoll(
      settings.messages ? 1 : 0,
      settings.taps ? 1 : 0
    ) else {
      recordFailure()
      return false
    }
    let raw = String(cString: pointer)
    openGrindNotificationsFree(pointer)

    guard let response = try? JSONDecoder().decode(
      NotificationPollResponse.self,
      from: Data(raw.utf8)
    ) else {
      recordFailure()
      return false
    }
    switch response.state {
    case "signedOut":
      cancelRefresh()
      return true
    case "deferred":
      return true
    case "ok":
      guard let payload = response.payload,
        payload.accountId.range(of: "^[0-9]+$", options: .regularExpression) != nil
      else {
        recordFailure()
        return false
      }
      return process(payload: payload, settings: settings, isActive: isActive)
    default:
      recordFailure()
      return false
    }
  }

  private func locationWifiSafetyBlocksPoll() -> Bool {
    let active = defaults.bool(forKey: "locationWifiSafety.manualLocationActive")
    wifiStateLock.lock()
    let known = wifiKnown
    let connected = wifiConnected
    wifiStateLock.unlock()
    return RealtimeNetworkContract.blocksBackgroundTraffic(
      manualLocationActive: active,
      known: known,
      wifiConnected: connected
    )
  }

  private func process(
    payload: NotificationPollPayload,
    settings: NotificationDeliverySettings,
    isActive: Bool
  ) -> Bool {
    guard defaults.bool(forKey: "notifications.enabled") else { return true }
    let decision = NotificationDecision.decide(
      payload: payload,
      settings: settings,
      messageInitialized: defaults.bool(forKey: accountKey(payload.accountId, "messagesInitialized")),
      tapInitialized: defaults.bool(forKey: accountKey(payload.accountId, "tapsInitialized")),
      messageWatermark: readWatermark(payload.accountId, category: "message"),
      tapWatermark: readWatermark(payload.accountId, category: "tap")
    )

    guard !isActive else {
      commit(decision: decision, accountId: payload.accountId)
      recordSuccess()
      return true
    }
    let group = DispatchGroup()
    let resultLock = NSLock()
    var deliveryFailed = false
    for notification in decision.notifications {
      guard defaults.bool(forKey: "notifications.enabled") else { break }
      let content = UNMutableNotificationContent()
      content.title = notification.title
      content.body = notification.body
      content.sound = .default
      content.userInfo = ["route": notification.route, "accountId": payload.accountId]
      group.enter()
      center.add(UNNotificationRequest(
        identifier: notification.identifier,
        content: content,
        trigger: nil
      )) { error in
        if error != nil {
          resultLock.lock()
          deliveryFailed = true
          resultLock.unlock()
        }
        group.leave()
      }
    }
    group.wait()
    if deliveryFailed {
      recordFailure()
    } else {
      commit(decision: decision, accountId: payload.accountId)
      recordSuccess()
    }
    return !deliveryFailed
  }

  private func commit(decision: NotificationDecision, accountId: String) {
    saveWatermark(accountId, category: "message", watermark: decision.messageWatermark)
    saveWatermark(accountId, category: "tap", watermark: decision.tapWatermark)
    if defaults.bool(forKey: "notifications.messages") {
      defaults.set(true, forKey: accountKey(accountId, "messagesInitialized"))
    }
    if defaults.bool(forKey: "notifications.taps") {
      defaults.set(true, forKey: accountKey(accountId, "tapsInitialized"))
    }
  }

  private func currentDeliverySettings() -> NotificationDeliverySettings {
    NotificationDeliverySettings(
      messages: defaults.object(forKey: "notifications.messages") as? Bool ?? true,
      taps: defaults.object(forKey: "notifications.taps") as? Bool ?? true,
      showPreviews: defaults.bool(forKey: "notifications.showPreviews")
    )
  }

  private func accountKey(_ accountId: String, _ suffix: String) -> String {
    "notifications.account.\(accountId).\(suffix)"
  }

  private func readWatermark(_ accountId: String, category: String) -> NotificationWatermark {
    let prefix = accountKey(accountId, category)
    return NotificationWatermark(
      timestamp: UInt64(max(0, defaults.object(forKey: "\(prefix).timestamp") as? Int64 ?? 0)),
      identifiers: Set(defaults.stringArray(forKey: "\(prefix).identifiers") ?? [])
    )
  }

  private func saveWatermark(
    _ accountId: String,
    category: String,
    watermark: NotificationWatermark
  ) {
    let prefix = accountKey(accountId, category)
    defaults.set(NSNumber(value: watermark.timestamp), forKey: "\(prefix).timestamp")
    defaults.set(Array(watermark.identifiers).sorted(), forKey: "\(prefix).identifiers")
  }

  private func clearAccountState(_ accountId: String) {
    for suffix in [
      "messagesInitialized", "tapsInitialized",
      "message.timestamp", "message.identifiers",
      "tap.timestamp", "tap.identifiers",
    ] {
      defaults.removeObject(forKey: accountKey(accountId, suffix))
    }
  }

  private func recordSuccess() {
    defaults.set(NSNumber(value: UInt64(Date().timeIntervalSince1970 * 1_000)),
      forKey: "notifications.lastSuccessfulCheck")
    defaults.removeObject(forKey: "notifications.lastError")
  }

  private func recordFailure() {
    defaults.set("Background check failed", forKey: "notifications.lastError")
  }

  func userNotificationCenter(
    _ center: UNUserNotificationCenter,
    willPresent notification: UNNotification
  ) async -> UNNotificationPresentationOptions {
    []
  }

  func userNotificationCenter(
    _ center: UNUserNotificationCenter,
    didReceive response: UNNotificationResponse
  ) async {
    let userInfo = response.notification.request.content.userInfo
    guard let route = userInfo["route"] as? String,
      let accountId = userInfo["accountId"] as? String
    else {
      return
    }
    routeLock.lock()
    defaults.set(route, forKey: "notifications.pendingRoute")
    defaults.set(accountId, forKey: "notifications.pendingRouteAccountId")
    routeLock.unlock()
    trigger("notification-route", data: ["route": route, "accountId": accountId])
  }

  deinit {
    wifiMonitor.cancel()
  }
}

@_cdecl("init_plugin_open_grind_notifications")
func initOpenGrindNotificationsPlugin() -> Plugin {
  NotificationsPlugin()
}
