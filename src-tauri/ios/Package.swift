// swift-tools-version:5.9
import PackageDescription

let package = Package(
  name: "open-grind",
  platforms: [.iOS(.v16)],
  products: [
    .library(name: "open-grind", type: .static, targets: ["open-grind"])
  ],
  dependencies: [
    .package(name: "Tauri", path: "../.tauri/tauri-api"),
    .package(
      url: "https://github.com/AgoraIO/AgoraRtcEngine_iOS.git",
      exact: "4.6.2"
    ),
  ],
  targets: [
    .target(
      name: "open-grind",
      dependencies: [
        .byName(name: "Tauri"),
        .product(name: "RtcBasic", package: "AgoraRtcEngine_iOS"),
      ],
      path: "Sources"
    )
  ]
)
