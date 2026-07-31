package org.opengrind.notifications

import android.Manifest
import android.app.Activity
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.content.ContextCompat
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.Permission
import app.tauri.annotation.PermissionCallback
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin

@TauriPlugin(
	permissions = [
		Permission(
			strings = [Manifest.permission.POST_NOTIFICATIONS],
			alias = NotificationsPlugin.PERMISSION_ALIAS,
		),
	],
)
class NotificationsPlugin(private val activity: Activity) : Plugin(activity) {
	private val preferences by lazy { NotificationPreferences(activity.applicationContext) }
	private val notifier by lazy { NotificationNotifier(activity.applicationContext) }

	@Command
	fun getSettings(invoke: Invoke) {
		notifier.createChannel()
		invoke.resolve(settingsJson())
	}

	@Command
	fun setSettings(invoke: Invoke) {
		val requested = invoke.parseArgs(SettingsArgs::class.java).stored()
		if (requested.enabled && needsPermission()) {
			requestPermissionForAlias(PERMISSION_ALIAS, invoke, "permissionResult")
			return
		}
		applySettings(requested)
		invoke.resolve(settingsJson())
	}

	@PermissionCallback
	fun permissionResult(invoke: Invoke) {
		val requested = invoke.parseArgs(SettingsArgs::class.java).stored()
		applySettings(requested.copy(enabled = requested.enabled && hasPermission()))
		invoke.resolve(settingsJson())
	}

	@Command
	fun testNotification(invoke: Invoke) {
		if (!notifier.showTest()) {
			invoke.reject("Notification permission is not granted")
			return
		}
		invoke.resolve()
	}

	@Command
	fun syncSchedule(invoke: Invoke) {
		if (preferences.settings().enabled && hasPermission()) {
			NotificationScheduler.schedule(activity)
		} else {
			NotificationScheduler.cancel(activity)
		}
		invoke.resolve()
	}

	@Command
	fun cancelSchedule(invoke: Invoke) {
		NotificationScheduler.cancel(activity)
		invoke.resolve()
	}

	@Command
	fun clearAccount(invoke: Invoke) {
		val account = invoke.parseArgs(AccountArgs::class.java)
		try {
			preferences.clearAccount(account.accountId)
			invoke.resolve()
		} catch (_: IllegalArgumentException) {
			invoke.reject("Invalid account id")
		}
	}

	private fun applySettings(settings: StoredNotificationSettings) {
		preferences.save(settings)
		notifier.createChannel()
		if (settings.enabled && hasPermission()) {
			NotificationScheduler.schedule(activity)
		} else {
			NotificationScheduler.cancel(activity)
		}
	}

	private fun settingsJson(): JSObject {
		val settings = preferences.settings()
		return JSObject().apply {
			put("supported", true)
			put("enabled", settings.enabled)
			put("messages", settings.messages)
			put("taps", settings.taps)
			put("showPreviews", settings.showPreviews)
			put("permission", if (hasPermission()) "granted" else "denied")
			put("lastSuccessfulCheck", preferences.lastSuccessfulCheck())
			put("lastError", preferences.lastError())
		}
	}

	private fun needsPermission(): Boolean =
		Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU && !hasPermission()

	private fun hasPermission(): Boolean =
		Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
			ContextCompat.checkSelfPermission(
				activity,
				Manifest.permission.POST_NOTIFICATIONS,
			) == PackageManager.PERMISSION_GRANTED

	@InvokeArg
	data class SettingsArgs(
		val enabled: Boolean = false,
		val messages: Boolean = true,
		val taps: Boolean = true,
		val showPreviews: Boolean = false,
	) {
		fun stored() = StoredNotificationSettings(
			enabled = enabled,
			messages = messages,
			taps = taps,
			showPreviews = showPreviews,
		)
	}

	@InvokeArg
	data class AccountArgs(
		val accountId: String = "",
	)

	companion object {
		const val PERMISSION_ALIAS = "notifications"
	}
}
