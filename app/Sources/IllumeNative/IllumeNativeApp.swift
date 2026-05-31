#if os(iOS)
import SwiftUI

@main
struct IllumeNativeApp: App {
    @StateObject private var app = IllumeAppModel()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(app)
                .preferredColorScheme(.dark)
                .task {
                    await app.bootstrap()
                }
        }
    }
}
#endif
