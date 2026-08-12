package doctor.andrewcox.opengrind.voicerecorder

import android.Manifest
import android.app.Activity
import android.content.Context
import android.content.pm.PackageManager
import android.media.MediaRecorder
import android.os.Build
import android.os.SystemClock
import android.util.Base64
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
import java.io.File
import java.util.UUID

@TauriPlugin(
	permissions = [
		Permission(
			strings = [Manifest.permission.RECORD_AUDIO],
			alias = VoiceRecorderPlugin.PERMISSION_ALIAS,
		),
	],
)
class VoiceRecorderPlugin(private val activity: Activity) : Plugin(activity) {
	private val preferences by lazy {
		activity.getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE)
	}
	private var recorder: MediaRecorder? = null
	private var outputFile: File? = null
	private var startedAtMs: Long = 0
	private var maxDurationResult: JSObject? = null

	@Command
	fun getPermissionStatus(invoke: Invoke) {
		invoke.resolve(permissionJson())
	}

	@Command
	fun requestPermission(invoke: Invoke) {
		if (hasPermission()) {
			invoke.resolve(permissionJson())
			return
		}
		preferences.edit().putBoolean(PERMISSION_REQUESTED_KEY, true).apply()
		requestPermissionForAlias(PERMISSION_ALIAS, invoke, "permissionResult")
	}

	@PermissionCallback
	fun permissionResult(invoke: Invoke) {
		invoke.resolve(permissionJson())
	}

	@Command
	fun startRecording(invoke: Invoke) {
		if (!hasPermission()) {
			invoke.reject("Microphone permission is not granted")
			return
		}
		if (recorder != null || maxDurationResult != null) {
			invoke.reject("A voice recording is already active")
			return
		}

		val file = File(activity.cacheDir, "${UUID.randomUUID()}.tmp")
		val nextRecorder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
			MediaRecorder(activity)
		} else {
			@Suppress("DEPRECATION")
			MediaRecorder()
		}

		try {
			nextRecorder.setAudioSource(MediaRecorder.AudioSource.VOICE_COMMUNICATION)
			nextRecorder.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
			nextRecorder.setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
			nextRecorder.setAudioSamplingRate(SAMPLE_RATE_HZ)
			nextRecorder.setAudioEncodingBitRate(BIT_RATE_BPS)
			nextRecorder.setMaxDuration(MAX_DURATION_MS)
			nextRecorder.setOutputFile(file.absolutePath)
			nextRecorder.setOnInfoListener { _, what, _ ->
				if (what == MediaRecorder.MEDIA_RECORDER_INFO_MAX_DURATION_REACHED) {
					finishAtMaximumDuration()
				}
			}
			nextRecorder.setOnErrorListener { _, _, _ ->
				cancelActiveRecording()
				trigger(RECORDING_ERROR_EVENT, JSObject())
			}
			nextRecorder.prepare()
			nextRecorder.start()
			recorder = nextRecorder
			outputFile = file
			startedAtMs = SystemClock.elapsedRealtime()
			invoke.resolve()
		} catch (_: Exception) {
			releaseRecorder(nextRecorder)
			deleteFile(file)
			clearState()
			invoke.reject("Unable to start voice recording")
		}
	}

	@Command
	fun stopRecording(invoke: Invoke) {
		maxDurationResult?.let { completed ->
			maxDurationResult = null
			invoke.resolve(completed)
			return
		}
		val completed = finishRecording() ?: run {
			invoke.reject("No voice recording is active")
			return
		}
		invoke.resolve(completed)
	}

	@Command
	fun cancelRecording(invoke: Invoke) {
		cancelActiveRecording()
		invoke.resolve()
	}

	override fun onPause() {
		cancelActiveRecording()
	}

	override fun onDestroy(activity: AppCompatActivity) {
		cancelActiveRecording()
	}

	private fun finishAtMaximumDuration() {
		val completed = finishRecording() ?: return
		maxDurationResult = completed
		trigger(MAX_DURATION_EVENT, completed)
	}

	private fun finishRecording(): JSObject? {
		val activeRecorder = recorder ?: return null
		val file = outputFile ?: return null
		val durationMs = (SystemClock.elapsedRealtime() - startedAtMs)
			.coerceIn(0, MAX_DURATION_MS.toLong())

		try {
			activeRecorder.stop()
		} catch (_: RuntimeException) {
		}
		releaseRecorder(activeRecorder)
		clearState()

		if (durationMs < MIN_DURATION_MS || !file.isFile || file.length() == 0L) {
			deleteFile(file)
			return tooShortJson()
		}

		return try {
			val encoded = Base64.encodeToString(file.readBytes(), Base64.NO_WRAP)
			readyJson(encoded, durationMs)
		} catch (_: Exception) {
			null
		} finally {
			deleteFile(file)
		}
	}

	private fun cancelActiveRecording() {
		val activeRecorder = recorder
		val file = outputFile
		maxDurationResult = null
		if (activeRecorder != null) {
			try {
				activeRecorder.stop()
			} catch (_: RuntimeException) {
			}
			releaseRecorder(activeRecorder)
		}
		deleteFile(file)
		clearState()
	}

	private fun releaseRecorder(activeRecorder: MediaRecorder) {
		try {
			activeRecorder.reset()
		} catch (_: RuntimeException) {
		}
		activeRecorder.release()
	}

	private fun clearState() {
		recorder = null
		outputFile = null
		startedAtMs = 0
	}

	private fun permissionJson() = JSObject().apply {
		put("status", permissionStatus())
	}

	private fun permissionStatus(): String {
		if (hasPermission()) return "granted"
		if (!preferences.getBoolean(PERMISSION_REQUESTED_KEY, false)) return "prompt"
		return if (ActivityCompat.shouldShowRequestPermissionRationale(
				activity,
				Manifest.permission.RECORD_AUDIO,
			)
		) "denied" else "blocked"
	}

	private fun hasPermission(): Boolean =
		ContextCompat.checkSelfPermission(
			activity,
			Manifest.permission.RECORD_AUDIO,
		) == PackageManager.PERMISSION_GRANTED

	private fun readyJson(dataBase64: String, durationMs: Long) = JSObject().apply {
		put("status", "ready")
		put("dataBase64", dataBase64)
		put("contentType", CONTENT_TYPE)
		put("durationMs", durationMs)
	}

	private fun tooShortJson() = JSObject().apply {
		put("status", "tooShort")
	}

	private fun deleteFile(file: File?) {
		if (file?.exists() == true) file.delete()
	}

	companion object {
		const val PERMISSION_ALIAS = "microphone"
		const val MAX_DURATION_EVENT = "max-duration"
		const val RECORDING_ERROR_EVENT = "recording-error"
		const val SAMPLE_RATE_HZ = 16_000
		const val BIT_RATE_BPS = 32_000
		const val MAX_DURATION_MS = 60_000
		const val MIN_DURATION_MS = 1_000L
		const val CONTENT_TYPE = "audio/aac"
		private const val PREFERENCES_NAME = "open-grind-voice-recorder"
		private const val PERMISSION_REQUESTED_KEY = "permission-requested"
	}
}
