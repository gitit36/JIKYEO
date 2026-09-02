// swift-tools-version:5.9
import PackageDescription

/// This package exists only to typecheck the JIKYEO iOS sources outside Xcode.
/// The real app is expected to be an Xcode project that includes these files.
/// - `JIKYEOApp.swift` is excluded here because Swift packages can't host an
///   iOS `@main App` executable directly.
let package = Package(
    name: "JIKYEOKit",
    platforms: [.iOS(.v17)],
    products: [
        .library(name: "JIKYEOKit", targets: ["JIKYEOKit"]),
    ],
    targets: [
        .target(
            name: "JIKYEOKit",
            path: ".",
            exclude: ["JIKYEOApp.swift", "RootView.swift", "README.md", "Resources"],
            sources: [
                "DesignSystem",
                "Core",
                "Features",
            ]
        )
    ]
)
