// swift-tools-version: 6.0

import PackageDescription

let package = Package(
    name: "Illume",
    platforms: [
        .iOS(.v17)
    ],
    products: [
        .library(
            name: "IllumeNative",
            targets: ["IllumeNative"]
        )
    ],
    dependencies: [
        .package(
            url: "https://github.com/supabase/supabase-swift.git",
            from: "2.0.0"
        ),
        .package(
            url: "https://github.com/weichsel/ZIPFoundation.git",
            from: "0.9.19"
        )
    ],
    targets: [
        .target(
            name: "IllumeCore"
        ),
        .target(
            name: "IllumeNative",
            dependencies: [
                "IllumeCore",
                "SherpaOnnxSupport",
                .product(name: "Supabase", package: "supabase-swift"),
                .product(name: "ZIPFoundation", package: "ZIPFoundation")
            ],
            resources: [
                .process("Resources/Fonts"),
                .process("Resources/ClassicCovers"),
                .process("Resources/ImageStyles"),
                .process("Resources/PrivacyInfo.xcprivacy"),
                .copy("Resources/KokoroTTS")
            ]
        ),
        .target(
            name: "CSherpaOnnx",
            publicHeadersPath: "include"
        ),
        .target(
            name: "SherpaOnnxSupport",
            dependencies: [
                "CSherpaOnnx",
                "SherpaOnnxBinary",
                "OnnxRuntimeBinary"
            ],
            linkerSettings: [
                .linkedLibrary("c++")
            ]
        ),
        .binaryTarget(
            name: "SherpaOnnxBinary",
            path: "Vendor/SherpaOnnx/sherpa-onnx.xcframework"
        ),
        .binaryTarget(
            name: "OnnxRuntimeBinary",
            path: "Vendor/SherpaOnnx/onnxruntime.xcframework"
        ),
        .testTarget(
            name: "IllumeCoreTests",
            dependencies: ["IllumeCore"]
        )
    ]
)
