import Network
import Tauri
import WebKit

@_silgen_name("open_grind_set_network_available")
private func openGrindSetNetworkAvailable(_ available: UInt8)

final class RealtimeNetworkPlugin: Plugin {
  private let monitor = NWPathMonitor()
  private let queue = DispatchQueue(label: "doctor.andrewcox.opengrind.realtime-network")
  private var started = false

  override func load(webview: WKWebView) {
    guard !started else { return }
    started = true
    monitor.pathUpdateHandler = { path in
      openGrindSetNetworkAvailable(
        RealtimeNetworkContract.isAvailable(path.status) ? 1 : 0
      )
    }
    monitor.start(queue: queue)
  }

  deinit {
    monitor.cancel()
  }
}

@_cdecl("init_plugin_open_grind_realtime_network")
func initOpenGrindRealtimeNetworkPlugin() -> Plugin {
  RealtimeNetworkPlugin()
}
