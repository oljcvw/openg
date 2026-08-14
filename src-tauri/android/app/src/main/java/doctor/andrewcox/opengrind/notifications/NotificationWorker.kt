package doctor.andrewcox.opengrind.notifications

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.ProcessLifecycleOwner
import androidx.work.Worker
import androidx.work.WorkerParameters
import doctor.andrewcox.opengrind.logging.AppLog
import doctor.andrewcox.opengrind.realtime.shouldBlockLocationWifiBackgroundTraffic

class NotificationWorker(
	appContext: Context,
	workerParameters: WorkerParameters,
) : Worker(appContext, workerParameters) {
	override fun doWork(): Result {
		val preferences = NotificationPreferences(applicationContext)
		val settings = preferences.settings()
		if (!settings.enabled) return Result.success()
		if (!settings.messages && !settings.taps) {
			AppLog.info(applicationContext, TAG, "poll skipped: no enabled categories")
			return Result.success()
		}
		if (isForeground()) {
			AppLog.info(applicationContext, TAG, "poll skipped: app foreground")
			return Result.success()
		}
		if (locationWifiSafetyBlocksPoll()) {
			AppLog.info(applicationContext, TAG, "poll skipped: location Wi-Fi safety")
			return Result.success()
		}
		val notifier = NotificationNotifier(applicationContext)
		if (!notifier.canNotify()) {
			AppLog.info(applicationContext, TAG, "poll skipped: notification permission unavailable")
			return Result.success()
		}

		AppLog.info(applicationContext, TAG, "poll started")
		return when (val result = tryPoll(settings)) {
			PollResult.SignedOut -> {
				NotificationScheduler.cancel(applicationContext)
				Result.success()
			}
			PollResult.Deferred -> {
				AppLog.info(applicationContext, TAG, "poll deferred by API runtime")
				Result.success()
			}
			is PollResult.Failed -> {
				AppLog.warn(applicationContext, TAG, "poll failed: ${result.code.wireName}")
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
		AppLog.warn(applicationContext, TAG, "notification bridge failed", error)
		PollResult.Failed(PollFailureCode.AndroidBridge)
	}

	private fun isForeground(): Boolean =
		ProcessLifecycleOwner.get().lifecycle.currentState
			.isAtLeast(Lifecycle.State.STARTED)

	private fun locationWifiSafetyBlocksPoll(): Boolean {
		val active = applicationContext
			.getSharedPreferences("location_wifi_safety", Context.MODE_PRIVATE)
			.getBoolean("manual_location_active", false)
		if (!active) return false
		val manager = applicationContext.getSystemService(ConnectivityManager::class.java)
		val network = manager.activeNetwork
		val capabilities = network?.let(manager::getNetworkCapabilities)
		return shouldBlockLocationWifiBackgroundTraffic(
			manualLocationActive = true,
			known = capabilities != null,
			connected = capabilities
				?.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) == true,
		)
	}

	private fun process(
		result: PollResult.Success,
		preferences: NotificationPreferences,
		notifier: NotificationNotifier,
	): Result {
		val messageInitialized = preferences.isMessageInitialized(result.accountId)
		val tapInitialized = preferences.isTapInitialized(result.accountId)
		val processed = processNotificationResult(
			result = result,
			messageInitialized = messageInitialized,
			tapInitialized = tapInitialized,
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
			AppLog.info(applicationContext, TAG, "poll result suppressed by current notification state")
			return Result.success()
		}
		val decision = processed.decision

		preferences.saveMessageWatermark(result.accountId, decision.messageWatermark)
		preferences.saveTapWatermark(result.accountId, decision.tapWatermark)
		if (preferences.settings().messages) preferences.initializeMessages(result.accountId)
		if (preferences.settings().taps) preferences.initializeTaps(result.accountId)

		preferences.recordSuccess(System.currentTimeMillis())
		if (processed.failedCount > 0) preferences.recordFailure()
		AppLog.info(
			applicationContext,
			TAG,
			"poll completed: displayed=${processed.displayedCount} blocked=${processed.blockedCount} failed=${processed.failedCount}",
		)
		return Result.success()
	}

	private companion object {
		const val TAG = "OpenGrindNotifications"
	}
}
