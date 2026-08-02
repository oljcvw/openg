package org.opengrind.media

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.io.InputStream
import java.io.OutputStream
import java.nio.file.Files

class MediaPolicyTest {
	@Test
	fun `jpeg scale factor shrinks oversized payloads`() {
		assertEquals(0.95f, CapturedImageProcessor.jpegScaleFactor(1_048_576), 0.001f)
		assertTrue(CapturedImageProcessor.jpegScaleFactor(4_194_304) in 0.49f..0.51f)
	}

	@Test
	fun `capture ids reject path traversal`() {
		assertTrue(CaptureIdentifiers.isValid("758af13d-5ae9-46f5-8d1d-f7d648817a07"))
		assertFalse(CaptureIdentifiers.isValid("../capture"))
		assertFalse(CaptureIdentifiers.isValid(""))
	}

	@Test
	fun `call quality presets preserve protocol defaults`() {
		assertEquals(CallQuality.AUTO, CallQuality.parse(null))
		assertEquals(CallQuality.AUTO, CallQuality.parse("unknown"))
		assertEquals(640, CallQuality.HIGH.width)
		assertEquals(480, CallQuality.HIGH.height)
		assertEquals(320, CallQuality.LOW.width)
		assertEquals(240, CallQuality.LOW.height)
	}

	@Test
	fun `call bridge reserves only one launch`() {
		AgoraCallBridge.cancelLaunch()
		assertTrue(AgoraCallBridge.reserveLaunch())
		assertFalse(AgoraCallBridge.reserveLaunch())
		assertTrue(AgoraCallBridge.isActive())
		AgoraCallBridge.cancelLaunch()
		assertFalse(AgoraCallBridge.isActive())
	}

	@Test
	fun `cache identities isolate accounts and media`() {
		val root = File("cache")
		val first = CacheIdentity("100", "video-1").file(root)
		val secondAccount = CacheIdentity("101", "video-1").file(root)
		val secondMedia = CacheIdentity("100", "video-2").file(root)

		assertFalse(first.parentFile == secondAccount.parentFile)
		assertFalse(first.name == secondMedia.name)
		assertTrue(first.canonicalPath.startsWith(root.canonicalPath))
		assertEquals(64, CacheIdentity.accountKey("100").length)
	}

	@Test(expected = IllegalArgumentException::class)
	fun `cache identity rejects blank account`() {
		CacheIdentity("", "video-1")
	}

	@Test
	fun `cache encrypts reads and trims least recently used entries`() {
		val root = Files.createTempDirectory("open-grind-media-cache").toFile()
		try {
			val cache = ShortVideoCache(root, ReversingCrypto())
			cache.put("100", "old", byteArrayOf(1, 2, 3), 1_000)
			val oldFile = CacheIdentity("100", "old").file(root)
			oldFile.setLastModified(1_000)
			cache.put("100", "new", byteArrayOf(4, 5, 6), 1_000)
			val newFile = CacheIdentity("100", "new").file(root)
			newFile.setLastModified(2_000)

			assertTrue(newFile.readBytes().contentEquals(byteArrayOf(6, 5, 4)))
			assertTrue(cache.get("100", "new")!!.contentEquals(byteArrayOf(4, 5, 6)))
			cache.trimToBytes(newFile.length())

			assertFalse(oldFile.exists())
			assertTrue(newFile.exists())
			assertEquals(1, cache.stats().entryCount)
		} finally {
			root.deleteRecursively()
		}
	}

	private class ReversingCrypto : AccountMediaCrypto {
		override fun encrypt(accountKey: String, aad: ByteArray, input: InputStream, output: OutputStream) {
			output.write(input.readBytes().reversedArray())
		}

		override fun decrypt(accountKey: String, aad: ByteArray, input: InputStream, output: OutputStream) {
			output.write(input.readBytes().reversedArray())
		}

		override fun deleteKey(accountKey: String) = Unit
	}
}
