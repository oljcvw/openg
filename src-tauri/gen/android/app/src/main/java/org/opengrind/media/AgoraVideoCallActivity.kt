package org.opengrind.media

import android.Manifest
import android.content.pm.PackageManager
import android.graphics.Color
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.view.Gravity
import android.view.SurfaceView
import android.widget.FrameLayout
import android.widget.LinearLayout
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import com.google.android.material.button.MaterialButton
import io.agora.rtc2.Constants
import io.agora.rtc2.IRtcEngineEventHandler
import io.agora.rtc2.RtcEngine
import io.agora.rtc2.RtcEngineConfig
import io.agora.rtc2.SimulcastStreamConfig
import io.agora.rtc2.video.VideoCanvas
import io.agora.rtc2.video.VideoEncoderConfiguration
import doctor.andrewcox.opengrind.BuildConfig
import doctor.andrewcox.opengrind.R

class AgoraVideoCallActivity : AppCompatActivity() {
	private lateinit var root: FrameLayout
	private lateinit var remoteSurface: SurfaceView
	private lateinit var localSurface: SurfaceView
	private var engine: RtcEngine? = null
	private var remoteUid: Int? = null
	private var connectedAtMs = 0L
	private var ended = false
	private var microphoneMuted = false
	private var cameraMuted = false
	private val handler = Handler(Looper.getMainLooper())
	private val stopAtLimit = Runnable { finishCall("time-limit") }

	private val eventHandler = object : IRtcEngineEventHandler() {
		override fun onUserJoined(uid: Int, elapsed: Int) {
			runOnUiThread {
				if (ended) return@runOnUiThread
				remoteUid = uid
				if (connectedAtMs == 0L) {
					connectedAtMs = SystemClock.elapsedRealtime()
					val limitSeconds = intent.getIntExtra(EXTRA_CONNECTED_LIMIT_SECONDS, MAX_CONNECTED_SECONDS)
						.coerceIn(1, MAX_CONNECTED_SECONDS)
					handler.postDelayed(stopAtLimit, limitSeconds * 1_000L)
				}
				engine?.setupRemoteVideo(VideoCanvas(remoteSurface, Constants.RENDER_MODE_HIDDEN, uid))
				AgoraCallBridge.remoteUserJoined(uid)
			}
		}

		override fun onUserOffline(uid: Int, reason: Int) {
			if (uid == remoteUid) runOnUiThread { finishCall("remote-ended") }
		}

		override fun onError(err: Int) {
			runOnUiThread { finishCall("agora-error-$err") }
		}
	}

	override fun onCreate(savedInstanceState: Bundle?) {
		super.onCreate(savedInstanceState)
		if (!canStart()) {
			finishCall("agora-unavailable")
			return
		}
		buildContentView()
		onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
			override fun handleOnBackPressed() = finishCall("local-ended")
		})
		if (!AgoraCallBridge.attach(this)) {
			finishCall("local-ended")
			return
		}
		try {
			VideoCallForegroundService.start(this)
			startAgora()
		} catch (_: Exception) {
			finishCall("agora-initialization-failed")
		}
	}

	private fun canStart(): Boolean =
		BuildConfig.OPEN_GRIND_AGORA_APP_ID.isNotBlank() &&
			ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED &&
			ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED &&
			!intent.getStringExtra(EXTRA_TOKEN).isNullOrBlank() &&
			!intent.getStringExtra(EXTRA_CHANNEL).isNullOrBlank()

	private fun buildContentView() {
		remoteSurface = SurfaceView(this)
		localSurface = SurfaceView(this).apply { setZOrderMediaOverlay(true) }
		val controls = LinearLayout(this).apply {
			orientation = LinearLayout.HORIZONTAL
			gravity = Gravity.CENTER
			setPadding(dp(8), dp(8), dp(8), dp(20))
			addView(button("⇄", R.string.video_call_switch_camera) { engine?.switchCamera() })
			addView(button("Mic", R.string.video_call_toggle_microphone) { toggleMicrophone() })
			addView(button(getString(R.string.video_call_end), R.string.video_call_end) {
				finishCall("local-ended")
			})
			addView(button("Cam", R.string.video_call_toggle_camera) { toggleCamera() })
		}
		root = FrameLayout(this).apply {
			setBackgroundColor(Color.BLACK)
			addView(remoteSurface, FrameLayout.LayoutParams(-1, -1))
			addView(
				localSurface,
				FrameLayout.LayoutParams(dp(128), dp(176), Gravity.TOP or Gravity.END).apply {
					topMargin = dp(24)
					marginEnd = dp(16)
				},
			)
			addView(controls, FrameLayout.LayoutParams(-1, -2, Gravity.BOTTOM))
		}
		setContentView(root)
	}

	private fun button(label: String, description: Int, action: () -> Unit) = MaterialButton(this).apply {
		text = label
		contentDescription = getString(description)
		isAllCaps = false
		setOnClickListener { action() }
		layoutParams = LinearLayout.LayoutParams(0, -2, 1f).apply {
			marginStart = dp(3)
			marginEnd = dp(3)
		}
	}

	private fun startAgora() {
		val quality = CallQuality.parse(intent.getStringExtra(EXTRA_QUALITY))
		val nextEngine = RtcEngine.create(RtcEngineConfig().apply {
			mContext = applicationContext
			mAppId = BuildConfig.OPEN_GRIND_AGORA_APP_ID
			mEventHandler = eventHandler
			mAreaCode = -2
		})
		engine = nextEngine
		nextEngine.enableVideo()
		nextEngine.setChannelProfile(Constants.CHANNEL_PROFILE_LIVE_BROADCASTING)
		nextEngine.setClientRole(Constants.CLIENT_ROLE_BROADCASTER)
		nextEngine.setVideoEncoderConfiguration(
			VideoEncoderConfiguration(
				VideoEncoderConfiguration.VideoDimensions(quality.width, quality.height),
				VideoEncoderConfiguration.FRAME_RATE.FRAME_RATE_FPS_15,
				VideoEncoderConfiguration.STANDARD_BITRATE,
				VideoEncoderConfiguration.ORIENTATION_MODE.ORIENTATION_MODE_ADAPTIVE,
			),
		)
		if (quality == CallQuality.LOW) {
			nextEngine.setDualStreamMode(Constants.SimulcastStreamMode.DISABLE_SIMULCAST_STREAM)
		} else {
			nextEngine.setDualStreamMode(
				Constants.SimulcastStreamMode.ENABLE_SIMULCAST_STREAM,
				SimulcastStreamConfig(
					VideoEncoderConfiguration.VideoDimensions(320, 240),
					VideoEncoderConfiguration.STANDARD_BITRATE,
					15,
				),
			)
		}
		nextEngine.setupLocalVideo(VideoCanvas(localSurface, Constants.RENDER_MODE_HIDDEN, 0))
		nextEngine.startPreview()
		val result = nextEngine.joinChannel(
			requireNotNull(intent.getStringExtra(EXTRA_TOKEN)),
			requireNotNull(intent.getStringExtra(EXTRA_CHANNEL)),
			"OpenLive",
			intent.getIntExtra(EXTRA_UID, 0),
		)
		if (result < 0) finishCall("agora-join-failed-$result")
	}

	fun renewToken(token: String): Boolean {
		val activeEngine = engine ?: return false
		if (token.isBlank() || ended) return false
		return activeEngine.renewToken(token) == 0
	}

	fun requestStop(reason: String): Boolean {
		if (ended) return false
		runOnUiThread { finishCall(reason) }
		return true
	}

	private fun toggleMicrophone() {
		microphoneMuted = !microphoneMuted
		engine?.muteLocalAudioStream(microphoneMuted)
	}

	private fun toggleCamera() {
		cameraMuted = !cameraMuted
		engine?.muteLocalVideoStream(cameraMuted)
		localSurface.visibility = if (cameraMuted) SurfaceView.INVISIBLE else SurfaceView.VISIBLE
	}

	private fun finishCall(reason: String) {
		if (ended) return
		ended = true
		handler.removeCallbacks(stopAtLimit)
		val durationMs = if (connectedAtMs == 0L) 0L else {
			(SystemClock.elapsedRealtime() - connectedAtMs).coerceAtLeast(0L)
		}
		try {
			engine?.leaveChannel()
			engine?.stopPreview()
			RtcEngine.destroy()
		} catch (_: Exception) {
		} finally {
			engine = null
			VideoCallForegroundService.stop(this)
			AgoraCallBridge.cancelLaunch()
			AgoraCallBridge.detach(this)
			AgoraCallBridge.ended(reason, durationMs)
			finish()
		}
	}

	private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()

	override fun onDestroy() {
		AgoraCallBridge.detach(this)
		if (!ended) finishCall("activity-destroyed")
		super.onDestroy()
	}

	companion object {
		const val EXTRA_TOKEN = "token"
		const val EXTRA_CHANNEL = "channel"
		const val EXTRA_UID = "uid"
		const val EXTRA_QUALITY = "quality"
		const val EXTRA_CONNECTED_LIMIT_SECONDS = "connectedLimitSeconds"
		private const val MAX_CONNECTED_SECONDS = 60
	}
}
