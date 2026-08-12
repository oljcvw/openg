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
	val blockedCount: Int,
	val failedCount: Int,
)

internal enum class NotificationDisplayResult { Displayed, Blocked, Failed }

internal fun processNotificationResult(
	result: PollResult.Success,
	messageInitialized: Boolean,
	tapInitialized: Boolean,
	messageWatermark: NotificationWatermark,
	tapWatermark: NotificationWatermark,
	readState: () -> NotificationDeliveryState,
	display: (PendingNotification) -> NotificationDisplayResult,
): NotificationProcessingResult? {
	val decisionState = readState()
	if (!decisionState.canEvaluate()) return null

	val decision = NotificationDecider.decide(
		result = result,
		settings = decisionState.settings,
		messageInitialized = messageInitialized,
		tapInitialized = tapInitialized,
		messageWatermark = messageWatermark,
		tapWatermark = tapWatermark,
		foreground = decisionState.foreground,
	)
	var displayedCount = 0
	var blockedCount = 0
	var failedCount = 0
	for (notification in decision.notifications) {
		if (readState().canDeliver(notification)) {
			when (display(notification)) {
				NotificationDisplayResult.Displayed -> displayedCount += 1
				NotificationDisplayResult.Blocked -> blockedCount += 1
				NotificationDisplayResult.Failed -> failedCount += 1
			}
		}
	}
	return NotificationProcessingResult(decision, displayedCount, blockedCount, failedCount)
}
