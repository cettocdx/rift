import Foundation
import SwiftUI

struct AgentActivityStep: Identifiable, Equatable {
    enum State { case running, completed, failed, interrupted }
    let id: String
    var title: String
    var state: State
    var website: URL? = nil
    var command = ""
    var output = ""
    var exitCode: Int? = nil
    var toolName = ""
    var previewURL: URL? = nil
}

/// Tool call IDs make stream replay idempotent. Never infer success from stream closure.
struct AgentActivity: Equatable {
    var steps: [AgentActivityStep] = []
    var title = "Working"
    var reasoning = ""
    private var terminalEvents: Set<String> = []
    private var replayReasoning = ""
    mutating func apply(_ event: [String: Any]) {
        switch event["type"] as? String {
        case "start": replayReasoning = ""
        case "reasoning-start": title = "Thinking"
        case "reasoning-delta":
            replayReasoning += event["delta"] as? String ?? ""
            if !reasoning.hasPrefix(replayReasoning) { reasoning = replayReasoning }
        case "finish":
            if !replayReasoning.isEmpty { reasoning = replayReasoning }
        case "data-media-progress":
            guard let data = event["data"] as? [String: Any], let id = data["toolCallId"] as? String,
                  let index = steps.firstIndex(where: { $0.id == id }), steps[index].state == .running else { return }
            let medium = steps[index].toolName.contains("video") ? "video" : "image"
            let stage: String
            switch data["stage"] as? String {
            case "preparing": stage = "Preparing "
            case "generating": stage = "Generating "
            case "saving": stage = "Saving "
            default: return
            }
            steps[index].title = stage + medium
            title = steps[index].title
        case "data-terminal":
            guard let data = event["data"] as? [String: Any], let id = data["toolCallId"] as? String,
                  let text = data["terminal"] as? String else { return }
            if let eventID = event["id"] as? String, !terminalEvents.insert(eventID).inserted { return }
            if !steps.contains(where: { $0.id == id }) { steps.append(.init(id: id, title: "Running a command", state: .running)) }
            if let index = steps.firstIndex(where: { $0.id == id }) { steps[index].output += text }
        case "text-delta": title = "Writing response"
        case "tool-input-available":
            guard let id = event["toolCallId"] as? String else { return }
            let name = event["toolName"] as? String ?? ""
            let input = event["input"] as? [String: Any] ?? [:]
            let brief = (input["brief"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines)
            let label = brief.flatMap { $0.isEmpty ? nil : String($0.prefix(160)) } ?? Self.label(name)
            if !steps.contains(where: { $0.id == id }) {
                let website = (input["url"] as? String).flatMap(URL.init(string:)).flatMap { url in
                    url.scheme == "https" && url.host != nil ? URL(string: "https://" + url.host!) : nil
                }
                steps.append(.init(id: id, title: label, state: .running, website: website))
            }
            if let index = steps.firstIndex(where: { $0.id == id }) {
                steps[index].toolName = name
                steps[index].command = input["command"] as? String ?? input["cmd"] as? String ?? steps[index].command
                steps[index].title = label
            }
            title = label
        case "tool-output-available", "tool-output-error", "tool-input-error", "tool-output-denied":
            guard let id = event["toolCallId"] as? String else { return }
            let output = event["output"] as? [String: Any]
            let result = output?["result"] as? [String: Any] ?? output
            let exitCode = result?["exitCode"] as? Int
            let stringError = (event["output"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines).hasPrefix("Error:") == true
            let failed = stringError || event["type"] as? String != "tool-output-available" || result?["ok"] as? Bool == false || result?["error"] is String || (exitCode != nil && exitCode != 0)
            if let index = steps.firstIndex(where: { $0.id == id }) {
                steps[index].state = failed ? .failed : .completed
                steps[index].exitCode = exitCode
                let text = result?["output"] as? String ?? event["output"] as? String ?? [result?["stdout"] as? String, result?["stderr"] as? String].compactMap { $0 }.joined(separator: "\n")
                if !text.isEmpty { steps[index].output = text }
                else if let result, !result.isEmpty, JSONSerialization.isValidJSONObject(result),
                        let data = try? JSONSerialization.data(withJSONObject: result, options: [.prettyPrinted, .sortedKeys]),
                        let text = String(data: data, encoding: .utf8) { steps[index].output = text }
                if steps[index].toolName == "expose_preview", !failed {
                    steps[index].previewURL = NativePreviewURL.parse(result?["url"] as? String)
                }
                if let error = event["errorText"] as? String ?? result?["error"] as? String, !error.isEmpty { steps[index].output += "\n" + error }
            }
            title = "Working"
        default: break
        }
    }
    mutating func restore(parts: [[String: Any]]) {
        self = AgentActivity()
        for part in parts {
            if part["type"] as? String == "reasoning" { reasoning += part["text"] as? String ?? ""; continue }
            if part["type"] as? String == "data-terminal" { apply(part); continue }
            guard let type = part["type"] as? String,
                  type.hasPrefix("tool-") || type == "dynamic-tool",
                  let id = part["toolCallId"] as? String else { continue }
            let name = type == "dynamic-tool" ? part["toolName"] as? String ?? "" : String(type.dropFirst(5))
            apply(["type": "tool-input-available", "toolCallId": id, "toolName": name, "input": part["input"] as? [String: Any] ?? [:]])
            switch part["state"] as? String {
            case "output-available":
                apply(["type": "tool-output-available", "toolCallId": id, "output": part["output"] ?? [:]])
            case "output-error", "output-denied", "input-error":
                apply(["type": "tool-output-error", "toolCallId": id, "errorText": part["errorText"] as? String ?? ""])
            default: break
            }
        }
        // A saved input is not evidence that its execution is still running.
        settle(completed: false)
        title = "Previous activity"
    }
    func excluding(_ ids: Set<String>) -> AgentActivity {
        var result = self
        result.steps.removeAll { ids.contains($0.id) }
        return result
    }
    mutating func settle(completed: Bool) {
        for index in steps.indices where steps[index].state == .running { steps[index].state = .interrupted }
        title = completed ? "Activity" : "Activity paused"
    }
    private static func label(_ name: String) -> String {
        switch name {
        case "file", "desktop_workspace_read": "Reading files"
        case "list_files", "desktop_workspace_list": "Exploring project"
        case "web_search": "Searching the web"
        case "browse_url", "open_url": "Reading a page"
        case "run_terminal_cmd": "Running a command"
        case "edit_file", "apply_patch": "Editing files"
        case "delegate_task": "Working with a specialist"
        case "update_plan": "Updating the plan"
        case "generate_video": "Preparing video"
        case "generate_image": "Preparing image"
        case "expose_preview": "Opening preview"
        default: "Working on your request"
        }
    }
}

struct AgentActivityView: View {
    let activity: AgentActivity
    let working: Bool
    @State private var expanded = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Button {
                withAnimation(reduceMotion ? nil : .smooth(duration: 0.2)) { expanded.toggle() }
            } label: {
                VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 9) {
                    if working { ReasoningIndicator() }
                    else { Image(systemName: "list.bullet").font(.caption).frame(width: 16) }
                    WorkingLabel(title: activity.title, active: working)
                    if !activity.steps.isEmpty || !activity.reasoning.isEmpty {
                        Image(systemName: expanded ? "chevron.down" : "chevron.right").font(.system(size: 10, weight: .semibold))
                    }
                    Spacer(minLength: 0)
                }.foregroundStyle(.secondary).frame(minHeight: 44)
                if !activity.reasoning.isEmpty {
                    Text(activity.reasoning)
                        .font(.system(size: 13)).foregroundStyle(.secondary)
                        .lineLimit(3).multilineTextAlignment(.leading)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.leading, 25)
                        .accessibilityIdentifier("thinking-preview")
                }
                }.contentShape(Rectangle())
            }.buttonStyle(.plain)
                .accessibilityLabel(activity.title)
                .accessibilityValue(expanded ? "Expanded" : "Show thinking and activity")
                .accessibilityIdentifier("agent-activity")
        }.sheet(isPresented: $expanded) {
            NavigationStack {
                ScrollView {
                AgentActivityDetails(activity: activity, working: working).padding(20)
                }.navigationTitle("Activity").navigationBarTitleDisplayMode(.inline)
                    .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { expanded = false } } }
            }.presentationDetents([.medium, .large]).presentationDragIndicator(.visible)
        }
    }
}

struct AgentActivityDetails: View {
    let activity: AgentActivity
    let working: Bool
    @State private var thinkingExpanded = true
    var body: some View {
                LazyVStack(alignment: .leading, spacing: 12) {
                    HStack(spacing: 9) {
                        if working { ReasoningIndicator() }
                        WorkingLabel(title: activity.title, active: working)
                        Spacer()
                    }.padding(.bottom, 8)
                    if !activity.reasoning.isEmpty {
                        DisclosureGroup("Thinking", isExpanded: $thinkingExpanded) {
                            NativeMarkdownText(text: activity.reasoning).font(.footnote).frame(maxWidth: .infinity, alignment: .leading)
                        }
                    }
                    ForEach(activity.steps) { step in
                        HStack(alignment: .top, spacing: 10) {
                            Image(systemName: symbol(step.state)).font(.system(size: 12)).frame(width: 16, height: 18)
                                .foregroundStyle(step.state == .failed ? Color.orange : Color.secondary)
                            VStack(alignment: .leading, spacing: 6) {
                                Text(step.title).font(.footnote).foregroundStyle(.primary).fixedSize(horizontal: false, vertical: true)
                                if !step.command.isEmpty || !step.output.isEmpty {
                                    DisclosureGroup("Terminal & output") {
                                        ScrollView([.horizontal, .vertical]) {
                                            LazyVStack(alignment: .leading, spacing: 2) {
                                                if !step.command.isEmpty { Text("$ " + step.command).foregroundStyle(.secondary) }
                                                ForEach(Array(step.output.components(separatedBy: "\n").enumerated()), id: \.offset) { _, line in
                                                    Text(line.isEmpty ? " " : line).frame(maxWidth: .infinity, alignment: .leading)
                                                }
                                            }.font(.system(size: 12, design: .monospaced)).textSelection(.enabled).padding(10)
                                        }.frame(maxHeight: 300).background(Color.primary.opacity(0.04), in: .rect(cornerRadius: 10))
                                        if let exit = step.exitCode { Text("Exit code: \(exit)").font(.caption).foregroundStyle(.secondary) }
                                    }.font(.footnote)
                                }
                                if let website = step.website {
                                    HStack(spacing: 6) {
                                        AsyncImage(url: website.appendingPathComponent("favicon.ico")) { image in
                                            image.resizable().scaledToFit()
                                        } placeholder: { Image(systemName: "globe").foregroundStyle(.secondary) }
                                        .frame(width: 16, height: 16).accessibilityHidden(true)
                                        Text(website.host ?? "Website").font(.caption).foregroundStyle(.secondary).lineLimit(1)
                                    }
                                }
                            }
                            Spacer(minLength: 0)
                        }.accessibilityElement(children: .combine).accessibilityValue(status(step.state))
                    }
                }
                    .accessibilityIdentifier("agent-activity-details")
    }
    private func symbol(_ state: AgentActivityStep.State) -> String {
        switch state { case .running: "ellipsis"; case .completed: "checkmark"; case .failed: "exclamationmark.circle"; case .interrupted: "pause" }
    }
    private func status(_ state: AgentActivityStep.State) -> String {
        switch state { case .running: "Running"; case .completed: "Completed"; case .failed: "Needs attention"; case .interrupted: "Unconfirmed" }
    }
}
