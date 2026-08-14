import Network

enum RealtimeNetworkContract {
  static func isAvailable(_ status: NWPath.Status) -> Bool {
    status == .satisfied
  }

  static func isWifi(status: NWPath.Status, usesWifi: Bool) -> Bool {
    status == .satisfied && usesWifi
  }

  static func blocksBackgroundTraffic(
    manualLocationActive: Bool,
    known: Bool,
    wifiConnected: Bool
  ) -> Bool {
    manualLocationActive && (!known || wifiConnected)
  }
}
