package org.opengrind.media

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import org.opengrind.MainActivity
import org.opengrind.R

class VideoCallForegroundService : Service() {
	override fun onCreate() {
		super.onCreate()
		createChannel()
	}

	override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
		startForeground(NOTIFICATION_ID, notification())
		return START_NOT_STICKY
	}

	override fun onBind(intent: Intent?): IBinder? = null

	private fun notification(): Notification {
		val openApp = PendingIntent.getActivity(
			this,
			0,
			Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
			PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
		)
		return NotificationCompat.Builder(this, CHANNEL_ID)
			.setSmallIcon(R.drawable.ic_launcher_monochrome)
			.setContentTitle(getString(R.string.video_call_active))
			.setContentText(getString(R.string.video_call_active_description))
			.setContentIntent(openApp)
			.setCategory(NotificationCompat.CATEGORY_CALL)
			.setPriority(NotificationCompat.PRIORITY_HIGH)
			.setOngoing(true)
			.setOnlyAlertOnce(true)
			.build()
	}

	private fun createChannel() {
		val manager = getSystemService(NotificationManager::class.java)
		manager.createNotificationChannel(
			NotificationChannel(
				CHANNEL_ID,
				getString(R.string.video_call_active),
				NotificationManager.IMPORTANCE_HIGH,
			).apply {
				description = getString(R.string.video_call_active_description)
				setSound(null, null)
			},
		)
	}

	companion object {
		private const val CHANNEL_ID = "open-grind-video-calls"
		private const val NOTIFICATION_ID = 41_101

		fun start(context: Context) {
			ContextCompat.startForegroundService(context, Intent(context, VideoCallForegroundService::class.java))
		}

		fun stop(context: Context) {
			context.stopService(Intent(context, VideoCallForegroundService::class.java))
		}
	}
}
