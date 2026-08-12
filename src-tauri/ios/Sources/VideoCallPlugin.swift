import AgoraRtcKit
import AVFoundation
import Foundation
import Tauri
import UIKit

private struct VideoCallStartArgs: Decodable {
  let channel: String
  let token: String
  let uid: UInt
  let quality: String
  let direction: String
  let connectedLimitSeconds: Int
}

private struct VideoCallRenewArgs: Decodable {
  let token: String
}

final class VideoCallPlugin: Plugin {
  private weak var callController: AgoraVideoCallViewController?
  private var launchReserved = false

  @objc func availability(_ invoke: Invoke) {
    let configured = AgoraConfiguration.appId != nil
    let camera = permissionStatus(for: .video)
    let microphone = permissionStatus(for: .audio)
    let permissionsGranted = camera == "granted" && microphone == "granted"
    invoke.resolve([
      "available": configured,
      "buildConfigured": configured,
      "permissionsGranted": permissionsGranted,
      "cameraPermission": camera,
      "microphonePermission": microphone,
      "reason": configured
        ? (permissionsGranted ? "available" : "permissions-required")
        : "app-id-not-configured",
      "sdkVersion": AgoraRtcEngineKit.getSdkVersion(),
    ])
  }

  @objc func start(_ invoke: Invoke) throws {
    guard let appId = AgoraConfiguration.appId else {
      invoke.reject("agora-unavailable")
      return
    }
    let args = try invoke.parseArgs(VideoCallStartArgs.self)
    guard !args.channel.isEmpty, !args.token.isEmpty,
      (args.direction == "incoming" || args.direction == "outgoing")
    else {
      invoke.reject("invalid-video-call-arguments")
      return
    }
    DispatchQueue.main.async { [weak self] in
      guard let self else { return }
      guard !self.launchReserved, self.callController == nil else {
        invoke.reject("video-call-already-active")
        return
      }
      self.launchReserved = true
      self.requestMediaPermissions { granted in
        DispatchQueue.main.async {
          self.finishStart(granted: granted, appId: appId, args: args, invoke: invoke)
        }
      }
    }
  }

  private func finishStart(
    granted: Bool,
    appId: String,
    args: VideoCallStartArgs,
    invoke: Invoke
  ) {
    guard granted else {
      launchReserved = false
      invoke.reject("video-call-media-permissions-required")
      return
    }
    presentCall(appId: appId, args: args, invoke: invoke)
  }

  private func presentCall(appId: String, args: VideoCallStartArgs, invoke: Invoke) {
    guard let presenter = Self.presentingViewController() else {
      launchReserved = false
      invoke.reject("video-call-presentation-unavailable")
      return
    }
    let controller = AgoraVideoCallViewController(
      appId: appId,
      channel: args.channel,
      token: args.token,
      uid: args.uid,
      quality: VideoCallQuality.parse(args.quality),
      connectedLimitSeconds: min(60, max(1, args.connectedLimitSeconds))
    )
    controller.onRemoteUserJoined = { [weak self] uid in
      self?.trigger("remote-user-joined", data: ["uid": Int(uid)])
    }
    controller.onEnded = { [weak self] reason, durationMs in
      guard let self else { return }
      self.callController = nil
      self.launchReserved = false
      self.trigger("ended", data: ["reason": reason, "durationMs": Int(durationMs)])
    }
    callController = controller
    presenter.present(controller, animated: true) { invoke.resolve() }
  }

  @objc func renewToken(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(VideoCallRenewArgs.self)
    DispatchQueue.main.async { [weak self] in
      guard !args.token.isEmpty, self?.callController?.renewToken(args.token) == true else {
        invoke.reject("video-call-not-active")
        return
      }
      invoke.resolve()
    }
  }

  @objc func stop(_ invoke: Invoke) {
    DispatchQueue.main.async { [weak self] in
      guard let self, let callController = self.callController else {
        self?.launchReserved = false
        invoke.reject("video-call-not-active")
        return
      }
      callController.requestStop(reason: "local-ended")
      invoke.resolve()
    }
  }

  private func permissionStatus(for mediaType: AVMediaType) -> String {
    switch AVCaptureDevice.authorizationStatus(for: mediaType) {
    case .notDetermined: "prompt"
    case .authorized: "granted"
    case .denied: "denied"
    case .restricted: "blocked"
    @unknown default: "blocked"
    }
  }

  private func requestMediaPermissions(completion: @escaping (Bool) -> Void) {
    AVCaptureDevice.requestAccess(for: .video) { cameraGranted in
      guard cameraGranted else {
        completion(false)
        return
      }
      AVCaptureDevice.requestAccess(for: .audio) { microphoneGranted in
        completion(microphoneGranted)
      }
    }
  }

  private static func presentingViewController() -> UIViewController? {
    let scene = UIApplication.shared.connectedScenes
      .compactMap { $0 as? UIWindowScene }
      .first { $0.activationState == .foregroundActive }
    var controller = scene?.windows.first(where: \.isKeyWindow)?.rootViewController
    while let presented = controller?.presentedViewController { controller = presented }
    return controller
  }
}

private final class AgoraVideoCallViewController: UIViewController, AgoraRtcEngineDelegate {
  var onRemoteUserJoined: ((UInt) -> Void)?
  var onEnded: ((String, UInt64) -> Void)?

  private let appId: String
  private let channel: String
  private let token: String
  private let uid: UInt
  private let quality: VideoCallQuality
  private let connectedLimitSeconds: Int
  private var engine: AgoraRtcEngineKit?
  private var remoteUid: UInt?
  private var connectedAt: DispatchTime?
  private var limitWorkItem: DispatchWorkItem?
  private var ended = false
  private var microphoneMuted = false
  private var cameraMuted = false
  private var lifecycleObservers: [NSObjectProtocol] = []
  private let remoteView = UIView()
  private let localView = UIView()

  init(
    appId: String,
    channel: String,
    token: String,
    uid: UInt,
    quality: VideoCallQuality,
    connectedLimitSeconds: Int
  ) {
    self.appId = appId
    self.channel = channel
    self.token = token
    self.uid = uid
    self.quality = quality
    self.connectedLimitSeconds = connectedLimitSeconds
    super.init(nibName: nil, bundle: nil)
    modalPresentationStyle = .fullScreen
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) { fatalError("init(coder:) unavailable") }

  override func viewDidLoad() {
    super.viewDidLoad()
    buildInterface()
    observeLifecycle()
    startAgora()
  }

  deinit { removeLifecycleObservers() }

  private func buildInterface() {
    view.backgroundColor = .black
    remoteView.translatesAutoresizingMaskIntoConstraints = false
    localView.translatesAutoresizingMaskIntoConstraints = false
    localView.backgroundColor = .darkGray
    view.addSubview(remoteView)
    view.addSubview(localView)

    let switchCamera = control(title: "Switch", accessibility: "Switch camera") { [weak self] in
      self?.engine?.switchCamera()
    }
    let microphone = control(title: "Mic", accessibility: "Toggle microphone") { [weak self] in
      self?.toggleMicrophone()
    }
    let end = control(title: "End", accessibility: "End video call") { [weak self] in
      self?.finish(reason: "local-ended")
    }
    end.configuration?.baseBackgroundColor = .systemRed
    let camera = control(title: "Cam", accessibility: "Toggle camera") { [weak self] in
      self?.toggleCamera()
    }
    let controls = UIStackView(arrangedSubviews: [switchCamera, microphone, end, camera])
    controls.axis = .horizontal
    controls.distribution = .fillEqually
    controls.spacing = 8
    controls.translatesAutoresizingMaskIntoConstraints = false
    view.addSubview(controls)

    NSLayoutConstraint.activate([
      remoteView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
      remoteView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
      remoteView.topAnchor.constraint(equalTo: view.topAnchor),
      remoteView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
      localView.widthAnchor.constraint(equalToConstant: 128),
      localView.heightAnchor.constraint(equalToConstant: 176),
      localView.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor, constant: -16),
      localView.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 16),
      controls.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor, constant: 12),
      controls.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor, constant: -12),
      controls.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -12),
      controls.heightAnchor.constraint(equalToConstant: 50),
    ])
  }

  private func control(
    title: String,
    accessibility: String,
    action: @escaping () -> Void
  ) -> UIButton {
    var configuration = UIButton.Configuration.filled()
    configuration.title = title
    let button = UIButton(configuration: configuration)
    button.accessibilityLabel = accessibility
    button.addAction(UIAction { _ in action() }, for: .touchUpInside)
    return button
  }

  private func startAgora() {
    let nextEngine = AgoraRtcEngineKit.sharedEngine(withAppId: appId, delegate: self)
    engine = nextEngine
    nextEngine.enableVideo()
    nextEngine.setChannelProfile(.liveBroadcasting)
    nextEngine.setClientRole(.broadcaster)
    nextEngine.setVideoEncoderConfiguration(AgoraVideoEncoderConfiguration(
      size: CGSize(width: quality.width, height: quality.height),
      frameRate: 15,
      bitrate: AgoraVideoBitrateStandard,
      orientationMode: .adaptative,
      mirrorMode: .auto
    ))
    let localCanvas = AgoraRtcVideoCanvas()
    localCanvas.uid = 0
    localCanvas.view = localView
    localCanvas.renderMode = .hidden
    nextEngine.setupLocalVideo(localCanvas)
    nextEngine.startPreview()
    let options = AgoraRtcChannelMediaOptions()
    options.publishCameraTrack = true
    options.publishMicrophoneTrack = true
    options.clientRoleType = .broadcaster
    let result = nextEngine.joinChannel(
      byToken: token,
      channelId: channel,
      uid: uid,
      mediaOptions: options
    )
    if result < 0 { finish(reason: "agora-join-failed-\(result)") }
  }

  private func observeLifecycle() {
    for name in [
      UIApplication.didEnterBackgroundNotification,
      AVAudioSession.interruptionNotification,
    ] {
      lifecycleObservers.append(NotificationCenter.default.addObserver(
        forName: name,
        object: nil,
        queue: .main
      ) { [weak self] notification in
        guard let reason = VideoCallLifecycle.endReason(for: notification) else { return }
        self?.finish(reason: reason)
      })
    }
  }

  private func removeLifecycleObservers() {
    for observer in lifecycleObservers {
      NotificationCenter.default.removeObserver(observer)
    }
    lifecycleObservers.removeAll()
  }

  func renewToken(_ token: String) -> Bool {
    guard !ended, !token.isEmpty, let engine else { return false }
    return engine.renewToken(token) == 0
  }

  func requestStop(reason: String) {
    DispatchQueue.main.async { [weak self] in self?.finish(reason: reason) }
  }

  private func toggleMicrophone() {
    microphoneMuted.toggle()
    engine?.muteLocalAudioStream(microphoneMuted)
  }

  private func toggleCamera() {
    cameraMuted.toggle()
    engine?.muteLocalVideoStream(cameraMuted)
    localView.isHidden = cameraMuted
  }

  private func finish(reason: String) {
    guard !ended else { return }
    ended = true
    removeLifecycleObservers()
    limitWorkItem?.cancel()
    let durationMs: UInt64
    if let connectedAt {
      durationMs = (DispatchTime.now().uptimeNanoseconds - connectedAt.uptimeNanoseconds) / 1_000_000
    } else {
      durationMs = 0
    }
    engine?.leaveChannel(nil)
    engine?.stopPreview()
    AgoraRtcEngineKit.destroy()
    engine = nil
    let endedHandler = onEnded
    dismiss(animated: true) { endedHandler?(reason, durationMs) }
  }

  func rtcEngine(_ engine: AgoraRtcEngineKit, didJoinedOfUid uid: UInt, elapsed: Int) {
    DispatchQueue.main.async { [weak self] in
      guard let self, !self.ended else { return }
      self.remoteUid = uid
      if self.connectedAt == nil {
        self.connectedAt = .now()
        let workItem = DispatchWorkItem { [weak self] in self?.finish(reason: "time-limit") }
        self.limitWorkItem = workItem
        DispatchQueue.main.asyncAfter(
          deadline: .now() + .seconds(self.connectedLimitSeconds),
          execute: workItem
        )
      }
      let canvas = AgoraRtcVideoCanvas()
      canvas.uid = uid
      canvas.view = self.remoteView
      canvas.renderMode = .hidden
      engine.setupRemoteVideo(canvas)
      self.onRemoteUserJoined?(uid)
    }
  }

  func rtcEngine(_ engine: AgoraRtcEngineKit, didOfflineOfUid uid: UInt, reason: AgoraUserOfflineReason) {
    DispatchQueue.main.async { [weak self] in
      guard let self, uid == self.remoteUid else { return }
      self.finish(reason: "remote-ended")
    }
  }

  func rtcEngine(_ engine: AgoraRtcEngineKit, didOccurError errorCode: AgoraErrorCode) {
    DispatchQueue.main.async { [weak self] in
      self?.finish(reason: "agora-error-\(errorCode.rawValue)")
    }
  }

  override func viewDidDisappear(_ animated: Bool) {
    super.viewDidDisappear(animated)
    if !ended, presentingViewController == nil { finish(reason: "view-dismissed") }
  }
}

@_cdecl("init_plugin_open_grind_video_call")
func initOpenGrindVideoCallPlugin() -> Plugin {
  VideoCallPlugin()
}
