package doctor.andrewcox.opengrind.notifications

data class PendingNotification(
	val id: Int,
	val title: String,
	val body: String,
	val route: String,
)

data class PollDecision(
	val notifications: List<PendingNotification>,
	val messageWatermark: NotificationWatermark,
	val tapWatermark: NotificationWatermark,
)

object NotificationDecider {
	const val MESSAGE_NOTIFICATION_ID = 4101
	const val TAP_NOTIFICATION_ID = 4102

	fun decide(
		result: PollResult.Success,
		settings: StoredNotificationSettings,
		messageInitialized: Boolean,
		tapInitialized: Boolean,
		messageWatermark: NotificationWatermark,
		tapWatermark: NotificationWatermark,
		foreground: Boolean,
	): PollDecision {
		val newMessages = messageWatermark.unseen(
			result.messages,
			PollMessage::timestamp,
			PollMessage::conversationId,
		)
		val newTaps = tapWatermark.unseen(
			result.taps,
			PollTap::timestamp,
		) { it.profileId.toString() }
		val nextMessageWatermark = messageWatermark.advanced(
			result.messages,
			PollMessage::timestamp,
			PollMessage::conversationId,
		)
		val nextTapWatermark = tapWatermark.advanced(
			result.taps,
			PollTap::timestamp,
		) { it.profileId.toString() }

		if (foreground) {
			return PollDecision(emptyList(), nextMessageWatermark, nextTapWatermark)
		}

		val notifications = buildList {
			if (settings.messages && messageInitialized && newMessages.isNotEmpty()) {
				add(formatMessages(newMessages, settings.showPreviews))
			}
			if (settings.taps && tapInitialized && newTaps.isNotEmpty()) {
				add(formatTaps(newTaps, settings.showPreviews))
			}
		}
		return PollDecision(notifications, nextMessageWatermark, nextTapWatermark)
	}

	private fun formatMessages(
		messages: List<PollMessage>,
		showPreviews: Boolean,
	): PendingNotification {
		if (messages.size == 1) {
			val message = messages.single()
			return PendingNotification(
				id = MESSAGE_NOTIFICATION_ID,
				title = if (showPreviews) message.title else "New message",
				body = if (showPreviews) {
					message.preview ?: "Open Grind message"
				} else {
					"Open Grind"
				},
				route = safeChatRoute(message.conversationId),
			)
		}
		return PendingNotification(
			id = MESSAGE_NOTIFICATION_ID,
			title = "${messages.size} new conversations",
			body = "Open Grind",
			route = "/chat",
		)
	}

	private fun formatTaps(
		taps: List<PollTap>,
		showPreviews: Boolean,
	): PendingNotification {
		if (taps.size == 1) {
			val tap = taps.single()
			return PendingNotification(
				id = TAP_NOTIFICATION_ID,
				title = "New tap",
				body = if (showPreviews && tap.displayName != null) {
					"${tap.displayName} tapped you"
				} else {
					"Open Grind"
				},
				route = "/interest/taps",
			)
		}
		return PendingNotification(
			id = TAP_NOTIFICATION_ID,
			title = "${taps.size} new taps",
			body = "Open Grind",
			route = "/interest/taps",
		)
	}

	internal fun safeChatRoute(conversationId: String): String =
		if (conversationId.matches(SAFE_CONVERSATION_ID)) {
			"/chat/$conversationId"
		} else {
			"/chat"
		}

	private val SAFE_CONVERSATION_ID = Regex("^[A-Za-z0-9:_-]{1,200}$")
}
