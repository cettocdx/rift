import Foundation
import UniformTypeIdentifiers
struct NativeAttachment: Identifiable {
    let id: String; let name: String; let mediaType: String; let size: Int
    var part: [String: Any] { ["type": "file", "fileId": id, "name": name, "mediaType": mediaType, "size": size, "storage": "s3"] }
}
extension RIFTStore {
    func attach(_ url: URL) async {
        guard signedIn, !working, !uploading else { return }
        uploading = true
        defer { uploading = false }
        let access = url.startAccessingSecurityScopedResource()
        defer { if access { url.stopAccessingSecurityScopedResource() } }
        let chat = selectedID
        do {
            let size = try url.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0
            let mime = UTType(filenameExtension: url.pathExtension)?.preferredMIMEType ?? "application/octet-stream"
            var body: [String: Any] = ["operation": "prepare", "name": url.lastPathComponent, "mediaType": mime, "size": size, "mode": workspace == .studio ? "ask" : "agent"]
            let target = try await service.json("/api/mobile/upload", body: body)
            guard let endpoint = (target["uploadUrl"] as? String).flatMap(URL.init(string:)), endpoint.scheme == "https" else { throw RIFTFailure(message: "Upload destination unavailable.") }
            var request = URLRequest(url: endpoint)
            let convex = target["backend"] as? String == "convex"
            request.httpMethod = convex ? "POST" : "PUT"
            request.setValue(mime, forHTTPHeaderField: "Content-Type")
            // A separate session never sends RIFT authentication cookies to storage.
            let transfer = URLSession(configuration: .ephemeral)
            defer { transfer.finishTasksAndInvalidate() }
            let (data, response) = try await transfer.upload(for: request, fromFile: url)
            guard let response = response as? HTTPURLResponse, (200..<300).contains(response.statusCode) else { throw RIFTFailure(message: "File upload failed. Your draft is preserved.") }
            body["operation"] = "complete"
            if convex { body["storageId"] = (try JSONSerialization.jsonObject(with: data) as? [String: Any])?["storageId"] }
            else { body["s3Key"] = target["s3Key"] }
            let saved = try await service.json("/api/mobile/upload", body: body)
            guard let id = saved["fileId"] as? String else { throw RIFTFailure(message: "File could not be saved.") }
            if selectedID == chat { attachments.append(.init(id: id, name: url.lastPathComponent, mediaType: mime, size: size)) }
        } catch { if selectedID == chat { self.error = error.localizedDescription } }
    }
}
