package org.opengrind.notifications

object NotificationRoute {
	fun sanitize(route: String?): String? = when {
		route == "/chat" -> route
		route == "/interest/taps" -> route
		route == "/settings/app/notifications" -> route
		route?.matches(CHAT_ROUTE) == true -> route
		else -> null
	}

	private val CHAT_ROUTE = Regex("^/chat/[A-Za-z0-9:_-]{1,200}$")
}
