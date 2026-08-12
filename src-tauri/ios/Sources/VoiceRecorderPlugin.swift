import AVFoundation
import Tauri
import UIKit

final class VoiceRecorderPlugin: Plugin, AVAudioRecorderDelegate {
  private var recorder: AVAudioRecorder?
  private var outputURL: URL?
  private var startedAt: TimeInterval = 0
  private var maximumResult: JSObject?
  private var finishingManually = false
  private var lifecycleObservers: [NSObjectProtocol] = []

  deinit { removeLifecycleObservers() }

  @objc func getPermissionStatus(_ invoke: Invoke) {
    invoke.resolve(["status": VoiceRecorderPermission.status(for: AVAudioSession.sharedInstance().recordPermission)])
  }

  @objc func requestPermission(_ invoke: Invoke) {
    let session = AVAudioSession.sharedInstance()
    if session.recordPermission != .undetermined {
      getPermissionStatus(invoke)
      return
    }
    session.requestRecordPermission { _ in
      DispatchQueue.main.async { self.getPermissionStatus(invoke) }
    }
  }

  @objc func startRecording(_ invoke: Invoke) {
    DispatchQueue.main.async {
      guard AVAudioSession.sharedInstance().recordPermission == .granted else {
        invoke.reject("Microphone permission is not granted")
        return
      }
      guard self.recorder == nil, self.maximumResult == nil else {
        invoke.reject("A voice recording is already active")
        return
      }

      let url = FileManager.default.temporaryDirectory
        .appendingPathComponent(UUID().uuidString)
        .appendingPathExtension("m4a")
      let settings: [String: Any] = [
        AVFormatIDKey: kAudioFormatMPEG4AAC,
        AVSampleRateKey: 16_000,
        AVNumberOfChannelsKey: 1,
        AVEncoderBitRateKey: 32_000,
        AVEncoderAudioQualityKey: AVAudioQuality.high.rawValue,
      ]

      do {
        let session = AVAudioSession.sharedInstance()
        try session.setCategory(.playAndRecord, mode: .voiceChat, options: [.defaultToSpeaker])
        try session.setActive(true)
        let recorder = try AVAudioRecorder(url: url, settings: settings)
        recorder.delegate = self
        guard recorder.prepareToRecord(), recorder.record(forDuration: 60) else {
          throw VoiceRecorderError.startFailed
        }
        self.recorder = recorder
        self.outputURL = url
        self.startedAt = ProcessInfo.processInfo.systemUptime
        self.observeLifecycle()
        invoke.resolve()
      } catch {
        self.remove(url)
        self.deactivateSession()
        invoke.reject("Unable to start voice recording")
      }
    }
  }

  @objc func stopRecording(_ invoke: Invoke) {
    DispatchQueue.main.async {
      if let completed = self.maximumResult {
        self.maximumResult = nil
        invoke.resolve(completed)
        return
      }
      guard self.recorder != nil else {
        invoke.reject("No voice recording is active")
        return
      }
      self.finishingManually = true
      self.recorder?.stop()
      self.finishingManually = false
      do {
        invoke.resolve(try self.finishResult())
      } catch {
        self.cancelActiveRecording()
        invoke.reject("Unable to finish voice recording")
      }
    }
  }

  @objc func cancelRecording(_ invoke: Invoke) {
    DispatchQueue.main.async {
      self.cancelActiveRecording()
      invoke.resolve()
    }
  }

  func audioRecorderDidFinishRecording(_ recorder: AVAudioRecorder, successfully flag: Bool) {
    guard !finishingManually, recorder === self.recorder else { return }
    guard flag else {
      cancelActiveRecording()
      trigger("recording-error", data: [:])
      return
    }
    do {
      let result = try finishResult()
      maximumResult = result
      trigger("max-duration", data: result)
    } catch {
      cancelActiveRecording()
      trigger("recording-error", data: [:])
    }
  }

  func audioRecorderEncodeErrorDidOccur(_ recorder: AVAudioRecorder, error: Error?) {
    guard !finishingManually, recorder === self.recorder else { return }
    cancelActiveRecording()
    trigger("recording-error", data: [:])
  }

  private func finishResult() throws -> JSObject {
    guard let url = outputURL else { throw VoiceRecorderError.missingOutput }
    let elapsed = Int((ProcessInfo.processInfo.systemUptime - startedAt) * 1_000)
    let duration = VoiceRecordingContract.clamp(durationMilliseconds: elapsed)
    clearState()
    defer {
      remove(url)
      deactivateSession()
    }
    guard VoiceRecordingContract.classify(durationMilliseconds: duration) == .ready else {
      return ["status": "tooShort"]
    }
    let data = try Data(contentsOf: url)
    guard !data.isEmpty else { throw VoiceRecorderError.missingOutput }
    return [
      "status": "ready",
      "dataBase64": data.base64EncodedString(),
      "contentType": "audio/aac",
      "durationMs": duration,
    ]
  }

  private func cancelActiveRecording() {
    finishingManually = true
    recorder?.stop()
    finishingManually = false
    if let url = outputURL { remove(url) }
    maximumResult = nil
    clearState()
    deactivateSession()
  }

  private func clearState() {
    removeLifecycleObservers()
    recorder = nil
    outputURL = nil
    startedAt = 0
  }

  private func remove(_ url: URL) {
    try? FileManager.default.removeItem(at: url)
  }

  private func deactivateSession() {
    try? AVAudioSession.sharedInstance().setActive(false, options: [.notifyOthersOnDeactivation])
  }

  private func observeLifecycle() {
    removeLifecycleObservers()
    for name in [
      UIApplication.didEnterBackgroundNotification,
      AVAudioSession.interruptionNotification,
    ] {
      lifecycleObservers.append(NotificationCenter.default.addObserver(
        forName: name,
        object: nil,
        queue: .main
      ) { [weak self] notification in
        self?.handleLifecycle(notification)
      })
    }
  }

  private func handleLifecycle(_ notification: Notification) {
    guard recorder != nil,
      let action = VoiceRecordingLifecycle.action(for: notification)
    else { return }
    cancelActiveRecording()
    if action == .fail { trigger("recording-error", data: [:]) }
  }

  private func removeLifecycleObservers() {
    for observer in lifecycleObservers {
      NotificationCenter.default.removeObserver(observer)
    }
    lifecycleObservers.removeAll()
  }
}

private enum VoiceRecorderError: Error {
  case startFailed
  case missingOutput
}

@_cdecl("init_plugin_open_grind_voice_recorder")
func initOpenGrindVoiceRecorderPlugin() -> Plugin {
  VoiceRecorderPlugin()
}
