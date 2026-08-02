package org.opengrind.notifications

import android.content.Context
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
		if (!preferences.settings().enabled) return Result.success()

		return when (val result = tryPoll()) {
			PollResult.SignedOut -> Result.success()
			PollResult.Deferred -> Result.retry()
			PollResult.Retry -> {
				preferences.recordFailure()
				Result.retry()
			}
			is PollResult.Success -> process(result, preferences)
		}
	}

	private fun tryPoll(): PollResult = try {
		NotificationBridge.poll(applicationContext)
	} catch (_: Exception) {
		PollResult.Retry
	}

	private fun process(
		result: PollResult.Success,
		preferences: NotificationPreferences,
	): Result {
		val initialized = preferences.isInitialized(result.accountId)
		val decision = NotificationDecider.decide(
			result = result,
			settings = preferences.settings(),
			initialized = initialized,
			messageWatermark = preferences.messageWatermark(result.accountId),
			tapWatermark = preferences.tapWatermark(result.accountId),
			foreground = ProcessLifecycleOwner.get().lifecycle.currentState
				.isAtLeast(Lifecycle.State.STARTED),
		)

		preferences.saveMessageWatermark(result.accountId, decision.messageWatermark)
		preferences.saveTapWatermark(result.accountId, decision.tapWatermark)
		if (!initialized) preferences.initialize(result.accountId)

		val notifier = NotificationNotifier(applicationContext)
		for (notification in decision.notifications) notifier.show(notification)
		preferences.recordSuccess(System.currentTimeMillis())
		return Result.success()
	}
}
