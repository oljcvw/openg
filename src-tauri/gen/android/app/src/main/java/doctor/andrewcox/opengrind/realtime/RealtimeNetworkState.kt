package doctor.andrewcox.opengrind.realtime

internal class RealtimeNetworkState<T> {
	private var currentNetwork: T? = null
	private var available: Boolean? = null

	fun observed(network: T, hasInternet: Boolean): Boolean? {
		currentNetwork = network
		return setAvailable(hasInternet)
	}

	fun announced(network: T): Boolean? {
		currentNetwork = network
		return setAvailable(false)
	}

	fun capabilities(network: T, hasInternet: Boolean): Boolean? {
		if (currentNetwork != network) return null
		return setAvailable(hasInternet)
	}

	fun lost(network: T): Boolean? {
		if (currentNetwork != network) return null
		currentNetwork = null
		return setAvailable(false)
	}

	fun unavailable(): Boolean? {
		currentNetwork = null
		return setAvailable(false)
	}

	private fun setAvailable(value: Boolean): Boolean? {
		if (available == value) return null
		available = value
		return value
	}
}
