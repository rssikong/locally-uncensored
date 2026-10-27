// swift-tools-version:5.5

import PackageDescription

let package = Package(
  name: "tauri-plugin-lu-native",
  platforms: [
    .macOS(.v10_15),
    .iOS(.v15),
  ],
  products: [
    .library(
      name: "tauri-plugin-lu-native",
      type: .static,
      targets: ["tauri-plugin-lu-native"])
  ],
  dependencies: [
    // Copied here by the build script of the Rust crate (tauri-plugin).
    .package(name: "Tauri", path: "../.tauri/tauri-api")
  ],
  targets: [
    .target(
      name: "tauri-plugin-lu-native",
      dependencies: [
        .byName(name: "Tauri")
      ],
      path: "Sources")
  ]
)
