package org.opengrind.notifications

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class NotificationDeliveryTest {
	private val enabled = StoredNotificationSettings(
		enabled = true,
		messages = true,
		taps = true,
		showPreviews = false,
	)

	@Test
	fun `disabled settings suppress a midflight notification`() {
		val states = ArrayDeque(
			listOf(
				state(enabled),
				state(enabled.copy(enabled = false)),
				state(enabled.copy(enabled = false)),
			),
		)
		val displayed = mutableListOf<PendingNotification>()

		val processed = process(states, displayed)

		assertEquals(0, processed?.displayedCount)
		assertEquals(emptyList<PendingNotification>(), displayed)
	}

	@Test
	fun `foreground transition suppresses a midflight notification`() {
		val states = ArrayDeque(
			listOf(
				state(enabled),
				state(enabled, foreground = true),
				state(enabled, foreground = true),
			),
		)
		val displayed = mutableListOf<PendingNotification>()

		val processed = process(states, displayed)

		assertEquals(0, processed?.displayedCount)
		assertEquals(emptyList<PendingNotification>(), displayed)
	}

	@Test
	fun `permission loss suppresses a midflight notification`() {
		val states = ArrayDeque(
			listOf(
				state(enabled),
				state(enabled, permissionGranted = false),
				state(enabled, permissionGranted = false),
			),
		)
		val displayed = mutableListOf<PendingNotification>()

		val processed = process(states, displayed)

		assertEquals(0, processed?.displayedCount)
		assertEquals(emptyList<PendingNotification>(), displayed)
	}

	@Test
	fun `category changes are rechecked before each notification`() {
		val tapsOnly = enabled.copy(messages = false)
		val states = ArrayDeque(
			listOf(
				state(enabled),
				state(tapsOnly),
				state(tapsOnly),
			),
		)
		val displayed = mutableListOf<PendingNotification>()

		val processed = process(states, displayed)

		assertEquals(1, processed?.displayedCount)
		assertEquals(
			listOf(NotificationDecider.TAP_NOTIFICATION_ID),
			displayed.map(PendingNotification::id),
		)
	}

	@Test
	fun `disabled settings prevent watermark decisions`() {
		assertNull(
			processNotificationResult(
				result = result(),
				initialized = true,
				messageWatermark = NotificationWatermark(99),
				tapWatermark = NotificationWatermark(100),
				readState = { state(enabled.copy(enabled = false)) },
				display = { true },
			),
		)
	}

	private fun process(
		states: ArrayDeque<NotificationDeliveryState>,
		displayed: MutableList<PendingNotification>,
	): NotificationProcessingResult? {
		var last = states.first()
		return processNotificationResult(
			result = result(),
			initialized = true,
			messageWatermark = NotificationWatermark(99),
			tapWatermark = NotificationWatermark(100),
			readState = {
				if (states.isNotEmpty()) last = states.removeFirst()
				last
			},
			display = {
				displayed += it
				true
			},
		)
	}

	private fun state(
		settings: StoredNotificationSettings,
		permissionGranted: Boolean = true,
		foreground: Boolean = false,
	) = NotificationDeliveryState(settings, permissionGranted, foreground)

	private fun result() = PollResult.Success(
		accountId = "42",
		messages = listOf(
			PollMessage("conversation-1", "Ada", "secret", 100, 1),
		),
		taps = listOf(PollTap(7, "Grace", 101)),
	)
}
