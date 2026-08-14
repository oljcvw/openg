package doctor.andrewcox.opengrind.media

import android.Manifest
import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import app.tauri.annotation.Command
import app.tauri.annotation.Permission
import app.tauri.annotation.PermissionCallback
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import io.agora.rtc2.RtcEngine
import doctor.andrewcox.opengrind.BuildConfig

@TauriPlugin(
	permissions = [
		Permission(
			strings = [
				Manifest.permission.CAMERA,
				Manifest.permission.RECORD_AUDIO,
				Manifest.permission.BLUETOOTH_CONNECT,
			],
			alias = VideoCallPlugin.CALL_MEDIA_PERMISSION_ALIAS,
		),
	],
)
class VideoCallPlugin(private val activity: Activity) : Plugin(activity) {
	private val permissionPreferences by lazy {
		activity.getSharedPreferences(PERMISSION_PREFERENCES, Context.MODE_PRIVATE)
	}
	private val listener = object : AgoraCallBridge.Listener {
		override fun onRemoteUserJoined(uid: Int) {
			trigger(REMOTE_USER_JOINED_EVENT, JSObject().apply { put("uid", uid) })
		}

		override fun onEnded(reason: String, durationMs: Long) {
			trigger(ENDED_EVENT, JSObject().apply {
				put("reason", reason)
				put("durationMs", durationMs)
			})
		}
	}

	@Command
	fun availability(invoke: Invoke) {
		val appIdConfigured = BuildConfig.OPEN_GRIND_AGORA_APP_ID.isNotBlank()
		val cameraStatus = permissionStatus(Manifest.permission.CAMERA, CAMERA_PERMISSION_REQUESTED)
		val microphoneStatus = permissionStatus(
			Manifest.permission.RECORD_AUDIO,
			MICROPHONE_PERMISSION_REQUESTED,
		)
		val bluetoothStatus = bluetoothPermissionStatus()
		invoke.resolve(JSObject().apply {
			put("available", appIdConfigured)
			put("buildConfigured", appIdConfigured)
			put(
				"permissionsGranted",
				cameraStatus == "granted" && microphoneStatus == "granted" && bluetoothStatus == "granted",
			)
			put("cameraPermission", cameraStatus)
			put("microphonePermission", microphoneStatus)
			put("bluetoothPermission", bluetoothStatus)
			put("reason", when {
				!appIdConfigured -> "app-id-not-configured"
				cameraStatus != "granted" || microphoneStatus != "granted" || bluetoothStatus != "granted" -> "permissions-required"
				else -> "available"
			})
			put("sdkVersion", RtcEngine.getSdkVersion())
		})
	}

	@Command
	fun start(invoke: Invoke) {
		if (BuildConfig.OPEN_GRIND_AGORA_APP_ID.isBlank()) {
			invoke.reject("agora-unavailable")
			return
		}
		if (!hasCallPermissions()) {
			markPermissionsRequested()
			requestPermissionForAlias(CALL_MEDIA_PERMISSION_ALIAS, invoke, "startPermissionResult")
			return
		}
		launch(invoke)
	}

	@Command
	fun requestCallPermissions(invoke: Invoke) {
		if (hasCallPermissions()) {
			invoke.resolve(permissionJson())
			return
		}
		markPermissionsRequested()
		requestPermissionForAlias(CALL_MEDIA_PERMISSION_ALIAS, invoke, "permissionResult")
	}

	@PermissionCallback
	fun permissionResult(invoke: Invoke) {
		invoke.resolve(permissionJson())
	}

	@PermissionCallback
	fun startPermissionResult(invoke: Invoke) {
		if (!hasCallPermissions()) {
			invoke.reject("video-call-media-permissions-required")
			return
		}
		launch(invoke)
	}

	private fun launch(invoke: Invoke) {
		if (!AgoraCallBridge.reserveLaunch()) {
			invoke.reject("video-call-already-active")
			return
		}
		try {
			val args = invoke.getArgs()
			val token = args.getString("token")
			val channel = args.getString("channel")
			val uid = args.optInt("uid", 0)
			val quality = CallQuality.parse(args.optString("quality", "auto"))
			AgoraCallBridge.listener = listener
			activity.startActivity(Intent(activity, AgoraVideoCallActivity::class.java).apply {
				putExtra(AgoraVideoCallActivity.EXTRA_TOKEN, token)
				putExtra(AgoraVideoCallActivity.EXTRA_CHANNEL, channel)
				putExtra(AgoraVideoCallActivity.EXTRA_UID, uid)
				putExtra(AgoraVideoCallActivity.EXTRA_QUALITY, quality.wireValue)
				putExtra(
					AgoraVideoCallActivity.EXTRA_CONNECTED_LIMIT_SECONDS,
					args.optInt("connectedLimitSeconds", MAX_CONNECTED_SECONDS),
				)
			})
			invoke.resolve()
		} catch (_: Exception) {
			AgoraCallBridge.cancelLaunch()
			AgoraCallBridge.listener = null
			invoke.reject("invalid-video-call-arguments")
		}
	}

	@Command
	fun renewToken(invoke: Invoke) {
		val token = invoke.getArgs().optString("token")
		if (token.isBlank() || !AgoraCallBridge.renewToken(token)) {
			invoke.reject("video-call-not-active")
			return
		}
		invoke.resolve()
	}

	@Command
	fun stop(invoke: Invoke) {
		if (!AgoraCallBridge.stop()) {
			invoke.reject("video-call-not-active")
			return
		}
		invoke.resolve()
	}

	override fun onDestroy(activity: AppCompatActivity) {
		if (AgoraCallBridge.listener === listener) AgoraCallBridge.listener = null
	}

	private fun markPermissionsRequested() {
		permissionPreferences.edit()
			.putBoolean(CAMERA_PERMISSION_REQUESTED, true)
			.putBoolean(MICROPHONE_PERMISSION_REQUESTED, true)
			.putBoolean(BLUETOOTH_PERMISSION_REQUESTED, true)
			.apply()
	}

	private fun hasPermission(permission: String): Boolean =
		ContextCompat.checkSelfPermission(activity, permission) == PackageManager.PERMISSION_GRANTED

	private fun hasCallPermissions(): Boolean =
		hasPermission(Manifest.permission.CAMERA) &&
			hasPermission(Manifest.permission.RECORD_AUDIO) &&
			bluetoothPermissionStatus() == "granted"

	private fun permissionJson() = JSObject().apply {
		put("cameraPermission", permissionStatus(Manifest.permission.CAMERA, CAMERA_PERMISSION_REQUESTED))
		put(
			"microphonePermission",
			permissionStatus(Manifest.permission.RECORD_AUDIO, MICROPHONE_PERMISSION_REQUESTED),
		)
		put("bluetoothPermission", bluetoothPermissionStatus())
		put("permissionsGranted", hasCallPermissions())
	}

	private fun bluetoothPermissionStatus(): String =
		if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) {
			"granted"
		} else {
			permissionStatus(Manifest.permission.BLUETOOTH_CONNECT, BLUETOOTH_PERMISSION_REQUESTED)
		}

	private fun permissionStatus(permission: String, requestedKey: String): String {
		if (hasPermission(permission)) return "granted"
		if (!permissionPreferences.getBoolean(requestedKey, false)) return "prompt"
		return if (ActivityCompat.shouldShowRequestPermissionRationale(activity, permission)) {
			"denied"
		} else {
			"blocked"
		}
	}

	companion object {
		const val CALL_MEDIA_PERMISSION_ALIAS = "call-media"
		const val REMOTE_USER_JOINED_EVENT = "remote-user-joined"
		const val ENDED_EVENT = "ended"
		private const val PERMISSION_PREFERENCES = "open-grind-video-call"
		private const val CAMERA_PERMISSION_REQUESTED = "camera-permission-requested"
		private const val MICROPHONE_PERMISSION_REQUESTED = "microphone-permission-requested"
		private const val BLUETOOTH_PERMISSION_REQUESTED = "bluetooth-permission-requested"
		private const val MAX_CONNECTED_SECONDS = 60
	}
}

internal enum class CallQuality(
	val wireValue: String,
	val width: Int,
	val height: Int,
) {
	AUTO("auto", 640, 480),
	HIGH("high", 640, 480),
	LOW("low", 320, 240);

	companion object {
		fun parse(value: String?): CallQuality = entries.firstOrNull { it.wireValue == value } ?: AUTO
	}
}
