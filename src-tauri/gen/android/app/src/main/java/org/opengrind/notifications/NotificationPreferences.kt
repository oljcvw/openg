package org.opengrind.notifications

import android.content.Context

data class StoredNotificationSettings(
	val enabled: Boolean,
	val messages: Boolean,
	val taps: Boolean,
	val showPreviews: Boolean,
)

class NotificationPreferences(context: Context) {
	private val preferences = context.applicationContext.getSharedPreferences(
		FILE_NAME,
		Context.MODE_PRIVATE,
	)

	fun settings(): StoredNotificationSettings = StoredNotificationSettings(
		enabled = preferences.getBoolean(KEY_ENABLED, false),
		messages = preferences.getBoolean(KEY_MESSAGES, true),
		taps = preferences.getBoolean(KEY_TAPS, true),
		showPreviews = preferences.getBoolean(KEY_PREVIEWS, false),
	)

	fun save(settings: StoredNotificationSettings) {
		preferences.edit()
			.putBoolean(KEY_ENABLED, settings.enabled)
			.putBoolean(KEY_MESSAGES, settings.messages)
			.putBoolean(KEY_TAPS, settings.taps)
			.putBoolean(KEY_PREVIEWS, settings.showPreviews)
			.apply()
	}

	fun pollIntervalMinutes(): Long = normalizedNotificationPollInterval(
		preferences.getLong(KEY_POLL_INTERVAL_MINUTES, DEFAULT_POLL_INTERVAL_MINUTES),
	)

	fun savePollIntervalMinutes(minutes: Long) {
		preferences.edit()
			.putLong(KEY_POLL_INTERVAL_MINUTES, normalizedNotificationPollInterval(minutes))
			.apply()
	}

	fun isInitialized(accountId: String): Boolean =
		preferences.getBoolean(accountKey(accountId, "initialized"), false)

	fun initialize(accountId: String) {
		preferences.edit().putBoolean(accountKey(accountId, "initialized"), true).apply()
	}

	fun messageWatermark(accountId: String): NotificationWatermark =
		readWatermark(accountId, "message")

	fun tapWatermark(accountId: String): NotificationWatermark =
		readWatermark(accountId, "tap")

	fun saveMessageWatermark(accountId: String, watermark: NotificationWatermark) {
		saveWatermark(accountId, "message", watermark)
	}

	fun saveTapWatermark(accountId: String, watermark: NotificationWatermark) {
		saveWatermark(accountId, "tap", watermark)
	}

	fun clearAccount(accountId: String) {
		preferences.edit().apply {
			notificationAccountKeys(accountId).forEach(::remove)
		}.apply()
	}

	fun recordSuccess(timestamp: Long) {
		preferences.edit()
			.putLong(KEY_LAST_SUCCESS, timestamp)
			.remove(KEY_LAST_ERROR)
			.apply()
	}

	fun recordFailure() {
		preferences.edit()
			.putString(KEY_LAST_ERROR, "Background check failed")
			.apply()
	}

	fun lastSuccessfulCheck(): Long? =
		preferences.getLong(KEY_LAST_SUCCESS, 0).takeIf { it > 0 }

	fun lastError(): String? = preferences.getString(KEY_LAST_ERROR, null)

	private fun readWatermark(accountId: String, type: String): NotificationWatermark =
		NotificationWatermark(
			timestamp = preferences.getLong(accountKey(accountId, "${type}_timestamp"), 0),
			idsAtTimestamp = preferences.getStringSet(
				accountKey(accountId, "${type}_ids"),
				emptySet(),
			)?.toSet() ?: emptySet(),
		)

	private fun saveWatermark(
		accountId: String,
		type: String,
		watermark: NotificationWatermark,
	) {
		preferences.edit()
			.putLong(accountKey(accountId, "${type}_timestamp"), watermark.timestamp)
			.putStringSet(accountKey(accountId, "${type}_ids"), watermark.idsAtTimestamp)
			.apply()
	}

	private fun accountKey(accountId: String, suffix: String): String {
		require(accountId.matches(ACCOUNT_ID)) { "Invalid account id" }
		return "account_${accountId}_$suffix"
	}

	private companion object {
		const val FILE_NAME = "notification_preferences"
		const val KEY_ENABLED = "enabled"
		const val KEY_MESSAGES = "messages"
		const val KEY_TAPS = "taps"
		const val KEY_PREVIEWS = "previews"
		const val KEY_POLL_INTERVAL_MINUTES = "poll_interval_minutes"
		const val KEY_LAST_SUCCESS = "last_success"
		const val KEY_LAST_ERROR = "last_error"
		val ACCOUNT_ID = Regex("^[0-9]+$")
	}
}

internal const val DEFAULT_POLL_INTERVAL_MINUTES = 15L
internal const val MAX_POLL_INTERVAL_MINUTES = 1_440L

internal fun normalizedNotificationPollInterval(minutes: Long): Long =
	minutes.coerceIn(DEFAULT_POLL_INTERVAL_MINUTES, MAX_POLL_INTERVAL_MINUTES)

internal fun notificationAccountKeys(accountId: String): Set<String> {
	require(accountId.matches(Regex("^[0-9]+$"))) { "Invalid account id" }
	return setOf(
		"account_${accountId}_initialized",
		"account_${accountId}_message_timestamp",
		"account_${accountId}_message_ids",
		"account_${accountId}_tap_timestamp",
		"account_${accountId}_tap_ids",
	)
}
