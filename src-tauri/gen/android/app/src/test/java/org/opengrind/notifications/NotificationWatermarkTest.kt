package org.opengrind.notifications

import org.junit.Assert.assertEquals
import org.junit.Test

class NotificationWatermarkTest {
	private data class Event(val id: String, val timestamp: Long)

	@Test
	fun `unseen handles same-timestamp events without duplicates`() {
		val watermark = NotificationWatermark(100, setOf("a"))
		val events = listOf(
			Event("old", 99),
			Event("a", 100),
			Event("b", 100),
			Event("c", 101),
		)

		assertEquals(
			listOf("b", "c"),
			watermark.unseen(events, Event::timestamp, Event::id).map(Event::id),
		)
	}

	@Test
	fun `advance retains all identities at newest timestamp`() {
		val advanced = NotificationWatermark(100, setOf("a")).advanced(
			listOf(Event("b", 101), Event("c", 101), Event("old", 99)),
			Event::timestamp,
			Event::id,
		)

		assertEquals(NotificationWatermark(101, setOf("b", "c")), advanced)
	}
}
