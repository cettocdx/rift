import SwiftUI
import AVKit

struct NativeArtifactView: View {
    @Environment(RIFTStore.self) private var store
    let fileID: String
    let name: String
    let mediaType: String
    @State private var url: URL?
    @State private var player: AVPlayer?
    @State private var failed = false
    @State private var loading = false
    @State private var previewVersion = 0
    @State private var localURL: URL?
    @State private var downloading = false
    @State private var downloadError: String?

    private func resolveURL() async throws -> URL {
        let result = try await store.service.json("/api/mobile/file?id=" + fileID)
        guard let value = result["url"] as? String, let resolved = URL(string: value),
              resolved.scheme == "https" else { throw RIFTFailure(message: "File unavailable. Please retry.") }
        return resolved
    }
    private func loadPreview() async {
        guard !loading else { return }
        loading = true; failed = false
        defer { loading = false }
        do {
            let resolved = try await resolveURL()
            try Task.checkCancellation()
            url = resolved
            previewVersion += 1
            if mediaType.hasPrefix("video/") { player = AVPlayer(url: resolved) }
        } catch is CancellationError { }
        catch { failed = true }
    }
    private func download() async {
        guard !downloading else { return }
        downloading = true; downloadError = nil
        defer { downloading = false }
        do {
            // Signed URLs expire. Every explicit download attempt obtains a fresh,
            // owner-checked URL instead of retrying the stale preview URL.
            let resolved = try await resolveURL()
            let (temporary, response) = try await URLSession.shared.download(from: resolved)
            guard let response = response as? HTTPURLResponse, (200..<300).contains(response.statusCode) else { throw RIFTFailure(message: "Download failed. Please retry.") }
            let folder = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
            try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
            let safeName = (name as NSString).lastPathComponent
            let destination = folder.appendingPathComponent(safeName.isEmpty ? "RIFT-file" : safeName)
            do { try FileManager.default.moveItem(at: temporary, to: destination) }
            catch { try? FileManager.default.removeItem(at: folder); throw error }
            localURL = destination
        } catch { downloadError = error.localizedDescription }
    }
    private var retryPreview: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Preview unavailable").font(.footnote).foregroundStyle(.secondary)
            Button("Retry preview") { Task { await loadPreview() } }
                .font(.footnote).disabled(loading)
        }.frame(minHeight: 100)
    }
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if mediaType.hasPrefix("image/") {
                GeometryReader { geometry in
                    Group {
                        if failed { retryPreview }
                        else if let url {
                            AsyncImage(url: url) { phase in
                                switch phase {
                                case .success(let image): image.resizable().scaledToFit()
                                case .failure: retryPreview
                                case .empty: ProgressView("Loading preview")
                                @unknown default: retryPreview
                                }
                            }.id(previewVersion)
                        } else { ProgressView("Loading preview") }
                    }.frame(width: geometry.size.width, height: geometry.size.height)
                }.aspectRatio(1, contentMode: .fit).clipShape(.rect(cornerRadius: 16))
            } else if failed { retryPreview }
            else if mediaType.hasPrefix("video/") {
                if let player { VideoPlayer(player: player).frame(height: 240).clipShape(.rect(cornerRadius: 16)) }
                else { ProgressView("Loading preview").frame(height: 240) }
            }
            if let localURL {
                ShareLink(item: localURL) { Label("Save or share " + name, systemImage: "square.and.arrow.up").font(.footnote) }
            } else {
                Button { Task { await download() } } label: {
                    Label(downloading ? "Downloading…" : "Download " + name, systemImage: "arrow.down.circle").font(.footnote)
                        .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading).contentShape(Rectangle())
                }.buttonStyle(.plain).disabled(downloading).accessibilityIdentifier("download-" + fileID)
            }
            if let downloadError { Text(downloadError).font(.caption).foregroundStyle(.secondary) }
        }
        .task(id: fileID) { await loadPreview() }
        .onDisappear { player?.pause() }
    }
}
