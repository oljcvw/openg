package org.opengrind.media

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.media.MediaMetadataRetriever
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.view.Gravity
import android.view.View
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AppCompatActivity
import androidx.camera.core.Camera
import androidx.camera.core.CameraSelector
import androidx.camera.core.Preview
import androidx.camera.core.TorchState
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.video.FileOutputOptions
import androidx.camera.video.Quality
import androidx.camera.video.QualitySelector
import androidx.camera.video.Recorder
import androidx.camera.video.Recording
import androidx.camera.video.VideoCapture
import androidx.camera.video.VideoRecordEvent
import androidx.camera.view.PreviewView
import androidx.core.content.ContextCompat
import com.google.android.material.button.MaterialButton
import org.opengrind.R
import java.io.File
import java.util.UUID
import java.util.concurrent.TimeUnit

class ShortVideoCaptureActivity : AppCompatActivity() {
	private lateinit var previewView: PreviewView
	private lateinit var recordButton: MaterialButton
	private lateinit var switchButton: MaterialButton
	private lateinit var torchButton: MaterialButton
	private lateinit var muteButton: MaterialButton
	private lateinit var timerView: TextView
	private var cameraProvider: ProcessCameraProvider? = null
	private var camera: Camera? = null
	private var videoCapture: VideoCapture<Recorder>? = null
	private var activeRecording: Recording? = null
	private var outputFile: File? = null
	private var captureId: String? = null
	private var lensFacing = CameraSelector.LENS_FACING_FRONT
	private var isMuted = false
	private var isCancelling = false
	private var isTerminal = false
	private var recordingStartedAtMs = 0L
	private val handler = Handler(Looper.getMainLooper())
	private val stopAtLimit = Runnable { stopRecording() }
	private val updateTimer = object : Runnable {
		override fun run() {
			val elapsedMs = if (activeRecording == null) 0L else {
				SystemClock.elapsedRealtime() - recordingStartedAtMs
			}
			timerView.text = formatRemaining(elapsedMs)
			if (activeRecording != null) handler.postDelayed(this, TIMER_REFRESH_MS)
		}
	}

	override fun onCreate(savedInstanceState: Bundle?) {
		super.onCreate(savedInstanceState)
		if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) !=
			PackageManager.PERMISSION_GRANTED
		) {
			finishCancelled()
			return
		}
		buildContentView()
		onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
			override fun handleOnBackPressed() = cancelCapture()
		})
		bindCamera()
	}

	private fun buildContentView() {
		val audioAllowed = ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) ==
			PackageManager.PERMISSION_GRANTED
		isMuted = !audioAllowed
		previewView = PreviewView(this).apply {
			implementationMode = PreviewView.ImplementationMode.COMPATIBLE
			scaleType = PreviewView.ScaleType.FILL_CENTER
		}
		timerView = TextView(this).apply {
			setTextColor(Color.WHITE)
			textSize = 18f
			setPadding(dp(16), dp(8), dp(16), dp(8))
			text = formatRemaining(0)
		}
		recordButton = controlButton(getString(R.string.media_record)) { toggleRecording() }
		switchButton = controlButton("⇄") { switchCamera() }.apply {
			contentDescription = getString(R.string.media_switch_camera)
		}
		torchButton = controlButton("☀") { toggleTorch() }.apply {
			contentDescription = getString(R.string.media_toggle_torch)
		}
		muteButton = controlButton("Mic") { toggleMute() }.apply {
			contentDescription = getString(R.string.media_toggle_mute)
			isEnabled = audioAllowed
			text = if (audioAllowed) "Mic" else "Silent"
		}
		val cancelButton = controlButton("×") { cancelCapture() }.apply {
			contentDescription = getString(R.string.media_cancel)
		}

		val controls = LinearLayout(this).apply {
			orientation = LinearLayout.HORIZONTAL
			gravity = Gravity.CENTER
			setPadding(dp(8), dp(12), dp(8), dp(20))
			addView(cancelButton, weightedControlParams())
			addView(switchButton, weightedControlParams())
			addView(recordButton, weightedControlParams(1.4f))
			addView(torchButton, weightedControlParams())
			addView(muteButton, weightedControlParams())
		}
		setContentView(FrameLayout(this).apply {
			setBackgroundColor(Color.BLACK)
			addView(previewView, FrameLayout.LayoutParams(-1, -1))
			addView(timerView, FrameLayout.LayoutParams(-2, -2, Gravity.TOP or Gravity.CENTER_HORIZONTAL))
			addView(controls, FrameLayout.LayoutParams(-1, -2, Gravity.BOTTOM))
		})
	}

	private fun controlButton(label: String, action: () -> Unit) = MaterialButton(this).apply {
		text = label
		isAllCaps = false
		setOnClickListener { action() }
	}

	private fun weightedControlParams(weight: Float = 1f) =
		LinearLayout.LayoutParams(0, -2, weight).apply { marginStart = dp(3); marginEnd = dp(3) }

	private fun bindCamera() {
		val future = ProcessCameraProvider.getInstance(this)
		future.addListener({
			try {
				val provider = future.get()
				cameraProvider = provider
				if (!provider.hasCamera(selectorFor(lensFacing))) {
					lensFacing = CameraSelector.LENS_FACING_BACK
				}
				if (!provider.hasCamera(selectorFor(lensFacing))) {
					finishCancelled()
					return@addListener
				}
				bindUseCases(provider)
			} catch (_: Exception) {
				finishCancelled()
			}
		}, ContextCompat.getMainExecutor(this))
	}

	private fun bindUseCases(provider: ProcessCameraProvider) {
		val preview = Preview.Builder().build().also {
			it.surfaceProvider = previewView.surfaceProvider
		}
		val recorder = Recorder.Builder()
			.setQualitySelector(QualitySelector.from(Quality.SD))
			.build()
		val nextVideoCapture = VideoCapture.withOutput(recorder)
		provider.unbindAll()
		camera = provider.bindToLifecycle(this, selectorFor(lensFacing), preview, nextVideoCapture)
		videoCapture = nextVideoCapture
		torchButton.isEnabled = camera?.cameraInfo?.hasFlashUnit() == true
		switchButton.isEnabled = provider.hasCamera(selectorFor(oppositeLens(lensFacing)))
	}

	private fun toggleRecording() {
		if (activeRecording == null) startRecording() else stopRecording()
	}

	private fun startRecording() {
		val capture = videoCapture ?: return
		val id = UUID.randomUUID().toString()
		val directory = File(cacheDir, CAPTURES_DIR).apply(File::mkdirs)
		val file = File(directory, "video-$id.mp4")
		var pending = capture.output.prepareRecording(this, FileOutputOptions.Builder(file).build())
		val audioAllowed = ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) ==
			PackageManager.PERMISSION_GRANTED
		if (audioAllowed) pending = pending.withAudioEnabled()

		captureId = id
		outputFile = file
		activeRecording = pending.start(ContextCompat.getMainExecutor(this)) { event ->
			when (event) {
				is VideoRecordEvent.Start -> {
					recordingStartedAtMs = SystemClock.elapsedRealtime()
					activeRecording?.mute(isMuted)
					recordButton.text = getString(R.string.media_stop)
					setConfigurationControlsEnabled(false)
					handler.postDelayed(stopAtLimit, MAX_DURATION_MS)
					handler.post(updateTimer)
				}
				is VideoRecordEvent.Finalize -> finalizeRecording(event)
			}
		}
	}

	private fun stopRecording() {
		handler.removeCallbacks(stopAtLimit)
		activeRecording?.stop()
	}

	private fun finalizeRecording(event: VideoRecordEvent.Finalize) {
		if (isTerminal) return
		handler.removeCallbacks(stopAtLimit)
		handler.removeCallbacks(updateTimer)
		activeRecording = null
		recordingStartedAtMs = 0L
		recordButton.text = getString(R.string.media_record)
		setConfigurationControlsEnabled(true)
		val file = outputFile
		if (isCancelling || event.hasError() || file?.isFile != true || file.length() == 0L) {
			file?.delete()
			finishCancelled()
			return
		}
		val metadata = ShortVideoMetadata.read(file, event.recordingStats.recordedDurationNanos)
		isTerminal = true
		setResult(Activity.RESULT_OK, Intent().apply {
			putExtra(EXTRA_CAPTURE_ID, captureId)
			putExtra(EXTRA_FILE_PATH, file.absolutePath)
			putExtra(EXTRA_DURATION_MS, metadata.durationMs.coerceAtMost(MAX_DURATION_MS))
			putExtra(EXTRA_BYTE_LENGTH, file.length())
			putExtra(EXTRA_WIDTH, metadata.width)
			putExtra(EXTRA_HEIGHT, metadata.height)
			putExtra(EXTRA_HAS_AUDIO, metadata.hasAudio)
		})
		finish()
	}

	private fun switchCamera() {
		if (activeRecording != null) return
		lensFacing = oppositeLens(lensFacing)
		cameraProvider?.let(::bindUseCases)
	}

	private fun toggleTorch() {
		val next = camera?.cameraInfo?.torchState?.value != TorchState.ON
		camera?.cameraControl?.enableTorch(next)
	}

	private fun toggleMute() {
		isMuted = !isMuted
		activeRecording?.mute(isMuted)
		muteButton.text = if (isMuted) "Muted" else "Mic"
	}

	private fun setConfigurationControlsEnabled(enabled: Boolean) {
		switchButton.isEnabled = enabled &&
			(cameraProvider?.hasCamera(selectorFor(oppositeLens(lensFacing))) == true)
		torchButton.isEnabled = enabled && camera?.cameraInfo?.hasFlashUnit() == true
	}

	private fun cancelCapture() {
		isCancelling = true
		if (activeRecording != null) stopRecording() else finishCancelled()
	}

	private fun finishCancelled() {
		if (isTerminal) return
		isTerminal = true
		outputFile?.delete()
		setResult(Activity.RESULT_CANCELED)
		finish()
	}

	private fun selectorFor(lens: Int) = CameraSelector.Builder().requireLensFacing(lens).build()
	private fun oppositeLens(lens: Int) = if (lens == CameraSelector.LENS_FACING_FRONT) {
		CameraSelector.LENS_FACING_BACK
	} else {
		CameraSelector.LENS_FACING_FRONT
	}

	private fun formatRemaining(elapsedMs: Long): String {
		val remainingSeconds = ((MAX_DURATION_MS - elapsedMs).coerceAtLeast(0) + 999) / 1_000
		return "0:${remainingSeconds.toString().padStart(2, '0')}"
	}

	private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()

	override fun onDestroy() {
		handler.removeCallbacksAndMessages(null)
		if (isFinishing && activeRecording != null) {
			isCancelling = true
			isTerminal = true
			activeRecording?.stop()
			activeRecording = null
			outputFile?.delete()
		}
		super.onDestroy()
	}

	companion object {
		const val EXTRA_CAPTURE_ID = "captureId"
		const val EXTRA_FILE_PATH = "filePath"
		const val EXTRA_DURATION_MS = "durationMs"
		const val EXTRA_BYTE_LENGTH = "byteLength"
		const val EXTRA_WIDTH = "width"
		const val EXTRA_HEIGHT = "height"
		const val EXTRA_HAS_AUDIO = "hasAudio"
		const val MAX_DURATION_MS = 15_000L
		private const val TIMER_REFRESH_MS = 100L
		private const val CAPTURES_DIR = "captures"
	}
}

internal data class ShortVideoMetadata(
	val durationMs: Long,
	val width: Int,
	val height: Int,
	val hasAudio: Boolean,
) {
	companion object {
		fun read(file: File, fallbackDurationNanos: Long): ShortVideoMetadata {
			val retriever = MediaMetadataRetriever()
			return try {
				retriever.setDataSource(file.absolutePath)
				ShortVideoMetadata(
					durationMs = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)
						?.toLongOrNull() ?: TimeUnit.NANOSECONDS.toMillis(fallbackDurationNanos),
					width = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_WIDTH)
						?.toIntOrNull() ?: 0,
					height = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_HEIGHT)
						?.toIntOrNull() ?: 0,
					hasAudio = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_HAS_AUDIO) == "yes",
				)
			} finally {
				retriever.release()
			}
		}
	}
}
