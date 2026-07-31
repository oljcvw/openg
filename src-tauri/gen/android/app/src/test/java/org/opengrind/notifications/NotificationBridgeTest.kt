package org.opengrind.notifications

import org.junit.Assert.assertEquals
import org.junit.Test

class NotificationBridgeTest {
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
