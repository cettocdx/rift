import SwiftUI
import WebKit

enum NativePreviewURL {
    static func parse(_ value: String?) -> URL? {
        guard let value, let url = URL(string: value), url.scheme == "https",
              let host = url.host, !host.isEmpty, url.user == nil, url.password == nil else { return nil }
        return url
    }
}

enum NativeWorkspacePanel: String, Identifiable {
    case activity, preview
    var id: String { rawValue }
}

struct NativeWorkspacePanelView: View {
    @Environment(RIFTStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State var selection: NativeWorkspacePanel
    private var activities: [AgentActivity] {
        let liveIDs = Set(store.agentActivity.steps.map(\.id))
        return store.messages.compactMap(\.savedActivity).map { $0.excluding(liveIDs) } + [store.agentActivity]
    }
    private var preview: URL? { activities.flatMap(\.steps).compactMap(\.previewURL).last }
    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                Picker("Workspace panel", selection: $selection) {
                    Text("Activity").tag(NativeWorkspacePanel.activity)
                    Text("Preview").tag(NativeWorkspacePanel.preview)
                }.pickerStyle(.segmented).padding(.horizontal).padding(.bottom, 12)
                if selection == .preview {
                    if let preview { NativeWebPreview(url: preview).id(preview) }
                    else {
                        ContentUnavailableView("No preview yet", systemImage: "globe", description: Text("When RIFT starts your app, its live preview appears here."))
                    }
                } else {
                    ScrollView {
                        LazyVStack(alignment: .leading, spacing: 24) {
                            ForEach(Array(activities.enumerated()), id: \.offset) { index, activity in
                                if !activity.steps.isEmpty || !activity.reasoning.isEmpty || (index == activities.count - 1 && store.working) {
                                    AgentActivityDetails(activity: activity, working: index == activities.count - 1 && store.working)
                                }
                            }
                            if activities.allSatisfy({ $0.steps.isEmpty && $0.reasoning.isEmpty }) && !store.working {
                                ContentUnavailableView("No activity yet", systemImage: "list.bullet", description: Text("Tool calls, progress and results appear here while RIFT works."))
                            }
                        }.padding(20)
                    }.accessibilityIdentifier("workspace-activity-details")
                }
            }
            .navigationTitle(selection == .activity ? "Activity" : "Preview")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }.presentationDetents([.large]).presentationDragIndicator(.visible)
    }
}

/// Preview pages run without RIFT session cookies or a native bridge.
struct NativeWebPreview: View {
    let url: URL
    @State private var loading = true
    @State private var failed = false
    @State private var reloadID = 0
    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Image(systemName: "lock").font(.caption)
                Text(url.host ?? "Preview").font(.caption).lineLimit(1)
                Spacer()
                ShareLink(item: url) { Image(systemName: "square.and.arrow.up") }.accessibilityLabel("Share preview")
                Button { loading = true; failed = false; reloadID += 1 } label: { Image(systemName: "arrow.clockwise") }.accessibilityLabel("Reload preview")
            }.foregroundStyle(.secondary).padding(.horizontal).frame(minHeight: 44)
            ZStack {
                PreviewWebView(url: url, loading: $loading, failed: $failed).id(reloadID)
                if loading { ProgressView("Loading preview").padding().background(.regularMaterial, in: .rect(cornerRadius: 12)) }
                if failed {
                    ContentUnavailableView {
                        Label("Preview unavailable", systemImage: "globe")
                    } description: {
                        Text("The app server may have stopped. Retry, or ask RIFT to restart the preview.")
                    } actions: {
                        Button("Retry preview") { loading = true; failed = false; reloadID += 1 }
                    }.background(Color(uiColor: .systemBackground))
                }
            }
        }.accessibilityIdentifier("live-preview")
    }
}
private struct PreviewWebView: UIViewRepresentable {
    let url: URL
    @Binding var loading: Bool
    @Binding var failed: Bool
    func makeCoordinator() -> Coordinator { Coordinator(self) }
    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .nonPersistent()
        config.allowsInlineMediaPlayback = true
        let view = WKWebView(frame: .zero, configuration: config)
        view.navigationDelegate = context.coordinator
        view.isOpaque = false
        view.backgroundColor = .systemBackground
        view.load(URLRequest(url: url))
        return view
    }
    func updateUIView(_ view: WKWebView, context: Context) { context.coordinator.parent = self }
    final class Coordinator: NSObject, WKNavigationDelegate {
        var parent: PreviewWebView
        init(_ parent: PreviewWebView) { self.parent = parent }
        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { parent.loading = false; parent.failed = false }
        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { finish(error) }
        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { finish(error) }
        private func finish(_ error: Error) {
            guard (error as NSError).code != NSURLErrorCancelled else { return }
            parent.loading = false; parent.failed = true
        }
        func webView(_ webView: WKWebView, decidePolicyFor navigationResponse: WKNavigationResponse, decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
            if navigationResponse.isForMainFrame, let response = navigationResponse.response as? HTTPURLResponse, response.statusCode >= 400 {
                parent.loading = false; parent.failed = true; decisionHandler(.cancel)
            } else { decisionHandler(.allow) }
        }
        func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            decisionHandler(NativePreviewURL.parse(navigationAction.request.url?.absoluteString) == nil ? .cancel : .allow)
        }
    }
}
