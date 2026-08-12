package org.opengrind.notifications

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class NotificationRouteTest {
	@Test
	fun `accepts notification destinations`() {
		assertEquals("/chat", NotificationRoute.sanitize("/chat"))
		assertEquals(
			"/chat/1234:abcd-ef",
			NotificationRoute.sanitize("/chat/1234:abcd-ef"),
		)
		assertEquals(
			"/interest/taps",
			NotificationRoute.sanitize("/interest/taps"),
		)
	}

	@Test
	fun `rejects arbitrary and malformed destinations`() {
		assertNull(NotificationRoute.sanitize("https://example.com"))
		assertNull(NotificationRoute.sanitize("/chat/../settings"))
		assertNull(NotificationRoute.sanitize(null))
	}
}
