import Network
import XCTest

final class RealtimeNetworkPluginTests: XCTestCase {
  func testOnlySatisfiedPathEnablesRealtimeTransport() {
    XCTAssertTrue(RealtimeNetworkContract.isAvailable(.satisfied))
    XCTAssertFalse(RealtimeNetworkContract.isAvailable(.unsatisfied))
    XCTAssertFalse(RealtimeNetworkContract.isAvailable(.requiresConnection))
  }

  func testWifiRequiresSatisfiedPathAndWifiInterface() {
    XCTAssertTrue(RealtimeNetworkContract.isWifi(status: .satisfied, usesWifi: true))
    XCTAssertFalse(RealtimeNetworkContract.isWifi(status: .satisfied, usesWifi: false))
    XCTAssertFalse(RealtimeNetworkContract.isWifi(status: .unsatisfied, usesWifi: true))
  }

  func testBackgroundTrafficFailsClosedForActiveManualLocation() {
    XCTAssertTrue(RealtimeNetworkContract.blocksBackgroundTraffic(
      manualLocationActive: true, known: false, wifiConnected: false
    ))
    XCTAssertTrue(RealtimeNetworkContract.blocksBackgroundTraffic(
      manualLocationActive: true, known: true, wifiConnected: true
    ))
    XCTAssertFalse(RealtimeNetworkContract.blocksBackgroundTraffic(
      manualLocationActive: true, known: true, wifiConnected: false
    ))
    XCTAssertFalse(RealtimeNetworkContract.blocksBackgroundTraffic(
      manualLocationActive: false, known: false, wifiConnected: false
    ))
  }
}
