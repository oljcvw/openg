package org.opengrind.notifications

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class NotificationPreferencesTest {
	@Test
	fun `account polling keys are complete and isolated`() {
		val first = notificationAccountKeys("100")
		val second = notificationAccountKeys("101")

		assertTrue(first.contains("account_100_initialized"))
		assertTrue(first.contains("account_100_message_timestamp"))
		assertTrue(first.contains("account_100_message_ids"))
		assertTrue(first.contains("account_100_tap_timestamp"))
		assertTrue(first.contains("account_100_tap_ids"))
		assertFalse(first.any(second::contains))
	}

	@Test(expected = IllegalArgumentException::class)
	fun `account polling keys reject non numeric ids`() {
		notificationAccountKeys("../other")
	}

	@Test
	fun `notification polling interval stays within WorkManager bounds`() {
		assertTrue(normalizedNotificationPollInterval(1) == 15L)
		assertTrue(normalizedNotificationPollInterval(90) == 90L)
		assertTrue(normalizedNotificationPollInterval(2_000) == 1_440L)
	}
}
