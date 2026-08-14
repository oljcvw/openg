package doctor.andrewcox.opengrind.media

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.File
import java.security.KeyStore
import java.security.MessageDigest
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

internal data class ShortVideoCacheStats(
	val byteLength: Long,
	val entryCount: Int,
)

internal data class ShortVideoCleanupResult(
	val removed: Boolean,
	val staleWriteAbsent: Boolean,
)

internal class ShortVideoCache(
	private val root: File,
	private val crypto: AccountMediaCrypto = AndroidKeystoreMediaCrypto(),
	private val deleteFileTree: (File) -> Boolean = File::deleteRecursively,
) {
	private val writeTokens = mutableMapOf<CacheIdentity, String>()
	private val entryGenerations = mutableMapOf<CacheIdentity, Long>()
	private val accountGenerations = mutableMapOf<String, Long>()
	private var globalGeneration = 0L
	private var maximumObservedGeneration = 0L
	constructor(
		context: Context,
		crypto: AccountMediaCrypto = AndroidKeystoreMediaCrypto(),
	) : this(File(context.filesDir, CACHE_DIRECTORY), crypto)

	init {
		root.mkdirs()
	}

	@Synchronized
	fun put(
		accountId: String,
		mediaId: String,
		plaintext: ByteArray,
		maximumBytes: Long,
		writeToken: String,
		cacheGeneration: Long,
	): ShortVideoCacheStats {
		require(cacheGeneration >= 0) { "Invalid cache generation" }
		require(
			writeToken.isNotBlank() &&
				writeToken.length <= MAX_WRITE_TOKEN_LENGTH &&
				writeToken.all { it.isLetterOrDigit() || it == '-' || it == '_' },
		) {
			"Invalid cache write token"
		}
		val identity = CacheIdentity(accountId, mediaId)
		val currentGeneration = maxOf(globalGeneration, accountGenerations[identity.accountKey] ?: 0L)
		check(cacheGeneration >= currentGeneration) { "Stale cache generation" }
		accountGenerations[identity.accountKey] = cacheGeneration
		maximumObservedGeneration = maxOf(maximumObservedGeneration, cacheGeneration)
		val destination = identity.file(root)
		destination.parentFile?.mkdirs()
		val temporary = File(destination.parentFile, "${destination.name}.$writeToken.tmp")
		try {
			temporary.outputStream().use { output ->
				crypto.encrypt(identity.accountKey, identity.aad, ByteArrayInputStream(plaintext), output)
			}
			check(temporary.renameTo(destination)) { "Unable to store cached video" }
			writeTokens[identity] = writeToken
			entryGenerations[identity] = cacheGeneration
			destination.setLastModified(System.currentTimeMillis())
		} finally {
			temporary.delete()
		}
		trimToBytes(maximumBytes)
		return stats()
	}

	@Synchronized
	fun get(accountId: String, mediaId: String): ByteArray? {
		val identity = CacheIdentity(accountId, mediaId)
		val source = identity.file(root)
		if (!source.isFile) return null
		return try {
			val plaintext = ByteArrayOutputStream()
			source.inputStream().use { input ->
				crypto.decrypt(identity.accountKey, identity.aad, input, plaintext)
			}
			source.setLastModified(System.currentTimeMillis())
			plaintext.toByteArray()
		} catch (_: Exception) {
			source.delete()
			writeTokens.remove(identity)
			entryGenerations.remove(identity)
			null
		}
	}

	@Synchronized
	fun remove(accountId: String, mediaId: String): Boolean {
		val identity = CacheIdentity(accountId, mediaId)
		val removed = identity.file(root).delete()
		if (removed || !identity.file(root).exists()) {
			writeTokens.remove(identity)
			entryGenerations.remove(identity)
		}
		return removed
	}

	@Synchronized
	fun removeIfWriteToken(
		accountId: String,
		mediaId: String,
		expectedWriteToken: String,
	): ShortVideoCleanupResult {
		require(
			expectedWriteToken.isNotBlank() &&
				expectedWriteToken.length <= MAX_WRITE_TOKEN_LENGTH &&
				expectedWriteToken.all { it.isLetterOrDigit() || it == '-' || it == '_' },
		) {
			"Invalid cache write token"
		}
		val identity = CacheIdentity(accountId, mediaId)
		val currentWriteToken = writeTokens[identity]
		if (currentWriteToken == null) {
			return ShortVideoCleanupResult(
				removed = false,
				staleWriteAbsent = !identity.file(root).isFile,
			)
		}
		if (currentWriteToken != expectedWriteToken) {
			return ShortVideoCleanupResult(removed = false, staleWriteAbsent = true)
		}
		val destination = identity.file(root)
		if (!destination.exists()) {
			writeTokens.remove(identity)
			entryGenerations.remove(identity)
			return ShortVideoCleanupResult(removed = false, staleWriteAbsent = true)
		}
		val removed = destination.delete()
		if (removed) {
			writeTokens.remove(identity)
			entryGenerations.remove(identity)
		}
		return ShortVideoCleanupResult(
			removed = removed,
			staleWriteAbsent = removed || !destination.exists(),
		)
	}

	@Synchronized
	fun clearAccount(accountId: String, cacheGeneration: Long) {
		require(cacheGeneration >= 0) { "Invalid cache generation" }
		val accountKey = CacheIdentity.accountKey(accountId)
		val currentGeneration = maxOf(globalGeneration, accountGenerations[accountKey] ?: 0L)
		check(cacheGeneration >= currentGeneration) { "Stale cache generation" }
		accountGenerations[accountKey] = cacheGeneration
		maximumObservedGeneration = maxOf(maximumObservedGeneration, cacheGeneration)
		removeEntriesOlderThan(accountKey, cacheGeneration)
	}

	@Synchronized
	fun clearAll(cacheGeneration: Long) {
		require(cacheGeneration >= 0) { "Invalid cache generation" }
		check(cacheGeneration >= maximumObservedGeneration) { "Stale cache generation" }
		globalGeneration = cacheGeneration
		maximumObservedGeneration = cacheGeneration
		accountGenerations.clear()
		root.listFiles()?.filter(File::isDirectory)?.forEach { accountDirectory ->
			removeEntriesOlderThan(accountDirectory.name, cacheGeneration)
		}
	}

	@Synchronized
	fun trimToBytes(maximumBytes: Long): ShortVideoCacheStats {
		require(maximumBytes >= 0) { "Cache limit must not be negative" }
		val entries = cacheFiles().sortedWith(CacheEntryPolicy.oldestFirst)
		var total = entries.sumOf(File::length)
		for (entry in entries) {
			if (total <= maximumBytes) break
			val length = entry.length()
			if (entry.delete()) total -= length
		}
		writeTokens.keys.removeAll { !it.file(root).isFile }
		entryGenerations.keys.removeAll { !it.file(root).isFile }
		root.listFiles()?.filter { it.isDirectory && it.list()?.isEmpty() == true }?.forEach(File::delete)
		return ShortVideoCacheStats(total, cacheFiles().size)
	}

	@Synchronized
	fun stats(): ShortVideoCacheStats {
		val entries = cacheFiles()
		return ShortVideoCacheStats(entries.sumOf(File::length), entries.size)
	}

	private fun cacheFiles(): List<File> =
		root.listFiles().orEmpty().flatMap { account ->
			account.listFiles().orEmpty().filter { it.isFile && it.extension == CACHE_EXTENSION }
		}

	private fun removeEntriesOlderThan(accountKey: String, cacheGeneration: Long) {
		val protectedFiles = entryGenerations
			.filter { (identity, generation) ->
				identity.accountKey == accountKey && generation >= cacheGeneration
			}
			.keys
			.mapTo(mutableSetOf()) { it.file(root) }
		val accountDirectory = File(root, accountKey)
		accountDirectory.listFiles().orEmpty()
			.filterNot(protectedFiles::contains)
			.forEach { entry ->
				check(deleteFileTree(entry) || !entry.exists()) { "Unable to clear cached video" }
			}
		writeTokens.keys.removeAll { identity ->
			identity.accountKey == accountKey && identity.file(root) !in protectedFiles
		}
		entryGenerations.keys.removeAll { identity ->
			identity.accountKey == accountKey && identity.file(root) !in protectedFiles
		}
		if (accountDirectory.list()?.isEmpty() != false) {
			check(accountDirectory.delete() || !accountDirectory.exists()) {
				"Unable to clear cache directory"
			}
			crypto.deleteKey(accountKey)
		}
	}

	companion object {
		private const val CACHE_DIRECTORY = "short-video-cache"
		private const val CACHE_EXTENSION = "ogv"
		private const val MAX_WRITE_TOKEN_LENGTH = 128
	}
}

internal data class CacheIdentity(val accountId: String, val mediaId: String) {
	init {
		require(accountId.isNotBlank() && accountId.length <= MAX_IDENTIFIER_LENGTH) {
			"Invalid account identifier"
		}
		require(mediaId.isNotBlank() && mediaId.length <= MAX_IDENTIFIER_LENGTH) {
			"Invalid media identifier"
		}
	}

	val accountKey = accountKey(accountId)
	val mediaKey = sha256(mediaId)
	val aad: ByteArray = "$accountId\u0000$mediaId".toByteArray(Charsets.UTF_8)

	fun file(root: File): File = File(File(root, accountKey), "$mediaKey.ogv")

	companion object {
		private const val MAX_IDENTIFIER_LENGTH = 256
		fun accountKey(accountId: String): String {
			require(accountId.isNotBlank() && accountId.length <= MAX_IDENTIFIER_LENGTH) {
				"Invalid account identifier"
			}
			return sha256(accountId)
		}

		private fun sha256(value: String): String =
			MessageDigest.getInstance("SHA-256")
				.digest(value.toByteArray(Charsets.UTF_8))
				.joinToString("") { byte -> "%02x".format(byte) }
	}
}

internal object CacheEntryPolicy {
	val oldestFirst = compareBy<File>({ it.lastModified() }, { it.absolutePath })
}

internal interface AccountMediaCrypto {
	fun encrypt(accountKey: String, aad: ByteArray, input: java.io.InputStream, output: java.io.OutputStream)
	fun decrypt(accountKey: String, aad: ByteArray, input: java.io.InputStream, output: java.io.OutputStream)
	fun deleteKey(accountKey: String)
}

internal class AndroidKeystoreMediaCrypto : AccountMediaCrypto {
	override fun encrypt(
		accountKey: String,
		aad: ByteArray,
		input: java.io.InputStream,
		output: java.io.OutputStream,
	) {
		val cipher = Cipher.getInstance(TRANSFORMATION)
		cipher.init(Cipher.ENCRYPT_MODE, key(accountKey))
		cipher.updateAAD(aad)
		output.write(FORMAT_VERSION)
		output.write(cipher.iv.size)
		output.write(cipher.iv)
		output.write(cipher.doFinal(input.readBytes()))
	}

	override fun decrypt(
		accountKey: String,
		aad: ByteArray,
		input: java.io.InputStream,
		output: java.io.OutputStream,
	) {
		require(input.read() == FORMAT_VERSION) { "Unsupported cache format" }
		val ivLength = input.read()
		require(ivLength in 12..16) { "Invalid cache nonce" }
		val iv = ByteArray(ivLength)
		var offset = 0
		while (offset < ivLength) {
			val read = input.read(iv, offset, ivLength - offset)
			require(read > 0) { "Invalid cache nonce" }
			offset += read
		}
		val cipher = Cipher.getInstance(TRANSFORMATION)
		cipher.init(Cipher.DECRYPT_MODE, key(accountKey), GCMParameterSpec(GCM_TAG_BITS, iv))
		cipher.updateAAD(aad)
		output.write(cipher.doFinal(input.readBytes()))
	}

	override fun deleteKey(accountKey: String) {
		val keyStore = keyStore()
		val alias = alias(accountKey)
		if (keyStore.containsAlias(alias)) keyStore.deleteEntry(alias)
	}

	private fun key(accountKey: String): SecretKey {
		val keyStore = keyStore()
		val alias = alias(accountKey)
		(keyStore.getKey(alias, null) as? SecretKey)?.let { return it }
		return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, ANDROID_KEYSTORE).run {
			init(
				KeyGenParameterSpec.Builder(
					alias,
					KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
				)
					.setBlockModes(KeyProperties.BLOCK_MODE_GCM)
					.setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
					.setKeySize(256)
					.build(),
			)
			generateKey()
		}
	}

	private fun keyStore(): KeyStore = KeyStore.getInstance(ANDROID_KEYSTORE).apply { load(null) }
	private fun alias(accountKey: String) = "$KEY_ALIAS_PREFIX$accountKey"

	companion object {
		private const val ANDROID_KEYSTORE = "AndroidKeyStore"
		private const val TRANSFORMATION = "AES/GCM/NoPadding"
		private const val GCM_TAG_BITS = 128
		private const val FORMAT_VERSION = 1
		private const val KEY_ALIAS_PREFIX = "open-grind-short-video-"
	}
}
