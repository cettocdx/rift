import Foundation
/// Both metadata broadcasts and media tool results identify the same saved file.
/// Only durable file IDs are accepted; temporary provider URLs are not persisted.
enum NativeFileResult {
    static func files(from event: [String: Any]) -> [NativeMessage] {
        let candidates: [[String: Any]]
        if event["type"] as? String == "data-file-metadata" {
            candidates = (event["data"] as? [String: Any])?["fileDetails"] as? [[String: Any]] ?? []
        } else if event["type"] as? String == "tool-output-available", let output = event["output"] as? [String: Any], output["ok"] as? Bool != false {
            candidates = [output]
        } else { return [] }
        return candidates.compactMap { file in
            guard let id = file["fileId"] as? String, !id.isEmpty else { return nil }
            return NativeMessage(id: "file:" + id, role: "assistant", text: file["name"] as? String ?? "Generated file", fileID: id, mediaType: file["mediaType"] as? String)
        }
    }
}
