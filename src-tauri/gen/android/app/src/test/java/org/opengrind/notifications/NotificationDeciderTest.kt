package org.opengrind.notifications

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class NotificationDeciderTest {
	private val privateSettings = StoredNotificationSettings(
		enabled = true,
		messages = true,
		taps = true,
		showPreviews = false,
	)

	@Test
	fun `first successful poll establishes baseline without alerts`() {
		val decision = NotificationDecider.decide(
			result = result(),
			settings = privateSettings,
			messageInitialized = false,
			tapInitialized = false,
			messageWatermark = NotificationWatermark(),
			tapWatermark = NotificationWatermark(),
			foreground = false,
		)

		assertTrue(decision.notifications.isEmpty())
		assertEquals(100, decision.messageWatermark.timestamp)
		assertEquals(101, decision.tapWatermark.timestamp)
	}

	@Test
	fun `private defaults hide names and message text`() {
		val decision = NotificationDecider.decide(
			result = result(),
			settings = privateSettings,
			messageInitialized = true,
			tapInitialized = true,
			messageWatermark = NotificationWatermark(99),
			tapWatermark = NotificationWatermark(100),
			foreground = false,
		)

		assertEquals(
			listOf(
				PendingNotification(
					NotificationDecider.MESSAGE_NOTIFICATION_ID,
					"New message",
					"Open Grind",
					"/chat/conversation-1",
				),
				PendingNotification(
					NotificationDecider.TAP_NOTIFICATION_ID,
					"New tap",
					"Open Grind",
					"/interest/taps",
				),
			),
			decision.notifications,
		)
	}

	@Test
	fun `foreground poll advances watermarks but suppresses alerts`() {
		val decision = NotificationDecider.decide(
			result = result(),
			settings = privateSettings.copy(showPreviews = true),
			messageInitialized = true,
			tapInitialized = true,
			messageWatermark = NotificationWatermark(99),
			tapWatermark = NotificationWatermark(100),
			foreground = true,
		)

		assertTrue(decision.notifications.isEmpty())
		assertEquals(100, decision.messageWatermark.timestamp)
		assertEquals(101, decision.tapWatermark.timestamp)
	}

	@Test
	fun `unsafe conversation identifier falls back to inbox`() {
		assertEquals("/chat", NotificationDecider.safeChatRoute("../settings"))
	}

	private fun result() = PollResult.Success(
		accountId = "42",
		messages = listOf(
			PollMessage("conversation-1", "Ada", "secret", 100, 1),
		),
		taps = listOf(PollTap(7, "Grace", 101)),
	)
}
