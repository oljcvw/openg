package org.opengrind.notifications

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import org.opengrind.MainActivity
import org.opengrind.R

class NotificationNotifier(private val context: Context) {
	fun createChannel() {
		if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
		val channel = NotificationChannel(
			CHANNEL_ID,
			"Messages and taps",
			NotificationManager.IMPORTANCE_DEFAULT,
		).apply {
			description = "Background checks for new Open Grind messages and taps"
		}
		context.getSystemService(NotificationManager::class.java)
			.createNotificationChannel(channel)
	}

	fun canNotify(): Boolean {
		val permissionGranted = Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
			ContextCompat.checkSelfPermission(
				context,
				android.Manifest.permission.POST_NOTIFICATIONS,
			) == PackageManager.PERMISSION_GRANTED
		return permissionGranted && NotificationManagerCompat.from(context)
			.areNotificationsEnabled()
	}

	fun show(notification: PendingNotification): Boolean {
		if (!canNotify()) return false
		createChannel()
		val pendingIntent = PendingIntent.getActivity(
			context,
			notification.id,
			Intent(context, MainActivity::class.java).apply {
				flags = Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP
				putExtra(EXTRA_ROUTE, notification.route)
			},
			PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
		)
		val built = NotificationCompat.Builder(context, CHANNEL_ID)
			.setSmallIcon(R.drawable.ic_launcher_monochrome)
			.setContentTitle(notification.title)
			.setContentText(notification.body)
			.setCategory(NotificationCompat.CATEGORY_MESSAGE)
			.setAutoCancel(true)
			.setContentIntent(pendingIntent)
			.build()
		return try {
			NotificationManagerCompat.from(context).notify(notification.id, built)
			true
		} catch (_: SecurityException) {
			false
		}
	}

	fun showTest(): Boolean = show(
		PendingNotification(
			id = TEST_NOTIFICATION_ID,
			title = "Notifications are working",
			body = "Open Grind can notify you in the background",
			route = "/settings/app/notifications",
		),
	)

	companion object {
		const val EXTRA_ROUTE = "org.opengrind.extra.NOTIFICATION_ROUTE"
		private const val CHANNEL_ID = "messages_and_taps"
		private const val TEST_NOTIFICATION_ID = 4199
	}
}
