package org.opengrind.notifications

import android.content.Context
import io.crates.keyring.Keyring
import org.json.JSONObject

object NotificationBridge {
	@Volatile private var initialized = false
	private val pollLock = Any()

	fun poll(
		context: Context,
		messagesEnabled: Boolean,
		tapsEnabled: Boolean,
	): PollResult = synchronized(pollLock) {
		if (!initialized) {
			System.loadLibrary("open_grind_lib")
			Keyring.initializeNdkContext(context.applicationContext)
			initialized = true
		}
		parse(nativePoll(messagesEnabled, tapsEnabled))
	}

	private external fun nativePoll(
		messagesEnabled: Boolean,
		tapsEnabled: Boolean,
	): String

	internal fun parse(raw: String): PollResult {
		val root = JSONObject(raw)
		return when (root.getString("state")) {
			"ok" -> PollResult.Success(
				accountId = root.getString("accountId"),
				messages = root.getJSONArray("messages").let { messages ->
					(0 until messages.length()).map { index ->
						messages.getJSONObject(index).let { item ->
							PollMessage(
								conversationId = item.getString("conversationId"),
								title = item.getString("title"),
								preview = item.optString("preview").takeIf {
									!item.isNull("preview") && it.isNotBlank()
								},
								timestamp = item.getLong("timestamp"),
								unreadCount = item.getLong("unreadCount"),
							)
						}
					}
				},
				taps = root.getJSONArray("taps").let { taps ->
					(0 until taps.length()).map { index ->
						taps.getJSONObject(index).let { item ->
							PollTap(
								profileId = item.getLong("profileId"),
								displayName = item.optString("displayName").takeIf {
									!item.isNull("displayName") && it.isNotBlank()
								},
								timestamp = item.getLong("timestamp"),
							)
						}
					}
				},
			)
			"signedOut" -> PollResult.SignedOut
			"deferred" -> PollResult.Deferred
			else -> PollResult.Failed(
				PollFailureCode.fromWireName(root.optString("code")),
			)
		}
	}
}

enum class PollFailureCode(val wireName: String) {
	RuntimeUnavailable("runtime_unavailable"),
	SessionUnavailable("session_unavailable"),
	DeviceUnavailable("device_unavailable"),
	SigningKeyUnavailable("signing_key_unavailable"),
	ClientUnavailable("client_unavailable"),
	InboxRequest("inbox_request"),
	InboxResponse("inbox_response"),
	InboxDecode("inbox_decode"),
	TapsRequest("taps_request"),
	TapsResponse("taps_response"),
	TapsDecode("taps_decode"),
	PollPanicked("poll_panicked"),
	ResponseEncoding("response_encoding"),
	AndroidBridge("android_bridge"),
	BackgroundCheckFailed("background_check_failed"),
	;

	companion object {
		fun fromWireName(value: String): PollFailureCode =
			entries.firstOrNull { it.wireName == value } ?: BackgroundCheckFailed
	}
}

sealed interface PollResult {
	data class Success(
		val accountId: String,
		val messages: List<PollMessage>,
		val taps: List<PollTap>,
	) : PollResult

	data object SignedOut : PollResult
	data object Deferred : PollResult
	data class Failed(val code: PollFailureCode) : PollResult
}

data class PollMessage(
	val conversationId: String,
	val title: String,
	val preview: String?,
	val timestamp: Long,
	val unreadCount: Long,
)

data class PollTap(
	val profileId: Long,
	val displayName: String?,
	val timestamp: Long,
)
