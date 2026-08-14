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
	private val wifiState = WifiSafetyState<Network>()

	@JvmStatic
	fun initialize(context: Context) {
		val connectivityManager = context.applicationContext
			.getSystemService(ConnectivityManager::class.java)

		val callback = object : ConnectivityManager.NetworkCallback() {
			override fun onAvailable(network: Network) {
				dispatch(synchronized(lock) { state.announced(network) })
				dispatchWifi(synchronized(lock) { wifiState.announced(network) })
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
				dispatchWifi(
					synchronized(lock) {
						wifiState.capabilities(
							network,
							capabilities.hasTransport(NetworkCapabilities.TRANSPORT_WIFI),
						)
					},
				)
			}

			override fun onLost(network: Network) {
				dispatch(synchronized(lock) { state.lost(network) })
				dispatchWifi(synchronized(lock) { wifiState.lost(network) })
			}
		}

		try {
			if (!initialization.runOnce {
				connectivityManager.activeNetwork?.let { network ->
					val capabilities = connectivityManager.getNetworkCapabilities(network)
					dispatch(
						synchronized(lock) {
							state.observed(
								network,
								capabilities.hasInternet(),
							)
						},
					)
					dispatchWifi(
						synchronized(lock) {
							if (capabilities == null) {
								wifiState.unavailable(false)
							} else {
								wifiState.observed(
									network,
									capabilities.hasTransport(NetworkCapabilities.TRANSPORT_WIFI),
								)
							}
						},
					)
				} ?: run {
					dispatch(synchronized(lock) { state.unavailable() })
					dispatchWifi(synchronized(lock) { wifiState.unavailable(true) })
				}
				connectivityManager.registerDefaultNetworkCallback(callback)
			}) return
		} catch (error: RuntimeException) {
			AppLog.warn(context, TAG, "realtime network monitor initialization failed", error)
			dispatch(synchronized(lock) { state.unavailable() })
			dispatchWifi(synchronized(lock) { wifiState.unavailable(false) })
		}
	}

	private fun dispatch(value: Boolean?) {
		if (value != null) nativeSetNetworkAvailable(value)
	}

	private fun dispatchWifi(value: WifiSafetyValue?) {
		if (value != null) nativeSetWifiState(value.known, value.connected)
	}

	private fun NetworkCapabilities?.hasInternet(): Boolean =
		this?.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) == true

	private external fun nativeSetNetworkAvailable(available: Boolean)
	private external fun nativeSetWifiState(known: Boolean, connected: Boolean)

	private const val TAG = "OpenGrindRealtime"
}
