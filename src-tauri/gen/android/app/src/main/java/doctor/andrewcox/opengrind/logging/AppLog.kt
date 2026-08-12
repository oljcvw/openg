package doctor.andrewcox.opengrind.logging

import android.content.Context
import android.util.Log

object AppLog {
	private const val PREFERENCES = "open_grind_developer_settings"
	private const val ENABLED = "log_errors_to_logcat"

	fun setEnabled(context: Context, enabled: Boolean) {
		context.applicationContext.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)
			.edit()
			.putBoolean(ENABLED, enabled)
			.apply()
	}

	fun info(context: Context, tag: String, message: String) {
		if (enabled(context)) Log.i(tag, message)
	}

	fun warn(context: Context, tag: String, message: String, error: Throwable? = null) {
		if (!enabled(context)) return
		if (error === null) Log.w(tag, message) else Log.w(tag, message, error)
	}

	private fun enabled(context: Context): Boolean =
		context.applicationContext.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)
			.getBoolean(ENABLED, false)
}
