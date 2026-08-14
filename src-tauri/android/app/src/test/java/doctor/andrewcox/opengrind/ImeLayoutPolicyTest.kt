package doctor.andrewcox.opengrind

import org.junit.Assert.assertEquals
import org.junit.Test

class ImeLayoutPolicyTest {
	@Test
	fun `resize mode applies visible ime inset`() {
		assertEquals(
			720,
			webViewImeBottomMargin(ImeLayoutMode.RESIZE, imeVisible = true, imeBottomPixels = 720),
		)
	}

	@Test
	fun `overlay mode leaves webview full height`() {
		assertEquals(
			0,
			webViewImeBottomMargin(
				ImeLayoutMode.OVERLAY_CHAT_NAVIGATION,
				imeVisible = true,
				imeBottomPixels = 720,
			),
		)
	}

	@Test
	fun `hidden ime clears margin in every mode`() {
		ImeLayoutMode.entries.forEach { mode ->
			assertEquals(
				0,
				webViewImeBottomMargin(mode, imeVisible = false, imeBottomPixels = 720),
			)
		}
	}

	@Test
	fun `unknown bridge value falls back to resize`() {
		assertEquals(ImeLayoutMode.RESIZE, ImeLayoutMode.fromBridgeValue("unknown"))
	}

	@Test
	fun `bridge values select supported modes`() {
		assertEquals(ImeLayoutMode.RESIZE, ImeLayoutMode.fromBridgeValue("resize"))
		assertEquals(
			ImeLayoutMode.OVERLAY_CHAT_NAVIGATION,
			ImeLayoutMode.fromBridgeValue("overlay-chat-navigation"),
		)
	}
}
