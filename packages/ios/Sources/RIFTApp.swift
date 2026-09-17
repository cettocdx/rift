import SwiftUI

@main
struct RIFTApp: App {
    @Environment(\.scenePhase) private var scenePhase
    @State private var store = RIFTStore()
    @AppStorage("appearance") private var appearance = "dark"
    var body: some Scene {
        WindowGroup {
            WorkspaceView()
                .environment(store)
                .tint(Color.primary)
                .preferredColorScheme(appearance == "system" ? nil : appearance == "light" ? .light : .dark)
                .task { await store.restore() }
                .onChange(of: scenePhase) { _, phase in
                    if phase == .active { store.becameActive() }
                }
        }
    }
}
