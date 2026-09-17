import SwiftUI
import UniformTypeIdentifiers

struct AssessmentDocument: FileDocument {
    static var readableContentTypes: [UTType] { [.plainText] }
    var text: String
    init(text: String) { self.text = text }
    init(configuration: ReadConfiguration) throws { text = String(decoding: configuration.file.regularFileContents ?? Data(), as: UTF8.self) }
    func fileWrapper(configuration: WriteConfiguration) throws -> FileWrapper { FileWrapper(regularFileWithContents: Data(text.utf8)) }
}
struct NativeAssessmentReport: View {
    @Environment(RIFTStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var exporting = false
    private var responses: [NativeMessage] { store.messages.filter { $0.role == "assistant" && $0.fileID == nil && !$0.text.isEmpty } }
    private var report: String {
        "RIFT — Assessment transcript\nScope: \(store.hackScope.isEmpty ? "Not recorded" : store.hackScope)\n\(store.working ? "Assessment in progress — partial results" : "Saved responses — check coverage and limitations below")\n\n" + responses.map(\.text).joined(separator: "\n\n---\n\n")
    }
    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    Label(store.working ? "Partial results" : "Assessment responses", systemImage: "doc.text")
                        .font(.headline)
                    Text("These are the recorded assistant responses. Missing checks or an empty result do not establish that a target is secure.")
                        .font(.footnote).foregroundStyle(.secondary)
                    if responses.isEmpty { ContentUnavailableView("No results yet", systemImage: "doc.text.magnifyingglass", description: Text("Run an assessment to collect results.")) }
                    ForEach(AssessmentFinding.extract(responses.map(\.text).joined(separator: "\n"))) { finding in
                        DisclosureGroup { Text(finding.evidence).font(.footnote).textSelection(.enabled) } label: {
                            VStack(alignment: .leading, spacing: 4) { Text(finding.severity.capitalized).font(.caption).foregroundStyle(.secondary); Text(finding.title).font(.subheadline.weight(.medium)) }
                        }
                    }
                    ForEach(responses) { response in
                        Text(response.text).textSelection(.enabled)
                        Divider()
                    }
                }.padding(20)
            }.navigationTitle("Assessment report").navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) { Button("Done") { dismiss() } }
                    ToolbarItem(placement: .confirmationAction) { Button { exporting = true } label: { Image(systemName: "square.and.arrow.up") }.accessibilityLabel("Export report").disabled(responses.isEmpty) }
                }
                .fileExporter(isPresented: $exporting, document: AssessmentDocument(text: report), contentType: .plainText, defaultFilename: "RIFT-assessment") { result in
                    if case .failure(let error) = result { store.error = error.localizedDescription }
                }
        }
    }
}
