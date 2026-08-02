package org.opengrind.notifications

import android.content.Context
import android.util.Log
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.ProcessLifecycleOwner
import androidx.work.Worker
import androidx.work.WorkerParameters

class NotificationWorker(
	appContext: Context,
	workerParameters: WorkerParameters,
) : Worker(appContext, workerParameters) {
	override fun doWork(): Result {
		val preferences = NotificationPreferences(applicationContext)
		val settings = preferences.settings()
		if (!settings.enabled) return Result.success()
		if (!settings.messages && !settings.taps) {
			Log.i(TAG, "poll skipped: no enabled categories")
			return Result.success()
		}
		if (isForeground()) {
			Log.i(TAG, "poll skipped: app foreground")
			return Result.success()
		}
		val notifier = NotificationNotifier(applicationContext)
		if (!notifier.canNotify()) {
			Log.i(TAG, "poll skipped: notification permission unavailable")
			return Result.success()
		}

		Log.i(TAG, "poll started")
		return when (val result = tryPoll(settings)) {
			PollResult.SignedOut -> Result.success()
			PollResult.Deferred -> {
				Log.i(TAG, "poll deferred by API runtime")
				Result.success()
			}
			is PollResult.Failed -> {
				Log.w(TAG, "poll failed: ${result.code.wireName}")
				preferences.recordFailure()
				Result.success()
			}
			is PollResult.Success -> process(result, preferences, notifier)
		}
	}

	private fun tryPoll(settings: StoredNotificationSettings): PollResult = try {
		NotificationBridge.poll(
			applicationContext,
			messagesEnabled = settings.messages,
			tapsEnabled = settings.taps,
		)
	} catch (error: Exception) {
		Log.w(TAG, "notification bridge failed", error)
		PollResult.Failed(PollFailureCode.AndroidBridge)
	}

	private fun isForeground(): Boolean =
		ProcessLifecycleOwner.get().lifecycle.currentState
			.isAtLeast(Lifecycle.State.STARTED)

	private fun process(
		result: PollResult.Success,
		preferences: NotificationPreferences,
		notifier: NotificationNotifier,
	): Result {
		val initialized = preferences.isInitialized(result.accountId)
		val processed = processNotificationResult(
			result = result,
			initialized = initialized,
			messageWatermark = preferences.messageWatermark(result.accountId),
			tapWatermark = preferences.tapWatermark(result.accountId),
			readState = {
				NotificationDeliveryState(
					settings = preferences.settings(),
					permissionGranted = notifier.canNotify(),
					foreground = isForeground(),
				)
			},
			display = notifier::show,
		)
		if (processed == null) {
			Log.i(TAG, "poll result suppressed by current notification state")
			return Result.success()
		}
		val decision = processed.decision

		preferences.saveMessageWatermark(result.accountId, decision.messageWatermark)
		preferences.saveTapWatermark(result.accountId, decision.tapWatermark)
		if (!initialized) preferences.initialize(result.accountId)

		preferences.recordSuccess(System.currentTimeMillis())
		Log.i(TAG, "poll completed: displayed=${processed.displayedCount}")
		return Result.success()
	}

	private companion object {
		const val TAG = "OpenGrindNotifications"
	}
}
