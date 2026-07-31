package org.opengrind.notifications

data class NotificationWatermark(
	val timestamp: Long = 0,
	val idsAtTimestamp: Set<String> = emptySet(),
) {
	fun <T> unseen(
		items: List<T>,
		timestampOf: (T) -> Long,
		idOf: (T) -> String,
	): List<T> = items.filter { item ->
		val itemTimestamp = timestampOf(item)
		itemTimestamp > timestamp ||
			(itemTimestamp == timestamp && idOf(item) !in idsAtTimestamp)
	}

	fun <T> advanced(
		items: List<T>,
		timestampOf: (T) -> Long,
		idOf: (T) -> String,
	): NotificationWatermark {
		val newestTimestamp = items.maxOfOrNull(timestampOf) ?: return this
		if (newestTimestamp < timestamp) return this
		val newestIds = items
			.asSequence()
			.filter { timestampOf(it) == newestTimestamp }
			.map(idOf)
			.toSet()
		return if (newestTimestamp == timestamp) {
			copy(idsAtTimestamp = idsAtTimestamp + newestIds)
		} else {
			NotificationWatermark(newestTimestamp, newestIds)
		}
	}
}
