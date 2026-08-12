package doctor.andrewcox.opengrind.realtime

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import androidx.annotation.Keep
import doctor.andrewcox.opengrind.logging.AppLog

@Keep
object RealtimeNetworkMonitor {
	private val lock = Any()
	private val initialization = RealtimeMonitorInitialization()
	private val state = RealtimeNetworkState<Network>()

	@JvmStatic
	fun initialize(context: Context) {
		val connectivityManager = context.applicationContext
			.getSystemService(ConnectivityManager::class.java)

		val callback = object : ConnectivityManager.NetworkCallback() {
			override fun onAvailable(network: Network) {
				dispatch(synchronized(lock) { state.announced(network) })
			}

			override fun onCapabilitiesChanged(
				network: Network,
				capabilities: NetworkCapabilities,
			) {
				dispatch(
					synchronized(lock) {
						state.capabilities(network, capabilities.hasInternet())
					},
				)
			}

			override fun onLost(network: Network) {
				dispatch(synchronized(lock) { state.lost(network) })
			}
		}

		try {
			if (!initialization.runOnce {
				connectivityManager.activeNetwork?.let { network ->
					dispatch(
						synchronized(lock) {
							state.observed(
								network,
								connectivityManager.getNetworkCapabilities(network).hasInternet(),
							)
						},
					)
				} ?: dispatch(synchronized(lock) { state.unavailable() })
				connectivityManager.registerDefaultNetworkCallback(callback)
			}) return
		} catch (error: RuntimeException) {
			AppLog.warn(context, TAG, "realtime network monitor initialization failed", error)
			dispatch(synchronized(lock) { state.unavailable() })
		}
	}

	private fun dispatch(value: Boolean?) {
		if (value != null) nativeSetNetworkAvailable(value)
	}

	private fun NetworkCapabilities?.hasInternet(): Boolean =
		this?.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) == true

	private external fun nativeSetNetworkAvailable(available: Boolean)

	private const val TAG = "OpenGrindRealtime"
}
