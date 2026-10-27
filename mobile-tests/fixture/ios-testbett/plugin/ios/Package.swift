// swift-tools-version:5.5
import PackageDescription

let package = Package(
    name: "tauri-plugin-luharness",
    platforms: [
        .macOS(.v10_13),
        .iOS(.v15),
    ],
    products: [
        .library(
            name: "tauri-plugin-luharness",
            type: .static,
            targets: ["tauri-plugin-luharness"])
    ],
    dependencies: [
        .package(name: "Tauri", path: "../.tauri/tauri-api")
    ],
    targets: [
        .target(
            name: "tauri-plugin-luharness",
            dependencies: [
                .byName(name: "Tauri")
            ],
            path: "Sources")
    ]
)
