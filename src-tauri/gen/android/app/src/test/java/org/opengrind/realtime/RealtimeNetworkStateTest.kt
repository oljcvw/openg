package org.opengrind.realtime

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class RealtimeNetworkStateTest {
	@Test
	fun `active network requires internet capability`() {
		val state = RealtimeNetworkState<String>()

		assertEquals(false, state.observed("wifi", false))
		assertEquals(true, state.capabilities("wifi", true))
		assertNull(state.capabilities("wifi", true))
	}

	@Test
	fun `announced network remains unavailable until capabilities arrive`() {
		val state = RealtimeNetworkState<String>()

		assertEquals(false, state.announced("cellular"))
		assertEquals(true, state.capabilities("cellular", true))
	}

	@Test
	fun `stale callbacks cannot disable replacement network`() {
		val state = RealtimeNetworkState<String>()

		state.observed("wifi", true)
		assertEquals(false, state.announced("cellular"))
		assertEquals(true, state.capabilities("cellular", true))
		assertNull(state.lost("wifi"))
	}

	@Test
	fun `matching loss disables network once`() {
		val state = RealtimeNetworkState<String>()

		state.observed("wifi", true)
		assertEquals(false, state.lost("wifi"))
		assertNull(state.lost("wifi"))
	}
}
