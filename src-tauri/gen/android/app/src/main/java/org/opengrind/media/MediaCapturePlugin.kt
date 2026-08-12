package org.opengrind.media

import android.Manifest
import android.app.Activity
import android.content.ClipData
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.provider.MediaStore
import android.util.Base64
import androidx.activity.result.ActivityResult
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import app.tauri.annotation.ActivityCallback
import app.tauri.annotation.Command
import app.tauri.annotation.Permission
import app.tauri.annotation.PermissionCallback
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import com.canhub.cropper.CropImageContract
import com.canhub.cropper.CropImageContractOptions
import com.canhub.cropper.CropImageOptions
import com.canhub.cropper.CropImageView
import java.io.File
import java.util.UUID

@TauriPlugin(
	permissions = [
		Permission(
			strings = [Manifest.permission.CAMERA],
			alias = MediaCapturePlugin.CAMERA_PERMISSION_ALIAS,
		),
	],
)
class MediaCapturePlugin(private val activity: Activity) : Plugin(activity) {
	private val permissionPreferences by lazy {
		activity.getSharedPreferences(PERMISSION_PREFERENCES, Context.MODE_PRIVATE)
	}
	private val capturesDir by lazy { File(activity.cacheDir, CAPTURES_DIR).apply(File::mkdirs) }
	private var pendingPhoto: File? = null
	private var pendingCrop: File? = null
	private val shortVideoCache by lazy { ShortVideoCache(activity.applicationContext) }

	@Command
	fun getCameraPermissionStatus(invoke: Invoke) {
		invoke.resolve(permissionJson())
	}

	@Command
	fun requestCameraPermission(invoke: Invoke) {
		if (hasCameraPermission()) {
			invoke.resolve(permissionJson())
			return
		}
		permissionPreferences.edit().putBoolean(CAMERA_PERMISSION_REQUESTED, true).apply()
		requestPermissionForAlias(CAMERA_PERMISSION_ALIAS, invoke, "cameraPermissionResult")
	}

	@PermissionCallback
	fun cameraPermissionResult(invoke: Invoke) {
		invoke.resolve(permissionJson())
	}

	@Command
	fun capturePhoto(invoke: Invoke) {
		if (!hasCameraPermission()) {
			invoke.reject(ERROR_CAMERA_PERMISSION)
			return
		}
		if (pendingPhoto != null) {
			invoke.reject(ERROR_CAPTURE_ACTIVE)
			return
		}
		val intent = Intent(MediaStore.ACTION_IMAGE_CAPTURE)
		if (intent.resolveActivity(activity.packageManager) == null) {
			invoke.reject(ERROR_CAMERA_UNAVAILABLE)
			return
		}
		val file = File(capturesDir, "photo-${UUID.randomUUID()}.jpg")
		val uri = FileProvider.getUriForFile(activity, "${activity.packageName}.fileprovider", file)
		pendingPhoto = file
		intent.putExtra(MediaStore.EXTRA_OUTPUT, uri)
		intent.clipData = ClipData.newRawUri("Open Grind photo", uri)
		intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
		startActivityForResult(invoke, intent, "photoCaptureResult")
	}

	@ActivityCallback
	fun photoCaptureResult(invoke: Invoke, result: ActivityResult) {
		val file = pendingPhoto
		if (result.resultCode != Activity.RESULT_OK || file?.isFile != true || file.length() == 0L) {
			deletePendingPhoto()
			invoke.reject(ERROR_CANCELLED)
			return
		}
		val sourceUri = FileProvider.getUriForFile(activity, "${activity.packageName}.fileprovider", file)
		val cropFile = File(capturesDir, "crop-${UUID.randomUUID()}.jpg")
		val cropUri = Uri.fromFile(cropFile)
		pendingCrop = cropFile
		val options = CropImageContractOptions(
			sourceUri,
			CropImageOptions(
				fixAspectRatio = false,
				allowRotation = true,
				allowFlipping = true,
				allowCounterRotation = true,
				guidelines = CropImageView.Guidelines.ON,
				customOutputUri = cropUri,
				outputCompressFormat = android.graphics.Bitmap.CompressFormat.JPEG,
				outputCompressQuality = 100,
			),
		)
		val cropIntent = CropImageContract().createIntent(activity, options)
		startActivityForResult(invoke, cropIntent, "photoCropResult")
	}

	@ActivityCallback
	fun photoCropResult(invoke: Invoke, result: ActivityResult) {
		val cropResult = CropImageContract().parseResult(result.resultCode, result.data)
		val captured = pendingPhoto
		val cropped = pendingCrop
		pendingPhoto = null
		pendingCrop = null
		try {
			if (result.resultCode != Activity.RESULT_OK || cropResult.uriContent == null || cropped?.isFile != true) {
				invoke.reject(ERROR_CANCELLED)
				return
			}
			val processed = CapturedImageProcessor(activity).process(cropped)
			invoke.resolve(JSObject().apply {
				put("status", "ready")
				put("dataBase64", Base64.encodeToString(processed.bytes, Base64.NO_WRAP))
				put("contentType", "image/jpeg")
				put("byteLength", processed.bytes.size)
				put("width", processed.width)
				put("height", processed.height)
				put("takenOnGrindr", true)
			})
		} catch (_: Exception) {
			invoke.reject(ERROR_PROCESSING)
		} finally {
			captured?.delete()
			cropped?.delete()
		}
	}

	@Command
	fun captureShortVideo(invoke: Invoke) {
		if (!hasCameraPermission()) {
			invoke.reject(ERROR_CAMERA_PERMISSION)
			return
		}
		startActivityForResult(
			invoke,
			Intent(activity, ShortVideoCaptureActivity::class.java),
			"shortVideoResult",
		)
	}

	@ActivityCallback
	fun shortVideoResult(invoke: Invoke, result: ActivityResult) {
		if (result.resultCode != Activity.RESULT_OK) {
			invoke.reject(ERROR_CANCELLED)
			return
		}
		val data = result.data ?: run {
			invoke.reject(ERROR_PROCESSING)
			return
		}
		invoke.resolve(JSObject().apply {
			put("status", "ready")
			put("captureId", data.getStringExtra(ShortVideoCaptureActivity.EXTRA_CAPTURE_ID))
			put("filePath", data.getStringExtra(ShortVideoCaptureActivity.EXTRA_FILE_PATH))
			put("contentType", "video/mp4")
			put("durationMs", data.getLongExtra(ShortVideoCaptureActivity.EXTRA_DURATION_MS, 0L))
			put("byteLength", data.getLongExtra(ShortVideoCaptureActivity.EXTRA_BYTE_LENGTH, 0L))
			put("width", data.getIntExtra(ShortVideoCaptureActivity.EXTRA_WIDTH, 0))
			put("height", data.getIntExtra(ShortVideoCaptureActivity.EXTRA_HEIGHT, 0))
			put("hasAudio", data.getBooleanExtra(ShortVideoCaptureActivity.EXTRA_HAS_AUDIO, false))
		})
	}

	@Command
	fun readShortVideo(invoke: Invoke) {
		val captureId = invoke.getArgs().optString("captureId")
		val file = captureFile(captureId)
		if (file?.isFile != true) {
			invoke.reject(ERROR_CAPTURE_NOT_FOUND)
			return
		}
		try {
			invoke.resolve(JSObject().apply {
				put("dataBase64", Base64.encodeToString(file.readBytes(), Base64.NO_WRAP))
				put("contentType", "video/mp4")
				put("byteLength", file.length())
			})
		} catch (_: Exception) {
			invoke.reject(ERROR_PROCESSING)
		}
	}

	@Command
	fun deleteShortVideo(invoke: Invoke) {
		captureFile(invoke.getArgs().optString("captureId"))?.delete()
		invoke.resolve()
	}

	@Command
	fun cacheShortVideo(invoke: Invoke) {
		try {
			val args = invoke.getArgs()
			val accountId = args.getString("accountId")
			val mediaId = args.getString("mediaId")
			val writeToken = args.getString("writeToken")
			val cacheGeneration = args.getLong("cacheGeneration")
			val bytes = Base64.decode(args.getString("dataBase64"), Base64.DEFAULT)
			val maximumBytes = normalizedCacheLimit(args.optLong("maximumBytes", DEFAULT_CACHE_BYTES))
			invoke.resolve(
				cacheStatsJson(
					shortVideoCache.put(
						accountId,
						mediaId,
						bytes,
						maximumBytes,
						writeToken,
						cacheGeneration,
					),
				),
			)
			trigger(CACHE_CHANGED_EVENT, cacheStatsJson(shortVideoCache.stats()))
		} catch (_: Exception) {
			invoke.reject(ERROR_CACHE)
		}
	}

	@Command
	fun getCachedShortVideo(invoke: Invoke) {
		try {
			val args = invoke.getArgs()
			val bytes = shortVideoCache.get(args.getString("accountId"), args.getString("mediaId"))
			invoke.resolve(JSObject().apply {
				put("found", bytes != null)
				if (bytes != null) {
					put("dataBase64", Base64.encodeToString(bytes, Base64.NO_WRAP))
					put("contentType", "video/mp4")
					put("byteLength", bytes.size)
				}
			})
		} catch (_: Exception) {
			invoke.reject(ERROR_CACHE)
		}
	}

	@Command
	fun removeCachedShortVideo(invoke: Invoke) {
		try {
			val args = invoke.getArgs()
			val removed = shortVideoCache.remove(args.getString("accountId"), args.getString("mediaId"))
			invoke.resolve(JSObject().apply { put("removed", removed) })
			trigger(CACHE_CHANGED_EVENT, cacheStatsJson(shortVideoCache.stats()))
		} catch (_: Exception) {
			invoke.reject(ERROR_CACHE)
		}
	}

	@Command
	fun removeCachedShortVideoIfToken(invoke: Invoke) {
		try {
			val args = invoke.getArgs()
			val cleanup = shortVideoCache.removeIfWriteToken(
				args.getString("accountId"),
				args.getString("mediaId"),
				args.getString("writeToken"),
			)
			invoke.resolve(JSObject().apply {
				put("removed", cleanup.removed)
				put("staleWriteAbsent", cleanup.staleWriteAbsent)
			})
			trigger(CACHE_CHANGED_EVENT, cacheStatsJson(shortVideoCache.stats()))
		} catch (_: Exception) {
			invoke.reject(ERROR_CACHE)
		}
	}

	@Command
	fun clearShortVideoCache(invoke: Invoke) {
		try {
			val accountId = invoke.getArgs().optString("accountId").takeIf(String::isNotBlank)
			val cacheGeneration = invoke.getArgs().getLong("cacheGeneration")
			if (accountId == null) {
				shortVideoCache.clearAll(cacheGeneration)
			} else {
				shortVideoCache.clearAccount(accountId, cacheGeneration)
			}
			val stats = cacheStatsJson(shortVideoCache.stats())
			invoke.resolve(stats)
			trigger(CACHE_CHANGED_EVENT, stats)
		} catch (_: Exception) {
			invoke.reject(ERROR_CACHE)
		}
	}

	@Command
	fun trimShortVideoCache(invoke: Invoke) {
		try {
			val maximumBytes = normalizedCacheLimit(
				invoke.getArgs().optLong("maximumBytes", DEFAULT_CACHE_BYTES),
			)
			val stats = cacheStatsJson(shortVideoCache.trimToBytes(maximumBytes))
			invoke.resolve(stats)
			trigger(CACHE_CHANGED_EVENT, stats)
		} catch (_: Exception) {
			invoke.reject(ERROR_CACHE)
		}
	}

	@Command
	fun getShortVideoCacheStats(invoke: Invoke) {
		invoke.resolve(cacheStatsJson(shortVideoCache.stats()))
	}

	@Command
	fun startVideoCallService(invoke: Invoke) {
		try {
			VideoCallForegroundService.start(activity)
			invoke.resolve()
		} catch (_: Exception) {
			invoke.reject("Unable to start video call foreground service")
		}
	}

	@Command
	fun stopVideoCallService(invoke: Invoke) {
		VideoCallForegroundService.stop(activity)
		invoke.resolve()
	}

	private fun captureFile(captureId: String?): File? {
		if (!CaptureIdentifiers.isValid(captureId)) return null
		return File(capturesDir, "video-$captureId.mp4")
	}

	private fun permissionJson() = JSObject().apply { put("status", cameraPermissionStatus()) }

	private fun cameraPermissionStatus(): String {
		if (hasCameraPermission()) return "granted"
		if (!permissionPreferences.getBoolean(CAMERA_PERMISSION_REQUESTED, false)) return "prompt"
		return if (ActivityCompat.shouldShowRequestPermissionRationale(activity, Manifest.permission.CAMERA)) {
			"denied"
		} else {
			"blocked"
		}
	}

	private fun hasCameraPermission(): Boolean =
		ContextCompat.checkSelfPermission(activity, Manifest.permission.CAMERA) ==
			PackageManager.PERMISSION_GRANTED

	private fun deletePendingPhoto() {
		pendingPhoto?.delete()
		pendingCrop?.delete()
		pendingPhoto = null
		pendingCrop = null
	}

	private fun cacheStatsJson(stats: ShortVideoCacheStats) = JSObject().apply {
		put("byteLength", stats.byteLength)
		put("entryCount", stats.entryCount)
	}

	companion object {
		const val CAMERA_PERMISSION_ALIAS = "camera"
		private const val PERMISSION_PREFERENCES = "open-grind-media-capture"
		private const val CAMERA_PERMISSION_REQUESTED = "camera-permission-requested"
		private const val CAPTURES_DIR = "captures"
		private const val ERROR_CAMERA_PERMISSION = "camera-permission-required"
		private const val ERROR_CAPTURE_ACTIVE = "capture-already-active"
		private const val ERROR_CAMERA_UNAVAILABLE = "camera-unavailable"
		private const val ERROR_CANCELLED = "cancelled"
		private const val ERROR_PROCESSING = "media-processing-failed"
		private const val ERROR_CAPTURE_NOT_FOUND = "capture-not-found"
		private const val ERROR_CACHE = "short-video-cache-failed"
		private const val CACHE_CHANGED_EVENT = "short-video-cache-changed"
		private const val DEFAULT_CACHE_BYTES = 30L * 1_024L * 1_024L
		private const val MIN_CACHE_BYTES = 10L * 1_024L * 1_024L
		private const val MAX_CACHE_BYTES = 500L * 1_024L * 1_024L

		internal fun normalizedCacheLimit(value: Long): Long =
			value.coerceIn(MIN_CACHE_BYTES, MAX_CACHE_BYTES)
	}
}

internal object CaptureIdentifiers {
	private val valid = Regex("^[0-9a-fA-F-]{36}$")
	fun isValid(value: String?): Boolean = value != null && valid.matches(value)
}
