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
			cache.put("100", "old", byteArrayOf(1, 2, 3), 1_000, "write-old", 0)
			val oldFile = CacheIdentity("100", "old").file(root)
			oldFile.setLastModified(1_000)
			cache.put("100", "new", byteArrayOf(4, 5, 6), 1_000, "write-new", 0)
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

	@Test
	fun `stale cleanup cannot delete replacement written after clear`() {
		val root = Files.createTempDirectory("open-grind-media-cache-race").toFile()
		try {
			val cache = ShortVideoCache(root, ReversingCrypto())
			cache.put("100", "same", byteArrayOf(1), 1_000, "old-write", 0)
			cache.clearAccount("100", 1)
			cache.put("100", "same", byteArrayOf(2), 1_000, "new-write", 1)

			val cleanup = cache.removeIfWriteToken("100", "same", "old-write")
			assertFalse(cleanup.removed)
			assertTrue(cleanup.staleWriteAbsent)
			assertTrue(cache.get("100", "same")!!.contentEquals(byteArrayOf(2)))
		} finally {
			root.deleteRecursively()
		}
	}

	@Test
	fun `delayed stale put cannot overwrite a newer generation`() {
		val root = Files.createTempDirectory("open-grind-media-cache-delayed-put").toFile()
		try {
			val cache = ShortVideoCache(root, ReversingCrypto())
			cache.clearAccount("100", 1)
			cache.put("100", "same", byteArrayOf(2), 1_000, "new-write", 1)

			val rejected = runCatching {
				cache.put("100", "same", byteArrayOf(1), 1_000, "delayed-old-write", 0)
			}
			assertTrue(rejected.isFailure)
			assertTrue(cache.get("100", "same")!!.contentEquals(byteArrayOf(2)))
		} finally {
			root.deleteRecursively()
		}
	}

	@Test
	fun `delayed clear cannot erase a write from a newer generation`() {
		val root = Files.createTempDirectory("open-grind-media-cache-delayed-clear").toFile()
		try {
			val cache = ShortVideoCache(root, ReversingCrypto())
			cache.put("100", "same", byteArrayOf(2), 1_000, "new-write", 2)

			val rejected = runCatching { cache.clearAccount("100", 1) }
			assertTrue(rejected.isFailure)
			assertTrue(cache.get("100", "same")!!.contentEquals(byteArrayOf(2)))
		} finally {
			root.deleteRecursively()
		}
	}

	@Test
	fun `delayed clear preserves a post-clear write from the same generation`() {
		val root = Files.createTempDirectory("open-grind-media-cache-equal-clear").toFile()
		try {
			val cache = ShortVideoCache(root, ReversingCrypto())
			cache.put("100", "old", byteArrayOf(1), 1_000, "old-write", 0)
			cache.put("100", "new", byteArrayOf(2), 1_000, "new-write", 1)

			cache.clearAccount("100", 1)

			assertEquals(null, cache.get("100", "old"))
			assertTrue(cache.get("100", "new")!!.contentEquals(byteArrayOf(2)))
		} finally {
			root.deleteRecursively()
		}
	}

	@Test
	fun `clear rejects when an old cache entry remains`() {
		val root = Files.createTempDirectory("open-grind-media-cache-clear-failure").toFile()
		try {
			val cache = ShortVideoCache(root, ReversingCrypto()) { false }
			cache.put("100", "old", byteArrayOf(1), 1_000, "old-write", 0)
			val oldFile = CacheIdentity("100", "old").file(root)

			val rejected = runCatching { cache.clearAccount("100", 1) }

			assertTrue(rejected.isFailure)
			assertTrue(oldFile.exists())
		} finally {
			root.deleteRecursively()
		}
	}

	@Test
	fun `stale cleanup reports an undeletable owned destination`() {
		val root = Files.createTempDirectory("open-grind-media-cache-delete-failure").toFile()
		try {
			val cache = ShortVideoCache(root, ReversingCrypto())
			cache.put("100", "same", byteArrayOf(1), 1_000, "owned-write", 0)
			val destination = CacheIdentity("100", "same").file(root)
			assertTrue(destination.delete())
			assertTrue(destination.mkdirs())
			File(destination, "prevents-delete").writeText("occupied")

			val cleanup = cache.removeIfWriteToken("100", "same", "owned-write")
			assertFalse(cleanup.removed)
			assertFalse(cleanup.staleWriteAbsent)
		} finally {
			root.deleteRecursively()
		}
	}

	@Test(expected = IllegalArgumentException::class)
	fun `cache write tokens reject path separators`() {
		val root = Files.createTempDirectory("open-grind-media-cache-token").toFile()
		try {
			ShortVideoCache(root, ReversingCrypto()).put(
				"100",
				"same",
				byteArrayOf(1),
				1_000,
				"../unsafe",
				0,
			)
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
