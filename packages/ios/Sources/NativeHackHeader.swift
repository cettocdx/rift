import SwiftUI

struct NativeHackHeader: View {
    @Environment(RIFTStore.self) private var store
    @State private var reportOpen = false
    @State private var tasksOpen = false
    @State private var search = ""
    private var tasks: [HackTaskPreset] {
        hackTaskCatalog.filter { search.isEmpty || ($0.title + " " + $0.detail).localizedCaseInsensitiveContains(search) }
    }
    var body: some View {
        @Bindable var store = store
        VStack(spacing: 4) {
            HStack(spacing: 8) {
                Image(systemName: "scope").foregroundStyle(.secondary)
                TextField("Domain, IP address or CIDR", text: $store.hackScope)
                    .font(.subheadline).textInputAutocapitalization(.never).autocorrectionDisabled()
                    .accessibilityLabel("Assessment scope").accessibilityIdentifier("hack-scope")
                    .disabled(store.working)
                Button { tasksOpen = true } label: { Label("Tasks", systemImage: "list.bullet") }
                    .font(.subheadline).frame(minHeight: 44).accessibilityIdentifier("hack-tasks")
            }
            HStack {
                Label("Hack Workbench", systemImage: "shield.lefthalf.filled")
                Spacer()
                Button("Report") { reportOpen = true }.accessibilityIdentifier("hack-report")
                WorkingLabel(title: store.working ? "Working" : "Ready", active: store.working)
            }.font(.caption).foregroundStyle(.secondary)
        }.padding(.horizontal, 20).padding(.bottom, 8)
            .sheet(isPresented: $reportOpen) { NativeAssessmentReport() }
            .sheet(isPresented: $tasksOpen) {
                NavigationStack {
                    List(tasks) { task in
                        Button {
                            let scope = store.hackScope.trimmingCharacters(in: .whitespacesAndNewlines)
                            store.draft = task.prompt.replacingOccurrences(of: "{target}", with: scope.isEmpty ? "{target}" : scope)
                            tasksOpen = false
                        } label: {
                            VStack(alignment: .leading, spacing: 4) {
                                Text(task.title).font(.subheadline.weight(.medium)).foregroundStyle(.primary)
                                Text(task.detail).font(.caption).foregroundStyle(.secondary)
                            }.padding(.vertical, 4)
                        }.disabled(store.working)
                    }.searchable(text: $search, prompt: "Find a task")
                        .navigationTitle("Assessment tasks").navigationBarTitleDisplayMode(.inline)
                        .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { tasksOpen = false } } }
                }.presentationDetents([.medium, .large]).presentationDragIndicator(.visible)
            }
    }
}

/// Carry the selected target into the actual request without widening its scope.
enum NativeHackPrompt {
    static func text(_ text: String, scope: String) -> String {
        let target = scope.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !target.isEmpty else { return text }
        return "Selected assessment scope: " + target + "\n\n" + text.replacingOccurrences(of: "{target}", with: target)
    }
}
