import CryptoKit
import Foundation
import Security

struct ShortVideoCacheStats: Equatable {
  let byteLength: UInt64
  let entryCount: UInt64
}

struct ShortVideoCleanupResult: Equatable {
  let removed: Bool
  let staleWriteAbsent: Bool
}

struct ShortVideoCacheIdentity: Hashable {
  static let maximumIdentifierLength = 256

  let accountId: String
  let mediaId: String
  let accountKey: String
  let mediaKey: String

  init(accountId: String, mediaId: String) throws {
    guard Self.isValidIdentifier(accountId), Self.isValidIdentifier(mediaId) else {
      throw ShortVideoCacheError.invalidIdentifier
    }
    self.accountId = accountId
    self.mediaId = mediaId
    accountKey = Self.sha256(accountId)
    mediaKey = Self.sha256(mediaId)
  }

  var authenticatedData: Data {
    Data("\(accountId)\u{0}\(mediaId)".utf8)
  }

  func file(in root: URL) -> URL {
    root.appendingPathComponent(accountKey, isDirectory: true)
      .appendingPathComponent("\(mediaKey).ogv", isDirectory: false)
  }

  static func accountKey(for accountId: String) throws -> String {
    guard isValidIdentifier(accountId) else { throw ShortVideoCacheError.invalidIdentifier }
    return sha256(accountId)
  }

  private static func isValidIdentifier(_ value: String) -> Bool {
    !value.isEmpty && value.count <= maximumIdentifierLength
  }

  private static func sha256(_ value: String) -> String {
    SHA256.hash(data: Data(value.utf8)).map { String(format: "%02x", $0) }.joined()
  }
}

protocol ShortVideoCacheCrypto {
  func encrypt(accountKey: String, authenticatedData: Data, plaintext: Data) throws -> Data
  func decrypt(accountKey: String, authenticatedData: Data, ciphertext: Data) throws -> Data
  func deleteKey(accountKey: String) throws
}

final class AppleKeychainMediaCrypto: ShortVideoCacheCrypto {
  private let service = "doctor.andrewcox.opengrind.short-video-cache"

  func encrypt(accountKey: String, authenticatedData: Data, plaintext: Data) throws -> Data {
    let sealed = try AES.GCM.seal(
      plaintext,
      using: SymmetricKey(data: try keyData(accountKey: accountKey)),
      authenticating: authenticatedData
    )
    guard let combined = sealed.combined else { throw ShortVideoCacheError.encryptionFailed }
    return combined
  }

  func decrypt(accountKey: String, authenticatedData: Data, ciphertext: Data) throws -> Data {
    let box = try AES.GCM.SealedBox(combined: ciphertext)
    return try AES.GCM.open(
      box,
      using: SymmetricKey(data: try keyData(accountKey: accountKey)),
      authenticating: authenticatedData
    )
  }

  func deleteKey(accountKey: String) throws {
    let status = SecItemDelete(baseQuery(accountKey: accountKey) as CFDictionary)
    guard status == errSecSuccess || status == errSecItemNotFound else {
      throw ShortVideoCacheError.keychain(status)
    }
  }

  private func keyData(accountKey: String) throws -> Data {
    var query = baseQuery(accountKey: accountKey)
    query[kSecReturnData as String] = true
    query[kSecMatchLimit as String] = kSecMatchLimitOne
    var result: CFTypeRef?
    let readStatus = SecItemCopyMatching(query as CFDictionary, &result)
    if readStatus == errSecSuccess, let data = result as? Data { return data }
    guard readStatus == errSecItemNotFound else {
      throw ShortVideoCacheError.keychain(readStatus)
    }

    let key = SymmetricKey(size: .bits256).withUnsafeBytes { Data($0) }
    var add = baseQuery(accountKey: accountKey)
    add[kSecValueData as String] = key
    add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
    let addStatus = SecItemAdd(add as CFDictionary, nil)
    if addStatus == errSecDuplicateItem { return try keyData(accountKey: accountKey) }
    guard addStatus == errSecSuccess else { throw ShortVideoCacheError.keychain(addStatus) }
    return key
  }

  private func baseQuery(accountKey: String) -> [String: Any] {
    [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: accountKey,
    ]
  }
}

final class ShortVideoCache {
  private static let maximumWriteTokenLength = 128
  private let root: URL
  private let crypto: ShortVideoCacheCrypto
  private let fileManager: FileManager
  private let lock = NSLock()
  private var writeTokens: [ShortVideoCacheIdentity: String] = [:]
  private var entryGenerations: [ShortVideoCacheIdentity: UInt64] = [:]
  private var accountGenerations: [String: UInt64] = [:]
  private var globalGeneration: UInt64 = 0
  private var maximumObservedGeneration: UInt64 = 0

  init(
    root: URL,
    crypto: ShortVideoCacheCrypto = AppleKeychainMediaCrypto(),
    fileManager: FileManager = .default
  ) throws {
    self.root = root
    self.crypto = crypto
    self.fileManager = fileManager
    try fileManager.createDirectory(at: root, withIntermediateDirectories: true)
    var values = URLResourceValues()
    values.isExcludedFromBackup = true
    var mutableRoot = root
    try? mutableRoot.setResourceValues(values)
  }

  static func defaultRoot(fileManager: FileManager = .default) throws -> URL {
    guard let caches = fileManager.urls(for: .cachesDirectory, in: .userDomainMask).first else {
      throw ShortVideoCacheError.storageUnavailable
    }
    return caches.appendingPathComponent("short-video-cache", isDirectory: true)
  }

  func put(
    accountId: String,
    mediaId: String,
    plaintext: Data,
    maximumBytes: UInt64,
    writeToken: String,
    cacheGeneration: UInt64
  ) throws -> ShortVideoCacheStats {
    try locked {
      guard Self.isValidWriteToken(writeToken) else { throw ShortVideoCacheError.invalidWriteToken }
      let identity = try ShortVideoCacheIdentity(accountId: accountId, mediaId: mediaId)
      let current = max(globalGeneration, accountGenerations[identity.accountKey] ?? 0)
      guard cacheGeneration >= current else { throw ShortVideoCacheError.staleGeneration }
      accountGenerations[identity.accountKey] = cacheGeneration
      maximumObservedGeneration = max(maximumObservedGeneration, cacheGeneration)

      let destination = identity.file(in: root)
      try fileManager.createDirectory(
        at: destination.deletingLastPathComponent(),
        withIntermediateDirectories: true
      )
      let temporary = destination.deletingLastPathComponent()
        .appendingPathComponent("\(destination.lastPathComponent).\(writeToken).tmp")
      defer { try? fileManager.removeItem(at: temporary) }
      let ciphertext = try crypto.encrypt(
        accountKey: identity.accountKey,
        authenticatedData: identity.authenticatedData,
        plaintext: plaintext
      )
      try ciphertext.write(to: temporary, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
      if fileManager.fileExists(atPath: destination.path) {
        _ = try fileManager.replaceItemAt(destination, withItemAt: temporary)
      } else {
        try fileManager.moveItem(at: temporary, to: destination)
      }
      writeTokens[identity] = writeToken
      entryGenerations[identity] = cacheGeneration
      try? fileManager.setAttributes([.modificationDate: Date()], ofItemAtPath: destination.path)
      return try trimLocked(to: maximumBytes)
    }
  }

  func get(accountId: String, mediaId: String) throws -> Data? {
    try locked {
      let identity = try ShortVideoCacheIdentity(accountId: accountId, mediaId: mediaId)
      let source = identity.file(in: root)
      guard fileManager.fileExists(atPath: source.path) else { return nil }
      do {
        let plaintext = try crypto.decrypt(
          accountKey: identity.accountKey,
          authenticatedData: identity.authenticatedData,
          ciphertext: Data(contentsOf: source)
        )
        try? fileManager.setAttributes([.modificationDate: Date()], ofItemAtPath: source.path)
        return plaintext
      } catch {
        try? fileManager.removeItem(at: source)
        writeTokens.removeValue(forKey: identity)
        entryGenerations.removeValue(forKey: identity)
        return nil
      }
    }
  }

  func remove(accountId: String, mediaId: String) throws -> Bool {
    try locked {
      let identity = try ShortVideoCacheIdentity(accountId: accountId, mediaId: mediaId)
      let destination = identity.file(in: root)
      guard fileManager.fileExists(atPath: destination.path) else { return false }
      try fileManager.removeItem(at: destination)
      writeTokens.removeValue(forKey: identity)
      entryGenerations.removeValue(forKey: identity)
      return true
    }
  }

  func removeIfWriteToken(
    accountId: String,
    mediaId: String,
    expectedWriteToken: String
  ) throws -> ShortVideoCleanupResult {
    try locked {
      guard Self.isValidWriteToken(expectedWriteToken) else {
        throw ShortVideoCacheError.invalidWriteToken
      }
      let identity = try ShortVideoCacheIdentity(accountId: accountId, mediaId: mediaId)
      guard let currentWriteToken = writeTokens[identity] else {
        return ShortVideoCleanupResult(
          removed: false,
          staleWriteAbsent: !fileManager.fileExists(atPath: identity.file(in: root).path)
        )
      }
      guard currentWriteToken == expectedWriteToken else {
        return ShortVideoCleanupResult(removed: false, staleWriteAbsent: true)
      }
      let destination = identity.file(in: root)
      guard fileManager.fileExists(atPath: destination.path) else {
        writeTokens.removeValue(forKey: identity)
        entryGenerations.removeValue(forKey: identity)
        return ShortVideoCleanupResult(removed: false, staleWriteAbsent: true)
      }
      do {
        try fileManager.removeItem(at: destination)
        writeTokens.removeValue(forKey: identity)
        entryGenerations.removeValue(forKey: identity)
        return ShortVideoCleanupResult(removed: true, staleWriteAbsent: true)
      } catch {
        return ShortVideoCleanupResult(
          removed: false,
          staleWriteAbsent: !fileManager.fileExists(atPath: destination.path)
        )
      }
    }
  }

  func clear(accountId: String?, cacheGeneration: UInt64) throws -> ShortVideoCacheStats {
    try locked {
      if let accountId {
        let accountKey = try ShortVideoCacheIdentity.accountKey(for: accountId)
        let current = max(globalGeneration, accountGenerations[accountKey] ?? 0)
        guard cacheGeneration >= current else { throw ShortVideoCacheError.staleGeneration }
        accountGenerations[accountKey] = cacheGeneration
        maximumObservedGeneration = max(maximumObservedGeneration, cacheGeneration)
        try removeEntriesOlderThan(accountKey: accountKey, generation: cacheGeneration)
      } else {
        guard cacheGeneration >= maximumObservedGeneration else {
          throw ShortVideoCacheError.staleGeneration
        }
        globalGeneration = cacheGeneration
        maximumObservedGeneration = cacheGeneration
        accountGenerations.removeAll()
        for directory in try accountDirectories() {
          try removeEntriesOlderThan(accountKey: directory.lastPathComponent, generation: cacheGeneration)
        }
      }
      return try statsLocked()
    }
  }

  func trim(to maximumBytes: UInt64) throws -> ShortVideoCacheStats {
    try locked { try trimLocked(to: maximumBytes) }
  }

  func stats() throws -> ShortVideoCacheStats {
    try locked { try statsLocked() }
  }

  private func trimLocked(to maximumBytes: UInt64) throws -> ShortVideoCacheStats {
    let entries = try cacheFiles().sorted {
      let lhs = (try? $0.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate) ?? .distantPast
      let rhs = (try? $1.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate) ?? .distantPast
      return lhs == rhs ? $0.path < $1.path : lhs < rhs
    }
    var total = try entries.reduce(UInt64(0)) { partial, entry in
      partial + (try fileSize(entry))
    }
    for entry in entries where total > maximumBytes {
      let size = try fileSize(entry)
      try fileManager.removeItem(at: entry)
      total = total >= size ? total - size : 0
    }
    writeTokens = writeTokens.filter { fileManager.fileExists(atPath: $0.key.file(in: root).path) }
    entryGenerations = entryGenerations.filter { fileManager.fileExists(atPath: $0.key.file(in: root).path) }
    for directory in try accountDirectories() where (try contents(of: directory)).isEmpty {
      try? fileManager.removeItem(at: directory)
    }
    return try statsLocked()
  }

  private func statsLocked() throws -> ShortVideoCacheStats {
    let files = try cacheFiles()
    return ShortVideoCacheStats(
      byteLength: try files.reduce(UInt64(0)) { $0 + (try fileSize($1)) },
      entryCount: UInt64(files.count)
    )
  }

  private func cacheFiles() throws -> [URL] {
    try accountDirectories().flatMap { directory in
      try contents(of: directory).filter { $0.pathExtension == "ogv" }
    }
  }

  private func accountDirectories() throws -> [URL] {
    try contents(of: root).filter {
      (try? $0.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) == true
    }
  }

  private func contents(of directory: URL) throws -> [URL] {
    try fileManager.contentsOfDirectory(
      at: directory,
      includingPropertiesForKeys: [.isDirectoryKey, .fileSizeKey, .contentModificationDateKey],
      options: [.skipsHiddenFiles]
    )
  }

  private func removeEntriesOlderThan(accountKey: String, generation: UInt64) throws {
    let protected = Set(entryGenerations.compactMap { identity, entryGeneration in
      identity.accountKey == accountKey && entryGeneration >= generation ? identity.file(in: root) : nil
    })
    let directory = root.appendingPathComponent(accountKey, isDirectory: true)
    if fileManager.fileExists(atPath: directory.path) {
      for entry in try contents(of: directory) where !protected.contains(entry) {
        try fileManager.removeItem(at: entry)
      }
    }
    writeTokens = writeTokens.filter { identity, _ in
      identity.accountKey != accountKey || protected.contains(identity.file(in: root))
    }
    entryGenerations = entryGenerations.filter { identity, _ in
      identity.accountKey != accountKey || protected.contains(identity.file(in: root))
    }
    let directoryIsEmpty: Bool
    if fileManager.fileExists(atPath: directory.path) {
      directoryIsEmpty = try contents(of: directory).isEmpty
    } else {
      directoryIsEmpty = true
    }
    if directoryIsEmpty {
      try? fileManager.removeItem(at: directory)
      try crypto.deleteKey(accountKey: accountKey)
    }
  }

  private func fileSize(_ url: URL) throws -> UInt64 {
    UInt64(try url.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0)
  }

  private func locked<T>(_ operation: () throws -> T) rethrows -> T {
    lock.lock()
    defer { lock.unlock() }
    return try operation()
  }

  private static func isValidWriteToken(_ token: String) -> Bool {
    !token.isEmpty && token.count <= maximumWriteTokenLength && token.allSatisfy {
      $0.isLetter || $0.isNumber || $0 == "-" || $0 == "_"
    }
  }
}

enum ShortVideoCacheError: Error, Equatable {
  case invalidIdentifier
  case invalidWriteToken
  case staleGeneration
  case storageUnavailable
  case encryptionFailed
  case keychain(OSStatus)
}
