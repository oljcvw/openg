import AVFoundation
import XCTest

final class MediaCapturePluginTests: XCTestCase {
  func testCameraPermissionMapsNativeStatesToSharedContract() {
    XCTAssertEqual(MediaCapturePermission.status(for: .notDetermined), "prompt")
    XCTAssertEqual(MediaCapturePermission.status(for: .denied), "blocked")
    XCTAssertEqual(MediaCapturePermission.status(for: .restricted), "blocked")
    XCTAssertEqual(MediaCapturePermission.status(for: .authorized), "granted")
  }

  func testPhotoDimensionsScaleDownWithoutChangingAspectRatio() {
    XCTAssertEqual(MediaCaptureContract.scaledSize(width: 4_032, height: 3_024),
                   MediaCaptureSize(width: 1_024, height: 768))
    XCTAssertEqual(MediaCaptureContract.scaledSize(width: 600, height: 800),
                   MediaCaptureSize(width: 600, height: 800))
  }

  func testShortVideoDurationClampsToFifteenSeconds() {
    XCTAssertEqual(MediaCaptureContract.clampedVideoDuration(milliseconds: 15_001), 15_000)
  }

  func testCaptureIsReservedOnlyWhenPresentationCanComplete() {
    XCTAssertEqual(
      MediaCaptureContract.presentationError(
        presenterAttached: false, presenterHasModal: false, captureActive: false
      ),
      "Capture presentation is unavailable"
    )
    XCTAssertEqual(
      MediaCaptureContract.presentationError(
        presenterAttached: true, presenterHasModal: true, captureActive: false
      ),
      "Capture presentation is unavailable"
    )
    XCTAssertEqual(
      MediaCaptureContract.presentationError(
        presenterAttached: true, presenterHasModal: false, captureActive: true
      ),
      "A media capture is already active"
    )
    XCTAssertNil(MediaCaptureContract.presentationError(
      presenterAttached: true, presenterHasModal: false, captureActive: false
    ))
  }

  func testCacheIdentitiesIsolateAccountsAndMedia() throws {
    let root = URL(fileURLWithPath: "/cache", isDirectory: true)
    let first = try ShortVideoCacheIdentity(accountId: "100", mediaId: "video-1").file(in: root)
    let secondAccount = try ShortVideoCacheIdentity(accountId: "101", mediaId: "video-1").file(in: root)
    let secondMedia = try ShortVideoCacheIdentity(accountId: "100", mediaId: "video-2").file(in: root)
    XCTAssertNotEqual(first.deletingLastPathComponent(), secondAccount.deletingLastPathComponent())
    XCTAssertNotEqual(first.lastPathComponent, secondMedia.lastPathComponent)
    XCTAssertTrue(first.path.hasPrefix(root.path))
    XCTAssertEqual(try ShortVideoCacheIdentity.accountKey(for: "100").count, 64)
  }

  func testCacheEncryptsReadsAndTrimsOldestEntry() throws {
    let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: root) }
    let cache = try ShortVideoCache(root: root, crypto: ReversingCacheCrypto())
    _ = try cache.put(accountId: "100", mediaId: "old", plaintext: Data([1, 2, 3]),
                      maximumBytes: 1_000, writeToken: "write-old", cacheGeneration: 0)
    let old = try ShortVideoCacheIdentity(accountId: "100", mediaId: "old").file(in: root)
    try FileManager.default.setAttributes([.modificationDate: Date(timeIntervalSince1970: 1)],
                                          ofItemAtPath: old.path)
    _ = try cache.put(accountId: "100", mediaId: "new", plaintext: Data([4, 5, 6]),
                      maximumBytes: 1_000, writeToken: "write-new", cacheGeneration: 0)
    let newest = try ShortVideoCacheIdentity(accountId: "100", mediaId: "new").file(in: root)
    try FileManager.default.setAttributes([.modificationDate: Date(timeIntervalSince1970: 2)],
                                          ofItemAtPath: newest.path)
    XCTAssertEqual(try Data(contentsOf: newest), Data([6, 5, 4]))
    XCTAssertEqual(try cache.get(accountId: "100", mediaId: "new"), Data([4, 5, 6]))
    _ = try cache.trim(to: UInt64(try Data(contentsOf: newest).count))
    XCTAssertFalse(FileManager.default.fileExists(atPath: old.path))
    XCTAssertTrue(FileManager.default.fileExists(atPath: newest.path))
    XCTAssertEqual(try cache.stats().entryCount, 1)
  }

  func testCacheGenerationFencePreservesPostClearReplacement() throws {
    let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: root) }
    let cache = try ShortVideoCache(root: root, crypto: ReversingCacheCrypto())
    _ = try cache.put(accountId: "100", mediaId: "same", plaintext: Data([1]),
                      maximumBytes: 1_000, writeToken: "old-write", cacheGeneration: 0)
    _ = try cache.clear(accountId: "100", cacheGeneration: 1)
    _ = try cache.put(accountId: "100", mediaId: "same", plaintext: Data([2]),
                      maximumBytes: 1_000, writeToken: "new-write", cacheGeneration: 1)
    let cleanup = try cache.removeIfWriteToken(
      accountId: "100", mediaId: "same", expectedWriteToken: "old-write"
    )
    XCTAssertEqual(cleanup, ShortVideoCleanupResult(removed: false, staleWriteAbsent: true))
    XCTAssertEqual(try cache.get(accountId: "100", mediaId: "same"), Data([2]))
    XCTAssertThrowsError(
      try cache.put(accountId: "100", mediaId: "same", plaintext: Data([1]),
                    maximumBytes: 1_000, writeToken: "late-write", cacheGeneration: 0)
    )
  }

  func testConditionalCleanupDoesNotCertifyPersistedEntryAfterRestart() throws {
    let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: root) }
    let original = try ShortVideoCache(root: root, crypto: ReversingCacheCrypto())
    _ = try original.put(accountId: "100", mediaId: "same", plaintext: Data([1]),
                         maximumBytes: 1_000, writeToken: "owned-write", cacheGeneration: 0)

    let restarted = try ShortVideoCache(root: root, crypto: ReversingCacheCrypto())
    let cleanup = try restarted.removeIfWriteToken(
      accountId: "100", mediaId: "same", expectedWriteToken: "owned-write"
    )

    XCTAssertEqual(cleanup, ShortVideoCleanupResult(removed: false, staleWriteAbsent: false))
    XCTAssertEqual(try restarted.get(accountId: "100", mediaId: "same"), Data([1]))
  }
}

private final class ReversingCacheCrypto: ShortVideoCacheCrypto {
  func encrypt(accountKey: String, authenticatedData: Data, plaintext: Data) throws -> Data {
    Data(plaintext.reversed())
  }

  func decrypt(accountKey: String, authenticatedData: Data, ciphertext: Data) throws -> Data {
    Data(ciphertext.reversed())
  }

  func deleteKey(accountKey: String) throws {}
}
