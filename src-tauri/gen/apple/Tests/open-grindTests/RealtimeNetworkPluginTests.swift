import Network
import XCTest

final class RealtimeNetworkPluginTests: XCTestCase {
  func testOnlySatisfiedPathEnablesRealtimeTransport() {
    XCTAssertTrue(RealtimeNetworkContract.isAvailable(.satisfied))
    XCTAssertFalse(RealtimeNetworkContract.isAvailable(.unsatisfied))
    XCTAssertFalse(RealtimeNetworkContract.isAvailable(.requiresConnection))
  }
}
