package org.opengrind.realtime

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class RealtimeMonitorInitializationTest {
	@Test
	fun `registration failure permits initialization retry`() {
		val initialization = RealtimeMonitorInitialization()
		var registrations = 0

		assertThrows(IllegalStateException::class.java) {
			initialization.runOnce {
				registrations += 1
				throw IllegalStateException("registration failed")
			}
		}

		assertTrue(initialization.runOnce { registrations += 1 })
		assertEquals(2, registrations)
	}

	@Test
	fun `successful initialization remains idempotent`() {
		val initialization = RealtimeMonitorInitialization()

		assertTrue(initialization.runOnce {})
		assertFalse(initialization.runOnce {})
	}
}
