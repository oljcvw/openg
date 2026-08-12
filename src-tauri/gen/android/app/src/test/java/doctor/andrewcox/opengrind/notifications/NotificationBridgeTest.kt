package doctor.andrewcox.opengrind.notifications

import app.tauri.annotation.InvokeArg
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class NotificationBridgeTest {
	@Test
	fun `parses deferred poll result`() {
		assertEquals(
			PollResult.Deferred,
			NotificationBridge.parse("""{"state":"deferred"}"""),
		)
	}

	@Test
	fun `retains only allowlisted failure code for logcat`() {
		assertEquals(
			PollResult.Failed(PollFailureCode.InboxResponse),
			NotificationBridge.parse(
				"""{"state":"retry","code":"inbox_response"}""",
			),
		)
	}

	@Test
	fun `rejects hostile native failure text`() {
		assertEquals(
			PollResult.Failed(PollFailureCode.BackgroundCheckFailed),
			NotificationBridge.parse(
				"""{"state":"retry","error":"secret user@example.com"}""",
			),
		)
	}

	@Test
	fun `keeps reflection parsed plugin arguments in minified builds`() {
		assertTrue(
			NotificationsPlugin.SettingsArgs::class.java.isAnnotationPresent(
				InvokeArg::class.java,
			),
		)
		assertTrue(
			NotificationsPlugin.AccountArgs::class.java.isAnnotationPresent(
				InvokeArg::class.java,
			),
		)
	}

	@Test
	fun `parses minimal poll result without retaining credentials`() {
		val result = NotificationBridge.parse(
			"""
			{
			  "state": "ok",
			  "accountId": "42",
			  "messages": [{
			    "conversationId": "chat-1",
			    "title": "Ada",
			    "preview": null,
			    "timestamp": 100,
			    "unreadCount": 2
			  }],
			  "taps": [{
			    "profileId": 7,
			    "displayName": null,
			    "timestamp": 101
			  }]
			}
			""".trimIndent(),
		) as PollResult.Success

		assertEquals("42", result.accountId)
		assertEquals("chat-1", result.messages.single().conversationId)
		assertEquals(7, result.taps.single().profileId)
	}
}
