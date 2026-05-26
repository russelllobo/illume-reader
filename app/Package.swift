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
                .product(name: "Supabase", package: "supabase-swift"),
                .product(name: "ZIPFoundation", package: "ZIPFoundation")
            ],
            resources: [
                .process("Resources")
            ]
        ),
        .testTarget(
            name: "IllumeCoreTests",
            dependencies: ["IllumeCore"]
        )
    ]
)
