import Network
import Tauri
import WebKit

@_silgen_name("open_grind_set_network_available")
private func openGrindSetNetworkAvailable(_ available: UInt8)

@_silgen_name("open_grind_set_wifi_state")
private func openGrindSetWifiState(_ known: UInt8, _ connected: UInt8)

private struct ManualLocationSafetyArgs: Decodable {
  let active: Bool
}

final class RealtimeNetworkPlugin: Plugin {
  private let monitor = NWPathMonitor()
  private let queue = DispatchQueue(label: "doctor.andrewcox.opengrind.realtime-network")
  private var started = false

  override func load(webview: WKWebView) {
    guard !started else { return }
    started = true
    monitor.pathUpdateHandler = { [weak self] path in
      guard let self else { return }
      let wifiConnected = RealtimeNetworkContract.isWifi(
        status: path.status,
        usesWifi: path.usesInterfaceType(.wifi)
      )
      openGrindSetNetworkAvailable(
        RealtimeNetworkContract.isAvailable(path.status) ? 1 : 0
      )
      openGrindSetWifiState(1, wifiConnected ? 1 : 0)
    }
    monitor.start(queue: queue)
  }

  @objc func setManualLocationActive(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(ManualLocationSafetyArgs.self)
    UserDefaults.standard.set(
      args.active,
      forKey: "locationWifiSafety.manualLocationActive"
    )
    invoke.resolve()
  }

  deinit {
    monitor.cancel()
  }
}

@_cdecl("init_plugin_open_grind_realtime_network")
func initOpenGrindRealtimeNetworkPlugin() -> Plugin {
  RealtimeNetworkPlugin()
}
