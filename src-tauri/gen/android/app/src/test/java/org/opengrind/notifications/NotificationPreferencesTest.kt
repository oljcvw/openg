package org.opengrind.notifications

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class NotificationPreferencesTest {
	@Test
	fun `account polling keys are complete and isolated`() {
		val first = notificationAccountKeys("100")
		val second = notificationAccountKeys("101")

		assertTrue(first.contains("account_100_messages_initialized"))
		assertTrue(first.contains("account_100_taps_initialized"))
		assertTrue(first.contains("account_100_message_timestamp"))
		assertTrue(first.contains("account_100_message_ids"))
		assertTrue(first.contains("account_100_tap_timestamp"))
		assertTrue(first.contains("account_100_tap_ids"))
		assertTrue(first.contains("account_100_category_initialization_v2"))
		assertFalse(first.any(second::contains))
	}

	@Test
	fun `beta4 category migration requires category specific baseline evidence`() {
		assertFalse(migratedCategoryInitialized(legacyInitialized = false, watermarkTimestamp = 10))
		assertFalse(migratedCategoryInitialized(legacyInitialized = true, watermarkTimestamp = 0))
		assertTrue(migratedCategoryInitialized(legacyInitialized = true, watermarkTimestamp = 10))
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
