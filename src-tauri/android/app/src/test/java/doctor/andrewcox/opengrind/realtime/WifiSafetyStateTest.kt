package doctor.andrewcox.opengrind.realtime

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class WifiSafetyStateTest {
	@Test
	fun `new active network is unknown until capabilities arrive`() {
		val state = WifiSafetyState<String>()

		assertEquals(WifiSafetyValue(false, false), state.announced("wifi"))
		assertEquals(WifiSafetyValue(true, true), state.capabilities("wifi", true))
	}

	@Test
	fun `duplicate semantic state is idempotent`() {
		val state = WifiSafetyState<String>()

		assertEquals(WifiSafetyValue(true, false), state.observed("cell", false))
		assertNull(state.capabilities("cell", false))
	}

	@Test
	fun `stale loss cannot clear replacement WiFi state`() {
		val state = WifiSafetyState<String>()

		state.observed("cell", false)
		state.announced("wifi")
		state.capabilities("wifi", true)
		assertNull(state.lost("cell"))
		assertEquals(WifiSafetyValue(true, false), state.lost("wifi"))
	}

	@Test
	fun `unknown cannot report connected`() {
		val state = WifiSafetyState<String>()

		assertEquals(WifiSafetyValue(false, false), state.unavailable(false))
	}

	@Test
	fun `background traffic fails closed only for active manual location`() {
		assertEquals(true, shouldBlockLocationWifiBackgroundTraffic(true, false, false))
		assertEquals(true, shouldBlockLocationWifiBackgroundTraffic(true, true, true))
		assertEquals(false, shouldBlockLocationWifiBackgroundTraffic(true, true, false))
		assertEquals(false, shouldBlockLocationWifiBackgroundTraffic(false, false, false))
	}
}
