import AVFoundation
import Tauri
import UIKit
import UniformTypeIdentifiers

final class MediaCapturePlugin: Plugin, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
  private enum Mode {
    case photo
    case video
  }

  private var pendingInvoke: Invoke?
  private var mode: Mode?
  private lazy var shortVideoCache: ShortVideoCache? = try? ShortVideoCache(
    root: ShortVideoCache.defaultRoot()
  )

  @objc func getCameraPermissionStatus(_ invoke: Invoke) {
    invoke.resolve([
      "status": MediaCapturePermission.status(
        for: AVCaptureDevice.authorizationStatus(for: .video))
    ])
  }

  @objc func requestCameraPermission(_ invoke: Invoke) {
    if AVCaptureDevice.authorizationStatus(for: .video) != .notDetermined {
      getCameraPermissionStatus(invoke)
      return
    }
    AVCaptureDevice.requestAccess(for: .video) { _ in
      DispatchQueue.main.async { self.getCameraPermissionStatus(invoke) }
    }
  }

  @objc func capturePhoto(_ invoke: Invoke) {
    presentPicker(mode: .photo, invoke: invoke)
  }

  @objc func captureShortVideo(_ invoke: Invoke) {
    presentPicker(mode: .video, invoke: invoke)
  }

  @objc func readShortVideo(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(CaptureIdentifier.self)
    guard let url = captureURL(for: args.captureId),
          let data = try? Data(contentsOf: url), !data.isEmpty else {
      invoke.reject("Captured video was not found")
      return
    }
    invoke.resolve([
      "dataBase64": data.base64EncodedString(),
      "contentType": "video/mp4",
      "byteLength": data.count,
    ])
  }

  @objc func deleteShortVideo(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(CaptureIdentifier.self)
    if let url = captureURL(for: args.captureId) {
      try? FileManager.default.removeItem(at: url)
    }
    invoke.resolve()
  }

  @objc func cacheShortVideo(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(CachePutArguments.self)
    guard let data = Data(base64Encoded: args.dataBase64), !data.isEmpty,
          let cache = shortVideoCache else {
      invoke.reject("short-video-cache-failed")
      return
    }
    do {
      let stats = try cache.put(
        accountId: args.accountId,
        mediaId: args.mediaId,
        plaintext: data,
        maximumBytes: args.maximumBytes,
        writeToken: args.writeToken,
        cacheGeneration: args.cacheGeneration
      )
      invoke.resolve(stats.dictionary)
    } catch {
      invoke.reject("short-video-cache-failed")
    }
  }

  @objc func getCachedShortVideo(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(CacheIdentityArguments.self)
    guard let cache = shortVideoCache else {
      invoke.reject("short-video-cache-failed")
      return
    }
    do {
      guard let data = try cache.get(accountId: args.accountId, mediaId: args.mediaId) else {
        invoke.resolve(["found": false])
        return
      }
      invoke.resolve([
        "found": true,
        "dataBase64": data.base64EncodedString(),
        "contentType": "video/mp4",
        "byteLength": data.count,
      ])
    } catch {
      invoke.reject("short-video-cache-failed")
    }
  }

  @objc func removeCachedShortVideo(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(CacheIdentityArguments.self)
    guard let cache = shortVideoCache else {
      invoke.reject("short-video-cache-failed")
      return
    }
    do {
      invoke.resolve(["removed": try cache.remove(accountId: args.accountId, mediaId: args.mediaId)])
    } catch {
      invoke.reject("short-video-cache-failed")
    }
  }

  @objc func removeCachedShortVideoIfToken(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(CacheTokenArguments.self)
    guard let cache = shortVideoCache else {
      invoke.reject("short-video-cache-failed")
      return
    }
    do {
      let result = try cache.removeIfWriteToken(
        accountId: args.accountId,
        mediaId: args.mediaId,
        expectedWriteToken: args.writeToken
      )
      invoke.resolve([
        "removed": result.removed,
        "staleWriteAbsent": result.staleWriteAbsent,
      ])
    } catch {
      invoke.reject("short-video-cache-failed")
    }
  }

  @objc func clearShortVideoCache(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(CacheClearArguments.self)
    guard let cache = shortVideoCache else {
      invoke.reject("short-video-cache-failed")
      return
    }
    do {
      invoke.resolve(try cache.clear(accountId: args.accountId, cacheGeneration: args.cacheGeneration).dictionary)
    } catch {
      invoke.reject("short-video-cache-failed")
    }
  }

  @objc func trimShortVideoCache(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(CacheLimitArguments.self)
    guard let cache = shortVideoCache else {
      invoke.reject("short-video-cache-failed")
      return
    }
    do {
      invoke.resolve(try cache.trim(to: args.maximumBytes).dictionary)
    } catch {
      invoke.reject("short-video-cache-failed")
    }
  }

  @objc func getShortVideoCacheStats(_ invoke: Invoke) {
    guard let cache = shortVideoCache else {
      invoke.reject("short-video-cache-failed")
      return
    }
    do {
      invoke.resolve(try cache.stats().dictionary)
    } catch {
      invoke.reject("short-video-cache-failed")
    }
  }

  private func presentPicker(mode: Mode, invoke: Invoke) {
    DispatchQueue.main.async {
      guard AVCaptureDevice.authorizationStatus(for: .video) == .authorized else {
        invoke.reject("Camera permission is required")
        return
      }
      guard UIImagePickerController.isSourceTypeAvailable(.camera) else {
        invoke.reject("Camera is unavailable")
        return
      }
      let presenter = self.manager.viewController
      if let error = MediaCaptureContract.presentationError(
        presenterAttached: presenter?.viewIfLoaded?.window != nil,
        presenterHasModal: presenter?.presentedViewController != nil,
        captureActive: self.pendingInvoke != nil
      ) {
        invoke.reject(error)
        return
      }
      guard let presenter else {
        invoke.reject("Capture presentation is unavailable")
        return
      }

      let picker = UIImagePickerController()
      picker.sourceType = .camera
      picker.delegate = self
      picker.modalPresentationStyle = .fullScreen
      switch mode {
      case .photo:
        picker.mediaTypes = [UTType.image.identifier]
        picker.cameraCaptureMode = .photo
        picker.allowsEditing = true
      case .video:
        picker.mediaTypes = [UTType.movie.identifier]
        picker.cameraCaptureMode = .video
        picker.videoMaximumDuration = 15
        picker.videoQuality = .typeMedium
      }
      self.pendingInvoke = invoke
      self.mode = mode
      presenter.present(picker, animated: true)
    }
  }

  func imagePickerControllerDidCancel(_ picker: UIImagePickerController) {
    picker.dismiss(animated: true)
    finishPending { $0.reject("cancelled") }
  }

  func imagePickerController(
    _ picker: UIImagePickerController,
    didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]
  ) {
    picker.dismiss(animated: true)
    switch mode {
    case .photo:
      finishPhoto(info)
    case .video:
      finishVideo(info)
    case nil:
      finishPending { $0.reject("Capture state was lost") }
    }
  }

  private func finishPhoto(_ info: [UIImagePickerController.InfoKey: Any]) {
    guard let image = (info[.editedImage] ?? info[.originalImage]) as? UIImage else {
      finishPending { $0.reject("Captured photo could not be processed") }
      return
    }
    do {
      let photo = try MediaCapturePhotoProcessor.process(image)
      finishPending {
        $0.resolve([
          "status": "ready",
          "dataBase64": photo.data.base64EncodedString(),
          "contentType": "image/jpeg",
          "byteLength": photo.data.count,
          "width": photo.width,
          "height": photo.height,
        ])
      }
    } catch {
      finishPending { $0.reject("Captured photo could not be processed") }
    }
  }

  private func finishVideo(_ info: [UIImagePickerController.InfoKey: Any]) {
    guard let source = info[.mediaURL] as? URL else {
      finishPending { $0.reject("Captured video could not be processed") }
      return
    }
    do {
      let id = UUID().uuidString
      let destination = try capturesDirectory().appendingPathComponent("video-\(id).mp4")
      Task { @MainActor in
        do {
          try await exportMP4(from: source, to: destination)
          let asset = AVURLAsset(url: destination)
          let durationTime = try await asset.load(.duration)
          let duration = MediaCaptureContract.clampedVideoDuration(
            milliseconds: Int(CMTimeGetSeconds(durationTime) * 1_000)
          )
          let videoTrack = try await asset.loadTracks(withMediaType: .video).first
          let naturalSize = try await videoTrack?.load(.naturalSize) ?? .zero
          let transform = try await videoTrack?.load(.preferredTransform) ?? .identity
          let transformed = naturalSize.applying(transform)
          let width = Int(abs(transformed.width).rounded())
          let height = Int(abs(transformed.height).rounded())
          let byteLength = (try destination.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
          let hasAudio = !(try await asset.loadTracks(withMediaType: .audio)).isEmpty
          finishPending {
            $0.resolve([
              "captureId": id,
              "contentType": "video/mp4",
              "durationMs": duration,
              "byteLength": byteLength,
              "width": width,
              "height": height,
              "hasAudio": hasAudio,
            ])
          }
        } catch {
          try? FileManager.default.removeItem(at: destination)
          finishPending { $0.reject("Captured video could not be processed") }
        }
      }
    } catch {
      finishPending { $0.reject("Captured video could not be processed") }
    }
  }

  private func exportMP4(from source: URL, to destination: URL) async throws {
    let asset = AVURLAsset(url: source)
    guard let exporter = AVAssetExportSession(
      asset: asset,
      presetName: AVAssetExportPresetMediumQuality
    ) else {
      throw MediaCaptureProcessingError.exportUnavailable
    }
    exporter.outputURL = destination
    exporter.outputFileType = .mp4
    exporter.shouldOptimizeForNetworkUse = true
    try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
      exporter.exportAsynchronously {
        switch exporter.status {
        case .completed:
          continuation.resume()
        case .failed, .cancelled:
          continuation.resume(throwing: exporter.error ?? MediaCaptureProcessingError.exportFailed)
        default:
          continuation.resume(throwing: MediaCaptureProcessingError.exportFailed)
        }
      }
    }
  }

  private func finishPending(_ finish: (Invoke) -> Void) {
    guard let invoke = pendingInvoke else { return }
    pendingInvoke = nil
    mode = nil
    finish(invoke)
  }

  private func capturesDirectory() throws -> URL {
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent("open-grind-captures")
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    return directory
  }

  private func captureURL(for id: String) -> URL? {
    guard id.range(of: "^[A-Fa-f0-9-]{36}$", options: .regularExpression) != nil,
          let directory = try? capturesDirectory() else { return nil }
    return directory.appendingPathComponent("video-\(id).mp4")
  }
}

private struct CaptureIdentifier: Decodable {
  let captureId: String
}

private struct CachePutArguments: Decodable {
  let accountId: String
  let mediaId: String
  let dataBase64: String
  let maximumBytes: UInt64
  let writeToken: String
  let cacheGeneration: UInt64
}

private struct CacheIdentityArguments: Decodable {
  let accountId: String
  let mediaId: String
}

private struct CacheTokenArguments: Decodable {
  let accountId: String
  let mediaId: String
  let writeToken: String
}

private struct CacheClearArguments: Decodable {
  let accountId: String?
  let cacheGeneration: UInt64
}

private struct CacheLimitArguments: Decodable {
  let maximumBytes: UInt64
}

private extension ShortVideoCacheStats {
  var dictionary: [String: Any] {
    ["byteLength": byteLength, "entryCount": entryCount]
  }
}

private struct ProcessedPhoto {
  let data: Data
  let width: Int
  let height: Int
}

private enum MediaCapturePhotoProcessor {
  static func process(_ source: UIImage) throws -> ProcessedPhoto {
    var image = normalizedAndScaled(source)
    for _ in 0...4 {
      guard let data = image.jpegData(compressionQuality: 1) else {
        throw MediaCaptureProcessingError.encoding
      }
      if data.count <= MediaCaptureContract.maximumPhotoBytes {
        return ProcessedPhoto(
          data: data,
          width: Int(image.size.width.rounded()),
          height: Int(image.size.height.rounded())
        )
      }
      let scale = min(0.95, max(0.1, sqrt(
        Double(MediaCaptureContract.maximumPhotoBytes) / Double(data.count)
      )))
      image = render(image, size: CGSize(
        width: max(1, (image.size.width * scale).rounded()),
        height: max(1, (image.size.height * scale).rounded())
      ))
    }
    throw MediaCaptureProcessingError.tooLarge
  }

  private static func normalizedAndScaled(_ source: UIImage) -> UIImage {
    let dimensions = MediaCaptureContract.scaledSize(
      width: Int(source.size.width.rounded()),
      height: Int(source.size.height.rounded())
    )
    return render(source, size: CGSize(width: dimensions.width, height: dimensions.height))
  }

  private static func render(_ image: UIImage, size: CGSize) -> UIImage {
    let format = UIGraphicsImageRendererFormat()
    format.scale = 1
    format.opaque = true
    return UIGraphicsImageRenderer(size: size, format: format).image { _ in
      image.draw(in: CGRect(origin: .zero, size: size))
      let font = UIFont.boldSystemFont(ofSize: max(12, size.width * 0.035))
      let label = "Open Grind"
      let attributes: [NSAttributedString.Key: Any] = [
        .font: font,
        .foregroundColor: UIColor.white.withAlphaComponent(0.82),
        .strokeColor: UIColor.black.withAlphaComponent(0.55),
        .strokeWidth: -2,
      ]
      let labelSize = label.size(withAttributes: attributes)
      label.draw(
        at: CGPoint(x: size.width - labelSize.width - max(8, size.width * 0.025),
                    y: size.height - labelSize.height - max(8, size.width * 0.025)),
        withAttributes: attributes
      )
    }
  }
}

private enum MediaCaptureProcessingError: Error {
  case encoding
  case exportFailed
  case exportUnavailable
  case tooLarge
}

@_cdecl("init_plugin_open_grind_media_capture")
func initOpenGrindMediaCapturePlugin() -> Plugin {
  MediaCapturePlugin()
}
