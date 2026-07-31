package org.opengrind.notifications

import android.content.Context
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import java.util.concurrent.TimeUnit

object NotificationScheduler {
	internal const val UNIQUE_WORK_NAME = "open-grind-notification-poll"
	internal const val REPEAT_MINUTES = 15L

	fun schedule(context: Context) {
		val constraints = Constraints.Builder()
			.setRequiredNetworkType(NetworkType.CONNECTED)
			.build()
		val request = PeriodicWorkRequestBuilder<NotificationWorker>(
			REPEAT_MINUTES,
			TimeUnit.MINUTES,
		)
			.setConstraints(constraints)
			.addTag(UNIQUE_WORK_NAME)
			.build()
		WorkManager.getInstance(context.applicationContext).enqueueUniquePeriodicWork(
			UNIQUE_WORK_NAME,
			ExistingPeriodicWorkPolicy.UPDATE,
			request,
		)
	}

	fun cancel(context: Context) {
		WorkManager.getInstance(context.applicationContext)
			.cancelUniqueWork(UNIQUE_WORK_NAME)
	}
}
