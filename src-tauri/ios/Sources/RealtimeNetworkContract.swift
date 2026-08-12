import Network

enum RealtimeNetworkContract {
  static func isAvailable(_ status: NWPath.Status) -> Bool {
    status == .satisfied
  }
}
