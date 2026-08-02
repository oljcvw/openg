package org.opengrind.notifications

internal data class NotificationDeliveryState(
	val settings: StoredNotificationSettings,
	val permissionGranted: Boolean,
	val foreground: Boolean,
) {
	fun canEvaluate(): Boolean =
		settings.enabled &&
			(settings.messages || settings.taps) &&
			permissionGranted

	fun canDeliver(notification: PendingNotification): Boolean =
		canEvaluate() &&
			!foreground &&
			when (notification.id) {
				NotificationDecider.MESSAGE_NOTIFICATION_ID -> settings.messages
				NotificationDecider.TAP_NOTIFICATION_ID -> settings.taps
				else -> false
			}
}

internal data class NotificationProcessingResult(
	val decision: PollDecision,
	val displayedCount: Int,
)

internal fun processNotificationResult(
	result: PollResult.Success,
	initialized: Boolean,
	messageWatermark: NotificationWatermark,
	tapWatermark: NotificationWatermark,
	readState: () -> NotificationDeliveryState,
	display: (PendingNotification) -> Boolean,
): NotificationProcessingResult? {
	val decisionState = readState()
	if (!decisionState.canEvaluate()) return null

	val decision = NotificationDecider.decide(
		result = result,
		settings = decisionState.settings,
		initialized = initialized,
		messageWatermark = messageWatermark,
		tapWatermark = tapWatermark,
		foreground = decisionState.foreground,
	)
	var displayedCount = 0
	for (notification in decision.notifications) {
		if (readState().canDeliver(notification) && display(notification)) {
			displayedCount += 1
		}
	}
	return NotificationProcessingResult(decision, displayedCount)
}
